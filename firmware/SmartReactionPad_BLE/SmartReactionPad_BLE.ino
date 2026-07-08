/*
 * Smart Reaction Pad BLE Firmware v2
 * Scientific revision for six-direction stepping response and response inhibition.
 *
 * Hardware wiring is unchanged from v1:
 * ESP32 + 6 FSR + 2x 74HC164N + 12 zone LEDs + KY-009 RGB + OLED + 4-digit display + button.
 *
 * Metric definition:
 * SRT = stimulus-to-target-contact time, measured from zone LED command to FSR threshold crossing.
 * FSR ADC values are relative trigger/post-contact signals, not force or ground reaction force.
 */

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define DEVICE_NAME "SmartReactionPad"
#define SERVICE_UUID           "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_RX "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"
#define CHARACTERISTIC_UUID_TX "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"

BLEServer *pServer = nullptr;
BLECharacteristic *pTxCharacteristic = nullptr;
bool deviceConnected = false;
bool oldDeviceConnected = false;
String pendingCommand = "";

const int FSR_PINS[6] = {36, 39, 34, 35, 32, 33};
const char* ZONE_NAMES[6] = {"LF", "RF", "LR", "RR", "LL", "RL"};

const int PIN_164_DATA  = 23;
const int PIN_164_CLOCK = 27;
const int SEG[7] = {13, 14, 15, 16, 17, 26, 12};
const int DIG[4] = {2, 25, 4, 5};
const int BTN = 19;

#define OLED_ADDR 0x3C
#define OLED_ADDR_ALT 0x3D
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
bool oledReady = false;

const unsigned long BOOT_UPLOAD_WINDOW_MS = 3000;
const unsigned long SAFE_MODE_CONFIRM_MS = 1200;

const uint8_t FONT[] = {
  0b00111111, 0b00000110, 0b01011011, 0b01001111, 0b01100110,
  0b01101101, 0b01111101, 0b00000111, 0b01111111, 0b01101111,
  0b01110111, 0b01111001, 0b01000000, 0b00000000
};

volatile uint8_t dispBuf[4] = {13, 13, 13, 13};
hw_timer_t *dispTimer = nullptr;
byte ledBuf[2] = {0, 0};

const unsigned long MIN_DELAY_MS = 2000;
const unsigned long MAX_DELAY_MS = 7000;
const unsigned long TIMEOUT_MS = 2000;
const unsigned long SENSOR_CLEAR_MS = 420;
const unsigned long MULTI_CONTACT_WINDOW_MS = 18;
const unsigned long POST_CONTACT_SAMPLE_MS = 180;
const float ANTICIPATION_MS = 50.0;

const int CAL_SAMPLES = 80;
const int MIN_PRESS_DELTA = 280;
const int MIN_RELEASE_DELTA = 140;
const int STUCK_HIGH_ADC = 1200;

int baselineAdc[6] = {0, 0, 0, 0, 0, 0};
int noiseAdc[6] = {0, 0, 0, 0, 0, 0};
int pressThreshold[6] = {500, 500, 500, 500, 500, 500};
int releaseThreshold[6] = {260, 260, 260, 260, 260, 260};
bool calibrated = false;

enum StimClass { STIM_GO = 0, STIM_NOGO = 1 };
enum PadState {
  IDLE, CALIBRATING, WAIT_CLEAR, READY_FOREPERIOD, STIMULUS,
  POST_CONTACT_SAMPLE, RESULT, COMPLETE, STOPPED, ERROR_STATE
};

struct ProtocolDef {
  const char* id;
  const char* label;
  int formalTrials;
  int practiceTrials;
  int zoneCount;
  int zones[6];
  int goTrials;
  int noGoTrials;
};

ProtocolDef protocols[] = {
  {"baseline_v2", "Baseline", 24, 4, 6, {0,1,2,3,4,5}, 24, 0},
  {"left_target_v2", "Left Targets", 18, 3, 3, {0,2,4,0,0,0}, 18, 0},
  {"right_target_v2", "Right Targets", 18, 3, 3, {1,3,5,0,0,0}, 18, 0},
  {"inhibitory_v2", "Go/No-Go", 30, 6, 6, {0,1,2,3,4,5}, 21, 9},
  {"drift_v2", "Long Run", 42, 4, 6, {0,1,2,3,4,5}, 42, 0},
  {"quick_demo_v2", "Quick Demo", 12, 3, 6, {0,1,2,3,4,5}, 9, 3}
};
const int PROTOCOL_COUNT = sizeof(protocols) / sizeof(protocols[0]);
int currentProtocol = 0;

struct PlannedTrial {
  int zone;
  StimClass stim;
  bool included;
  const char* phase;
};

const int MAX_PLAN = 60;
PlannedTrial trialPlan[MAX_PLAN];
int planLength = 0;
int planIndex = 0;
int eventCounter = 0;
String sessionId = "";

PadState state = IDLE;
unsigned long stateStartMs = 0;
unsigned long clearSinceMs = 0;
unsigned long foreperiodStartMs = 0;
unsigned long randomDelayMs = 0;
unsigned long stimulusUs = 0;
unsigned long contactUs = 0;
unsigned long postContactStartMs = 0;

int activeZone = -1;
StimClass activeStim = STIM_GO;
uint8_t contactMask = 0;
int firstPressedZone = -1;
int triggerAdc = 0;
int postContactPeakAdc = 0;
float capturedRtMs = -1;

int countsGoCorrect = 0;
int countsWrongZone = 0;
int countsFalseAlarm = 0;
int countsCorrectWithhold = 0;
int countsMiss = 0;
int countsAnticipation = 0;
int countsFalseStart = 0;
int countsMultiContact = 0;
int countsSensorNotReady = 0;
int countsAborted = 0;

void releaseDisplayOutputs() {
  for (int i = 0; i < 7; i++) pinMode(SEG[i], INPUT);
  for (int i = 0; i < 4; i++) pinMode(DIG[i], INPUT);
  pinMode(PIN_164_DATA, INPUT);
  pinMode(PIN_164_CLOCK, INPUT);
}

void enterUploadSafeMode() {
  releaseDisplayOutputs();
  Serial.println("Upload-safe mode: display pins released. Upload now, or press EN to reboot.");
  while (true) delay(1000);
}

void uploadSafetyWindow() {
  pinMode(BTN, INPUT_PULLUP);
  releaseDisplayOutputs();
  unsigned long start = millis();
  while (millis() - start < BOOT_UPLOAD_WINDOW_MS) delay(10);
  if (digitalRead(BTN) == LOW) {
    unsigned long held = millis();
    while (digitalRead(BTN) == LOW && millis() - held < SAFE_MODE_CONFIRM_MS) delay(10);
    if (digitalRead(BTN) == LOW) enterUploadSafeMode();
  }
}

void IRAM_ATTR refreshDisplay() {
  static uint8_t d = 0;
  for (int i = 0; i < 4; i++) digitalWrite(DIG[i], HIGH);
  uint8_t start = d;
  while (dispBuf[d] == 13) {
    d = (d + 1) % 4;
    if (d == start) return;
  }
  uint8_t pattern = dispBuf[d];
  for (int s = 0; s < 7; s++) digitalWrite(SEG[s], (pattern >> s) & 1);
  digitalWrite(DIG[d], LOW);
  d = (d + 1) % 4;
}

void setRaw(uint8_t d3, uint8_t d2, uint8_t d1, uint8_t d0) {
  noInterrupts();
  dispBuf[0] = d3; dispBuf[1] = d2; dispBuf[2] = d1; dispBuf[3] = d0;
  interrupts();
}

void showNum(int n) {
  if (n < 0 || n > 9999) { setRaw(13, 13, 13, 13); return; }
  int d3 = n / 1000 % 10, d2 = n / 100 % 10, d1 = n / 10 % 10, d0 = n % 10;
  bool show = false;
  uint8_t p3 = 13, p2 = 13, p1 = 13, p0 = FONT[d0];
  if (n >= 1000) show = true;
  if (show) p3 = FONT[d3];
  if (n >= 100 || show) { show = true; p2 = FONT[d2]; }
  if (n >= 10 || show) p1 = FONT[d1];
  setRaw(p3, p2, p1, p0);
}

void showDash() { setRaw(12, 12, 12, 12); }
void showMode(int m) { setRaw(FONT[0], FONT[0], FONT[0], FONT[m]); }

void shiftOut164() {
  shiftOut(PIN_164_DATA, PIN_164_CLOCK, MSBFIRST, ledBuf[1]);
  shiftOut(PIN_164_DATA, PIN_164_CLOCK, MSBFIRST, ledBuf[0]);
}

void zoneLED(int z, bool red, bool green) {
  int base;
  if (z < 4) {
    base = z * 2;
    if (red) ledBuf[0] |= (1 << base); else ledBuf[0] &= ~(1 << base);
    if (green) ledBuf[0] |= (1 << (base + 1)); else ledBuf[0] &= ~(1 << (base + 1));
  } else {
    base = (z - 4) * 2;
    if (red) ledBuf[1] |= (1 << base); else ledBuf[1] &= ~(1 << base);
    if (green) ledBuf[1] |= (1 << (base + 1)); else ledBuf[1] &= ~(1 << (base + 1));
  }
  shiftOut164();
}

void ky009(bool r, bool g, bool b) {
  if (r) ledBuf[1] |= (1 << 4); else ledBuf[1] &= ~(1 << 4);
  if (g) ledBuf[1] |= (1 << 5); else ledBuf[1] &= ~(1 << 5);
  if (b) ledBuf[1] |= (1 << 6); else ledBuf[1] &= ~(1 << 6);
  shiftOut164();
}

void allOff() {
  ledBuf[0] = 0; ledBuf[1] = 0; shiftOut164();
}

void clearTargetZonesKeepRgb() {
  ledBuf[0] = 0;
  ledBuf[1] &= 0b11110000;
  shiftOut164();
}

void oledLine(int line, const String &text, int size = 1) {
  if (!oledReady) return;
  oled.setTextSize(size);
  oled.setTextColor(SSD1306_WHITE);
  oled.setCursor(0, line * 10);
  oled.print(text);
}

void oledStatus(const String &a, const String &b, const String &c = "") {
  if (!oledReady) return;
  oled.clearDisplay();
  oledLine(0, "Smart Reaction Pad v2");
  oledLine(2, a, 1);
  oledLine(3, b, 1);
  if (c.length()) oledLine(5, c, 1);
  oled.display();
}

void notifyLine(const String &line) {
  Serial.println(line);
  if (!deviceConnected || pTxCharacteristic == nullptr) return;
  String payload = line + "\n";
  const size_t chunkSize = 180;
  for (size_t i = 0; i < payload.length(); i += chunkSize) {
    size_t endIndex = i + chunkSize;
    if (endIndex > payload.length()) endIndex = payload.length();
    String chunk = payload.substring(i, endIndex);
    pTxCharacteristic->setValue((uint8_t*)chunk.c_str(), chunk.length());
    pTxCharacteristic->notify();
    delay(6);
  }
}

const char* stateName() {
  switch (state) {
    case IDLE: return "IDLE";
    case CALIBRATING: return "CALIBRATING";
    case WAIT_CLEAR: return "WAIT_CLEAR";
    case READY_FOREPERIOD: return "READY_FOREPERIOD";
    case STIMULUS: return "STIMULUS";
    case POST_CONTACT_SAMPLE: return "POST_CONTACT_SAMPLE";
    case RESULT: return "RESULT";
    case COMPLETE: return "COMPLETE";
    case STOPPED: return "STOPPED";
    default: return "ERROR";
  }
}

void sendStatus() {
  notifyLine("{\"event\":\"status\",\"state\":\"" + String(stateName()) +
    "\",\"protocol_id\":\"" + String(protocols[currentProtocol].id) +
    "\",\"calibrated\":" + String(calibrated ? "true" : "false") + "}");
}

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) { deviceConnected = true; ky009(false, true, false); }
  void onDisconnect(BLEServer *server) { deviceConnected = false; ky009(false, false, true); }
};

class RxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *characteristic) {
    String value = String(characteristic->getValue().c_str());
    if (value.length() > 0) pendingCommand += value;
  }
};

void setupBle() {
  BLEDevice::init(DEVICE_NAME);
  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());
  BLEService *service = pServer->createService(SERVICE_UUID);
  pTxCharacteristic = service->createCharacteristic(CHARACTERISTIC_UUID_TX, BLECharacteristic::PROPERTY_NOTIFY);
  pTxCharacteristic->addDescriptor(new BLE2902());
  BLECharacteristic *rxCharacteristic = service->createCharacteristic(CHARACTERISTIC_UUID_RX, BLECharacteristic::PROPERTY_WRITE);
  rxCharacteristic->setCallbacks(new RxCallbacks());
  service->start();
  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(SERVICE_UUID);
  advertising->setScanResponse(true);
  advertising->setMinPreferred(0x06);
  advertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
}

int readButtonEvent() {
  static bool last = HIGH;
  static bool pressed = false;
  static bool longSent = false;
  static unsigned long downMs = 0;
  bool now = digitalRead(BTN);
  int event = 0;
  if (last == HIGH && now == LOW) {
    pressed = true;
    longSent = false;
    downMs = millis();
  }
  if (pressed && !longSent && now == LOW && millis() - downMs > 800) {
    longSent = true;
    event = 2;
  }
  if (pressed && last == LOW && now == HIGH) {
    if (!longSent && millis() - downMs > 30) event = 1;
    pressed = false;
  }
  last = now;
  return event;
}

bool allReleased() {
  for (int z = 0; z < 6; z++) {
    if (analogRead(FSR_PINS[z]) > releaseThreshold[z]) return false;
  }
  return true;
}

bool anyPressed(int *zoneOut = nullptr, int *adcOut = nullptr, uint8_t *maskOut = nullptr) {
  bool hit = false;
  uint8_t mask = 0;
  int firstZone = -1;
  int firstAdc = 0;
  for (int z = 0; z < 6; z++) {
    int adc = analogRead(FSR_PINS[z]);
    if (adc > pressThreshold[z]) {
      mask |= (1 << z);
      if (!hit) { firstZone = z; firstAdc = adc; }
      hit = true;
    }
  }
  if (zoneOut) *zoneOut = firstZone;
  if (adcOut) *adcOut = firstAdc;
  if (maskOut) *maskOut = mask;
  return hit;
}

void sortInts(int *values, int count) {
  for (int i = 1; i < count; i++) {
    int v = values[i];
    int j = i - 1;
    while (j >= 0 && values[j] > v) { values[j + 1] = values[j]; j--; }
    values[j + 1] = v;
  }
}

bool runCalibration() {
  state = CALIBRATING;
  allOff();
  ky009(true, true, false);
  showDash();
  oledStatus("Calibration", "Release all zones", "Keep mat unloaded");
  int samples[6][CAL_SAMPLES];
  for (int i = 0; i < CAL_SAMPLES; i++) {
    for (int z = 0; z < 6; z++) samples[z][i] = analogRead(FSR_PINS[z]);
    delay(10);
  }

  bool ok = true;
  for (int z = 0; z < 6; z++) {
    int copy[CAL_SAMPLES];
    for (int i = 0; i < CAL_SAMPLES; i++) copy[i] = samples[z][i];
    sortInts(copy, CAL_SAMPLES);
    int median = copy[CAL_SAMPLES / 2];
    int absDev[CAL_SAMPLES];
    for (int i = 0; i < CAL_SAMPLES; i++) absDev[i] = abs(samples[z][i] - median);
    sortInts(absDev, CAL_SAMPLES);
    int mad = absDev[CAL_SAMPLES / 2];
    baselineAdc[z] = median;
    noiseAdc[z] = mad;
    pressThreshold[z] = median + max(MIN_PRESS_DELTA, mad * 8);
    releaseThreshold[z] = median + max(MIN_RELEASE_DELTA, mad * 4);
    if (median > STUCK_HIGH_ADC) ok = false;
  }
  calibrated = ok;
  ky009(false, ok, !ok);
  state = ok ? IDLE : ERROR_STATE;

  String payload = "{\"event\":\"calibration_result\",\"ok\":" + String(ok ? "true" : "false") + ",\"calibration\":{";
  payload += "\"baseline_adc\":["; for (int z = 0; z < 6; z++) { if (z) payload += ","; payload += String(baselineAdc[z]); }
  payload += "],\"noise_mad_adc\":["; for (int z = 0; z < 6; z++) { if (z) payload += ","; payload += String(noiseAdc[z]); }
  payload += "],\"press_threshold_adc\":["; for (int z = 0; z < 6; z++) { if (z) payload += ","; payload += String(pressThreshold[z]); }
  payload += "],\"release_threshold_adc\":["; for (int z = 0; z < 6; z++) { if (z) payload += ","; payload += String(releaseThreshold[z]); }
  payload += "]}}";
  notifyLine(payload);
  oledStatus(ok ? "Calibration passed" : "Calibration failed", ok ? "Ready to start" : "Check FSR baseline");
  return ok;
}

void resetCounts() {
  countsGoCorrect = countsWrongZone = countsFalseAlarm = countsCorrectWithhold = 0;
  countsMiss = countsAnticipation = countsFalseStart = countsMultiContact = 0;
  countsSensorNotReady = countsAborted = 0;
}

void shufflePlan(PlannedTrial *items, int count) {
  for (int i = count - 1; i > 0; i--) {
    int j = random(0, i + 1);
    PlannedTrial temp = items[i];
    items[i] = items[j];
    items[j] = temp;
  }
}

bool hasTripleRepeat(PlannedTrial *items, int count) {
  for (int i = 2; i < count; i++) {
    if (items[i].zone == items[i - 1].zone && items[i].zone == items[i - 2].zone) return true;
  }
  return false;
}

int fillPhase(PlannedTrial *out, const ProtocolDef &p, bool practice) {
  int count = practice ? p.practiceTrials : p.formalTrials;
  int goCount = practice ? (p.noGoTrials > 0 ? max(1, count - 2) : count) : p.goTrials;
  int noGoCount = practice ? (p.noGoTrials > 0 ? count - goCount : 0) : p.noGoTrials;
  for (int i = 0; i < count; i++) {
    out[i].zone = p.zones[i % p.zoneCount];
    out[i].stim = i < goCount ? STIM_GO : STIM_NOGO;
    out[i].included = !practice;
    out[i].phase = practice ? "practice" : "recorded";
  }
  for (int attempt = 0; attempt < 50; attempt++) {
    shufflePlan(out, count);
    if (!hasTripleRepeat(out, count)) break;
  }
  return count;
}

void buildTrialPlan() {
  const ProtocolDef &p = protocols[currentProtocol];
  int n = fillPhase(trialPlan, p, true);
  n += fillPhase(trialPlan + n, p, false);
  planLength = n;
}

void setProtocolById(const String &id) {
  for (int i = 0; i < PROTOCOL_COUNT; i++) {
    if (id == protocols[i].id) {
      currentProtocol = i;
      showMode(i);
      oledStatus("Protocol", protocols[i].label);
      notifyLine("{\"event\":\"mode_ack\",\"protocol_id\":\"" + String(protocols[i].id) + "\",\"protocol_version\":\"2026-07-08-v2\"}");
      return;
    }
  }
  notifyLine("{\"event\":\"error\",\"message\":\"unknown_protocol\"}");
}

void incrementCount(const String &result) {
  if (result == "go_correct") countsGoCorrect++;
  else if (result == "wrong_zone") countsWrongZone++;
  else if (result == "false_alarm") countsFalseAlarm++;
  else if (result == "correct_withhold") countsCorrectWithhold++;
  else if (result == "miss") countsMiss++;
  else if (result == "anticipation") countsAnticipation++;
  else if (result == "false_start") countsFalseStart++;
  else if (result == "multi_contact") countsMultiContact++;
  else if (result == "sensor_not_ready") countsSensorNotReady++;
  else if (result == "aborted") countsAborted++;
}

String pressedZonesJson(uint8_t mask) {
  String s = "[";
  bool first = true;
  for (int z = 0; z < 6; z++) {
    if (mask & (1 << z)) {
      if (!first) s += ",";
      s += String(z);
      first = false;
    }
  }
  s += "]";
  return s;
}

int popcountMask(uint8_t mask) {
  int n = 0;
  for (int z = 0; z < 6; z++) if (mask & (1 << z)) n++;
  return n;
}

void recordTrial(const String &result, bool advancePlan, bool includeOverride) {
  PlannedTrial pt = trialPlan[planIndex];
  bool included = includeOverride && pt.included;
  eventCounter++;
  incrementCount(result);
  clearTargetZonesKeepRgb();
  if (result == "go_correct" || result == "correct_withhold") ky009(false, true, false);
  else if (result == "anticipation" || result == "false_start") ky009(true, true, false);
  else ky009(true, false, false);

  String rtField = capturedRtMs < 0 ? String("null") : String(capturedRtMs, 1);
  String payload = "{\"event\":\"trial\"";
  payload += ",\"session_id\":\"" + sessionId + "\"";
  payload += ",\"protocol_id\":\"" + String(protocols[currentProtocol].id) + "\"";
  payload += ",\"protocol_version\":\"2026-07-08-v2\"";
  payload += ",\"trial\":" + String(eventCounter);
  payload += ",\"plan_index\":" + String(planIndex + 1);
  payload += ",\"total\":" + String(planLength);
  payload += ",\"trial_phase\":\"" + String(pt.phase) + "\"";
  payload += ",\"included_in_analysis\":" + String(included ? "true" : "false");
  payload += ",\"zone\":" + String(pt.zone);
  payload += ",\"zone_name\":\"" + String(ZONE_NAMES[pt.zone]) + "\"";
  payload += ",\"stim_class\":\"" + String(pt.stim == STIM_GO ? "go" : "nogo") + "\"";
  payload += ",\"stim\":\"" + String(pt.stim == STIM_GO ? "RED" : "GREEN") + "\"";
  payload += ",\"pressed_zone\":";
  if (firstPressedZone < 0) payload += "null";
  else payload += String(firstPressedZone);
  payload += ",\"pressed_zone_name\":\"";
  payload += firstPressedZone < 0 ? "--" : ZONE_NAMES[firstPressedZone];
  payload += "\"";
  payload += ",\"pressed_zones\":" + pressedZonesJson(contactMask);
  payload += ",\"first_pressed_zone\":";
  if (firstPressedZone < 0) payload += "null";
  else payload += String(firstPressedZone);
  payload += ",\"contact_mask\":" + String(contactMask);
  payload += ",\"rt_ms\":" + rtField;
  payload += ",\"stimulus_us\":" + String(stimulusUs);
  payload += ",\"contact_us\":" + String(contactUs);
  payload += ",\"result\":\"" + result + "\"";
  payload += ",\"trigger_adc\":" + String(triggerAdc);
  payload += ",\"post_contact_peak_adc\":" + String(postContactPeakAdc);
  payload += ",\"metric_definition\":\"stimulus_to_target_contact\"";
  payload += ",\"time_origin\":\"zone_led_command\"";
  payload += ",\"response_event\":\"fsr_threshold_crossing\"}";
  notifyLine(payload);

  showNum(capturedRtMs >= 0 ? (int)(capturedRtMs + 0.5) : 0);
  if (oledReady) {
    oledStatus(result, "Target: " + String(ZONE_NAMES[pt.zone]), "Pressed: " + String(firstPressedZone < 0 ? "--" : ZONE_NAMES[firstPressedZone]));
  }
  if (advancePlan) planIndex++;
  state = RESULT;
  stateStartMs = millis();
}

void sendSummary(bool completed, const String &stopReason) {
  String payload = "{\"event\":\"summary\"";
  payload += ",\"session_id\":\"" + sessionId + "\"";
  payload += ",\"protocol_id\":\"" + String(protocols[currentProtocol].id) + "\"";
  payload += ",\"completed\":" + String(completed ? "true" : "false");
  if (stopReason.length()) payload += ",\"stop_reason\":\"" + stopReason + "\"";
  payload += ",\"planned_trials\":" + String(protocols[currentProtocol].formalTrials);
  payload += ",\"completed_trials\":" + String(planIndex);
  payload += ",\"counts\":{";
  payload += "\"go_correct\":" + String(countsGoCorrect);
  payload += ",\"wrong_zone\":" + String(countsWrongZone);
  payload += ",\"miss\":" + String(countsMiss);
  payload += ",\"anticipation\":" + String(countsAnticipation);
  payload += ",\"false_alarm\":" + String(countsFalseAlarm);
  payload += ",\"correct_withhold\":" + String(countsCorrectWithhold);
  payload += ",\"false_start\":" + String(countsFalseStart);
  payload += ",\"multi_contact\":" + String(countsMultiContact);
  payload += ",\"sensor_not_ready\":" + String(countsSensorNotReady);
  payload += ",\"aborted\":" + String(countsAborted);
  payload += "}}";
  notifyLine(payload);
}

void stopSession(const String &reason) {
  allOff();
  ky009(true, false, false);
  countsAborted++;
  sendSummary(false, reason);
  state = STOPPED;
  oledStatus("Stopped", reason);
  showDash();
}

void prepareNextTrial() {
  if (planIndex >= planLength) {
    allOff();
    ky009(false, true, false);
    sendSummary(true, "");
    state = COMPLETE;
    oledStatus("Complete", protocols[currentProtocol].label);
    showNum(planIndex);
    return;
  }
  activeZone = trialPlan[planIndex].zone;
  activeStim = trialPlan[planIndex].stim;
  contactMask = 0;
  firstPressedZone = -1;
  triggerAdc = 0;
  postContactPeakAdc = 0;
  capturedRtMs = -1;
  stimulusUs = 0;
  contactUs = 0;
  allOff();
  ky009(true, true, false);
  showDash();
  oledStatus(trialPlan[planIndex].included ? "Recorded trial" : "Practice trial", "Get ready", "Wait for target");
  clearSinceMs = 0;
  state = WAIT_CLEAR;
}

void startSession(const String &sid) {
  if (!calibrated) {
    notifyLine("{\"event\":\"error\",\"message\":\"calibration_required\"}");
    return;
  }
  sessionId = sid.length() ? sid : "session_esp32";
  buildTrialPlan();
  resetCounts();
  planIndex = 0;
  eventCounter = 0;
  randomSeed(micros() ^ analogRead(34));
  notifyLine("{\"event\":\"started\",\"session_id\":\"" + sessionId +
    "\",\"protocol_id\":\"" + String(protocols[currentProtocol].id) +
    "\",\"protocol_version\":\"2026-07-08-v2\",\"planned_trials\":" + String(protocols[currentProtocol].formalTrials) + "}");
  prepareNextTrial();
}

String extractStringField(const String &cmd, const String &key) {
  int keyPos = cmd.indexOf("\"" + key + "\"");
  if (keyPos < 0) return "";
  int colon = cmd.indexOf(':', keyPos);
  int firstQuote = cmd.indexOf('"', colon + 1);
  int secondQuote = cmd.indexOf('"', firstQuote + 1);
  if (colon < 0 || firstQuote < 0 || secondQuote < 0) return "";
  return cmd.substring(firstQuote + 1, secondQuote);
}

int extractIntField(const String &cmd, const String &key, int fallback) {
  int keyPos = cmd.indexOf("\"" + key + "\"");
  if (keyPos < 0) return fallback;
  int colon = cmd.indexOf(':', keyPos);
  if (colon < 0) return fallback;
  return cmd.substring(colon + 1).toInt();
}

void parseCommand(const String &cmd) {
  if (cmd.indexOf("\"calibrate\"") >= 0) {
    runCalibration();
    sendStatus();
    return;
  }
  if (cmd.indexOf("\"set_protocol\"") >= 0) {
    if (state != IDLE && state != COMPLETE && state != STOPPED && state != ERROR_STATE) {
      notifyLine("{\"event\":\"error\",\"message\":\"cannot_change_protocol_while_running\"}");
      return;
    }
    setProtocolById(extractStringField(cmd, "protocol_id"));
    return;
  }
  if (cmd.indexOf("\"set_mode\"") >= 0) {
    int m = extractIntField(cmd, "mode", 0);
    if (m >= 0 && m < PROTOCOL_COUNT) {
      currentProtocol = m;
      notifyLine("{\"event\":\"mode_ack\",\"protocol_id\":\"" + String(protocols[currentProtocol].id) + "\",\"protocol_version\":\"2026-07-08-v2\"}");
    }
    return;
  }
  if (cmd.indexOf("\"start\"") >= 0) {
    startSession(extractStringField(cmd, "session_id"));
    return;
  }
  if (cmd.indexOf("\"stop\"") >= 0) {
    stopSession(extractStringField(cmd, "reason").length() ? extractStringField(cmd, "reason") : "web_stop");
  }
}

void processCommands() {
  int newline = pendingCommand.indexOf('\n');
  while (newline >= 0) {
    String cmd = pendingCommand.substring(0, newline);
    cmd.trim();
    pendingCommand = pendingCommand.substring(newline + 1);
    if (cmd.length()) parseCommand(cmd);
    newline = pendingCommand.indexOf('\n');
  }
}

void handleWaitClear() {
  if (allReleased()) {
    if (clearSinceMs == 0) clearSinceMs = millis();
    if (millis() - clearSinceMs >= SENSOR_CLEAR_MS) {
      randomDelayMs = random(MIN_DELAY_MS, MAX_DELAY_MS + 1);
      foreperiodStartMs = millis();
      state = READY_FOREPERIOD;
      sendStatus();
    }
  } else {
    clearSinceMs = 0;
  }
}

void handleForeperiod() {
  int z = -1, adc = 0;
  uint8_t mask = 0;
  if (anyPressed(&z, &adc, &mask)) {
    firstPressedZone = z;
    contactMask = mask;
    triggerAdc = adc;
    postContactPeakAdc = adc;
    capturedRtMs = -1;
    recordTrial("false_start", false, false);
    return;
  }
  if (millis() - foreperiodStartMs >= randomDelayMs) {
    if (activeStim == STIM_GO) zoneLED(activeZone, true, false);
    else zoneLED(activeZone, false, true);
    ky009(false, false, false);
    stimulusUs = micros();
    state = STIMULUS;
    showNum(0);
  }
}

void handleStimulus() {
  unsigned long nowUs = micros();
  float elapsedMs = (nowUs - stimulusUs) / 1000.0;
  if (elapsedMs > TIMEOUT_MS) {
    contactMask = 0;
    firstPressedZone = -1;
    capturedRtMs = -1;
    contactUs = 0;
    triggerAdc = 0;
    postContactPeakAdc = 0;
    recordTrial(activeStim == STIM_NOGO ? "correct_withhold" : "miss", true, true);
    return;
  }

  int z = -1, adc = 0;
  uint8_t mask = 0;
  if (anyPressed(&z, &adc, &mask)) {
    firstPressedZone = z;
    contactMask = mask;
    triggerAdc = adc;
    postContactPeakAdc = adc;
    contactUs = nowUs;
    capturedRtMs = (contactUs - stimulusUs) / 1000.0;
    postContactStartMs = millis();
    state = POST_CONTACT_SAMPLE;
  }
}

void handlePostContactSample() {
  uint8_t newMask = contactMask;
  bool withinMultiContactWindow = millis() - postContactStartMs <= MULTI_CONTACT_WINDOW_MS;
  for (int z = 0; z < 6; z++) {
    int adc = analogRead(FSR_PINS[z]);
    if (withinMultiContactWindow && adc > pressThreshold[z]) newMask |= (1 << z);
    if (adc > postContactPeakAdc) postContactPeakAdc = adc;
  }
  contactMask = newMask;
  if (millis() - postContactStartMs < POST_CONTACT_SAMPLE_MS) return;

  String result;
  if (popcountMask(contactMask) > 1) result = "multi_contact";
  else if (capturedRtMs < ANTICIPATION_MS) result = "anticipation";
  else if (activeStim == STIM_NOGO) result = "false_alarm";
  else if (firstPressedZone != activeZone) result = "wrong_zone";
  else result = "go_correct";
  recordTrial(result, true, true);
}

void setup() {
  Serial.begin(115200);
  uploadSafetyWindow();
  pinMode(PIN_164_DATA, OUTPUT);
  pinMode(PIN_164_CLOCK, OUTPUT);
  pinMode(BTN, INPUT_PULLUP);
  for (int i = 0; i < 7; i++) { pinMode(SEG[i], OUTPUT); digitalWrite(SEG[i], LOW); }
  for (int i = 0; i < 4; i++) { pinMode(DIG[i], OUTPUT); digitalWrite(DIG[i], HIGH); }
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  Wire.begin(21, 22);
  oledReady = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR);
  if (!oledReady) oledReady = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDR_ALT);
  if (oledReady) { oled.clearDisplay(); oled.display(); }
  else Serial.println("OLED not found at 0x3C/0x3D.");

  dispTimer = timerBegin(1000000);
  timerAttachInterrupt(dispTimer, &refreshDisplay);
  timerAlarm(dispTimer, 1000, true, 0);

  allOff();
  ky009(false, false, true);
  setRaw(FONT[8], FONT[8], FONT[8], FONT[8]);
  delay(500);
  allOff();
  showMode(currentProtocol);
  setupBle();
  oledStatus("Waiting for BLE", "Calibrate before test");
  Serial.println("Smart Reaction Pad BLE v2 ready");
}

void loop() {
  processCommands();

  if (!deviceConnected && oldDeviceConnected) {
    delay(500);
    pServer->startAdvertising();
    oldDeviceConnected = false;
    oledStatus("BLE disconnected", "Waiting");
  }
  if (deviceConnected && !oldDeviceConnected) {
    oldDeviceConnected = true;
    oledStatus("BLE connected", calibrated ? "Ready" : "Calibrate first");
    sendStatus();
  }

  int btn = readButtonEvent();
  if (btn == 1 && state != IDLE && state != COMPLETE && state != STOPPED && state != ERROR_STATE) {
    stopSession("local_button");
    return;
  }
  if (state == IDLE && btn == 1) {
    if (!calibrated) runCalibration();
    else startSession("session_local_button");
  } else if ((state == IDLE || state == COMPLETE || state == STOPPED) && btn == 2) {
    currentProtocol = (currentProtocol + 1) % PROTOCOL_COUNT;
    showMode(currentProtocol);
    oledStatus("Protocol", protocols[currentProtocol].label);
    sendStatus();
  }

  switch (state) {
    case WAIT_CLEAR: handleWaitClear(); break;
    case READY_FOREPERIOD: handleForeperiod(); break;
    case STIMULUS: handleStimulus(); break;
    case POST_CONTACT_SAMPLE: handlePostContactSample(); break;
    case RESULT:
      if (millis() - stateStartMs > 1300) prepareNextTrial();
      break;
    default:
      break;
  }
}
