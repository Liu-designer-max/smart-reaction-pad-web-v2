import { SmartPadBle } from "./ble.js";
import { PROTOCOLS, generateTrialPlan, getProtocol, ZONES } from "./protocols.js";
import {
  mean,
  median,
  iqr,
  sd,
  summarizeSteppingTrials,
  summarizeSpatialSides,
  summarizeGoNoGo,
  summarizePerformanceDrift,
  validGoSrtTrials,
} from "./metrics.js";
import {
  createAssessment,
  createSession,
  normalizeTrial,
  buildExportPayload,
  buildCsv,
} from "./session-store.js";
import { UI_STATES, controlsForState, canStartHardware } from "./ui-state.js";

const els = {
  connectionStatus: document.querySelector("#connectionStatus"),
  uiState: document.querySelector("#uiState"),
  protocolSelect: document.querySelector("#protocolSelect"),
  participantInput: document.querySelector("#participantInput"),
  injuredSideInput: document.querySelector("#injuredSideInput"),
  footwearInput: document.querySelector("#footwearInput"),
  connectButton: document.querySelector("#connectButton"),
  calibrateButton: document.querySelector("#calibrateButton"),
  startButton: document.querySelector("#startButton"),
  stopButton: document.querySelector("#stopButton"),
  demoButton: document.querySelector("#demoButton"),
  exportJsonButton: document.querySelector("#exportJsonButton"),
  exportCsvButton: document.querySelector("#exportCsvButton"),
  bleHint: document.querySelector("#bleHint"),
  timer: document.querySelector("#sessionTimer"),
  trialCounter: document.querySelector("#trialCounter"),
  lastSrt: document.querySelector("#lastSrt"),
  triggerSignal: document.querySelector("#triggerSignal"),
  trialTable: document.querySelector("#trialTable"),
  srtSummary: document.querySelector("#srtSummary"),
  srtInterpretation: document.querySelector("#srtInterpretation"),
  spatialScore: document.querySelector("#spatialScore"),
  spatialInterpretation: document.querySelector("#spatialInterpretation"),
  spatialBar: document.querySelector("#spatialBar"),
  inhibitionScore: document.querySelector("#inhibitionScore"),
  inhibitionInterpretation: document.querySelector("#inhibitionInterpretation"),
  commissionRate: document.querySelector("#commissionRate"),
  rejectionRate: document.querySelector("#rejectionRate"),
  driftScore: document.querySelector("#driftScore"),
  driftInterpretation: document.querySelector("#driftInterpretation"),
  zoneHeatmap: document.querySelector("#zoneHeatmap"),
  srtChart: document.querySelector("#srtChart"),
};

const app = {
  uiState: UI_STATES.DISCONNECTED,
  ble: null,
  connected: false,
  calibrated: false,
  calibration: null,
  currentSession: null,
  assessment: createAssessment(),
  timerId: null,
  startTime: null,
  pendingAck: null,
  demoId: null,
  demoActive: false,
};

function setHint(message) {
  els.bleHint.textContent = message;
}

function setUiState(nextState) {
  app.uiState = nextState;
  els.uiState.textContent = nextState;
  els.connectionStatus.dataset.state =
    nextState === UI_STATES.ERROR ? "error" :
    app.demoActive ? "demo" :
    nextState === UI_STATES.RUNNING ? "online" :
    app.connected ? "online" : "offline";
  els.connectionStatus.querySelector("strong").textContent =
    app.demoActive ? "Demo Mode" :
    app.connected ? "BLE Connected" : "Disconnected";
  const controls = controlsForState(nextState);
  els.connectButton.disabled = controls.connectDisabled;
  els.calibrateButton.disabled = controls.calibrateDisabled;
  els.startButton.disabled = controls.startDisabled;
  els.stopButton.disabled = controls.stopDisabled;
  els.demoButton.disabled = controls.demoDisabled;
  els.protocolSelect.disabled = controls.protocolDisabled;
  els.participantInput.disabled = controls.participantDisabled;
  els.injuredSideInput.disabled = controls.participantDisabled;
  els.footwearInput.disabled = controls.participantDisabled;
}

function formatMs(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : "-- ms";
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : "--";
}

function formatNumber(value, digits = 0) {
  return Number.isFinite(value) ? value.toFixed(digits) : "--";
}

function beginTimer() {
  app.startTime = Date.now();
  clearInterval(app.timerId);
  app.timerId = setInterval(updateTimer, 500);
  updateTimer();
}

function stopTimer() {
  clearInterval(app.timerId);
  app.timerId = null;
}

function updateTimer() {
  if (!app.startTime) {
    els.timer.textContent = "00:00";
    return;
  }
  const elapsed = Math.floor((Date.now() - app.startTime) / 1000);
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  els.timer.textContent = `${minutes}:${seconds}`;
}

function currentTrials() {
  return app.currentSession?.trials || [];
}

function isRecordedTrial(trial) {
  return trial?.trial_phase === "recorded" && trial.included_in_analysis === true;
}

function plannedRecordedCount(session = app.currentSession) {
  return session?.trial_plan?.filter(isRecordedTrial).length || 0;
}

function completedRecordedCount(session = app.currentSession) {
  return session?.trials?.filter(isRecordedTrial).length || 0;
}

function canAcceptTrial(session, trial) {
  if (!session || !trial) return false;
  if (trial.session_id && trial.session_id !== session.session_id) return false;
  if (!isRecordedTrial(trial)) return true;
  return completedRecordedCount(session) < plannedRecordedCount(session);
}

function populateProtocols() {
  els.protocolSelect.innerHTML = Object.values(PROTOCOLS)
    .map((protocol) => `<option value="${protocol.id}">${protocol.label} - ${protocol.optionText}</option>`)
    .join("");
}

function refreshAssessmentMeta() {
  app.assessment.participant.anonymous_id = els.participantInput.value.trim() || "anonymous-001";
  app.assessment.participant.injured_side = els.injuredSideInput.value;
  app.assessment.conditions.footwear = els.footwearInput.value;
}

function createNewSession() {
  refreshAssessmentMeta();
  const protocolId = els.protocolSelect.value;
  const trialPlan = generateTrialPlan(protocolId, `${Date.now()}:${app.assessment.assessment_id}`);
  const session = createSession(protocolId, { calibration: app.calibration, trial_plan: trialPlan });
  session.assessment_id = app.assessment.assessment_id;
  app.currentSession = session;
  app.assessment.sessions.push(session);
  return session;
}

function clearZones() {
  document.querySelectorAll(".zone").forEach((zone) => {
    zone.classList.remove("active", "go", "nogo", "error", "pressed");
  });
}

function flashLastTrial(trial) {
  clearZones();
  if (trial.zone === null || trial.zone === undefined) return;
  const target = document.querySelector(`.zone[data-zone="${trial.zone}"]`);
  if (target) {
    target.classList.add("active");
    if (trial.stim_class === "go") target.classList.add("go");
    if (trial.stim_class === "nogo") target.classList.add("nogo");
    if (!["go_correct", "correct_withhold"].includes(trial.result)) target.classList.add("error");
  }
  for (const zoneId of trial.pressed_zones || []) {
    const pressed = document.querySelector(`.zone[data-zone="${zoneId}"]`);
    pressed?.classList.add("pressed");
  }
}

function waitForAck(types, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const expected = Array.isArray(types) ? types : [types];
    const timer = window.setTimeout(() => {
      app.pendingAck = null;
      reject(new Error(`Timed out waiting for ${expected.join("/")}`));
    }, timeoutMs);
    app.pendingAck = {
      expected,
      resolve: (event) => {
        window.clearTimeout(timer);
        app.pendingAck = null;
        resolve(event);
      },
    };
  });
}

function resolveAck(event) {
  if (app.pendingAck?.expected.includes(event.event)) {
    app.pendingAck.resolve(event);
  }
}

function handleBleEvent(event) {
  if (!event || typeof event !== "object") return;
  resolveAck(event);

  if (event.event === "status") {
    if (event.state === "READY" && app.connected) setUiState(app.calibrated ? UI_STATES.READY : UI_STATES.CONNECTED);
    render();
    return;
  }

  if (event.event === "calibration_result") {
    app.calibration = event.calibration || event;
    app.calibrated = event.ok !== false;
    setUiState(app.calibrated ? UI_STATES.READY : UI_STATES.ERROR);
    setHint(app.calibrated ? "Calibration passed. You can start the test." : "Calibration failed. Check the FSR pads and keep all zones unloaded.");
    render();
    return;
  }

  if (event.event === "started") {
    app.currentSession.started_at = new Date().toISOString();
    beginTimer();
    setUiState(UI_STATES.RUNNING);
    setHint("Test running. Red means step. Green means hold.");
    render();
    return;
  }

  if (event.event === "trial") {
    if (!app.currentSession) createNewSession();
    const trial = normalizeTrial(event, {
      session_id: app.currentSession.session_id,
      protocol_id: app.currentSession.protocol_id,
      nextTrial: app.currentSession.trials.length + 1,
      total: app.currentSession.trial_plan.length,
    });
    if (!canAcceptTrial(app.currentSession, trial)) {
      setHint("Extra trial event ignored because this session is already complete.");
      render();
      return;
    }
    app.currentSession.trials.push(trial);
    flashLastTrial(trial);
    render();
    return;
  }

  if (event.event === "summary" || event.event === "stopped") {
    if (app.currentSession) {
      app.currentSession.firmware_summary = event;
      app.currentSession.completed = event.completed !== false && event.event !== "stopped";
      app.currentSession.stop_reason = event.stop_reason || null;
      app.currentSession.completed_at = new Date().toISOString();
    }
    stopTimer();
    setUiState(event.completed === false || event.event === "stopped" ? UI_STATES.STOPPED : UI_STATES.COMPLETE);
    setHint(event.stop_reason ? `Session stopped: ${event.stop_reason}. Current results are still saved.` : "Session complete.");
    render();
    return;
  }

  if (event.event === "error") {
    stopTimer();
    setUiState(UI_STATES.ERROR);
    setHint(event.message || "Device reported an error.");
    render();
  }
}

async function connectBle() {
  try {
    app.ble = new SmartPadBle({
      onEvent: handleBleEvent,
      onDisconnect: () => {
        app.connected = false;
        stopTimer();
        setUiState(UI_STATES.ERROR);
        setHint("BLE disconnected. Reconnect before starting another hardware test.");
        if (app.currentSession && app.uiState === UI_STATES.RUNNING) {
          app.currentSession.completed = false;
          app.currentSession.stop_reason = "connection_lost";
        }
      },
      onHint: setHint,
    });
    await app.ble.connect();
    app.connected = true;
    app.calibrated = false;
    setUiState(UI_STATES.CONNECTED);
    setHint("Connected. Calibrate the mat before starting a test.");
  } catch (error) {
    setUiState(UI_STATES.ERROR);
    setHint(error.message);
  }
}

async function calibrate() {
  if (!app.connected) {
    setHint("Connect BLE before calibration.");
    return;
  }
  try {
    setUiState(UI_STATES.CALIBRATING);
    setHint("Keep all six FSR zones unloaded during calibration.");
    const calibrationAck = waitForAck("calibration_result", 9000);
    await app.ble.send({ cmd: "calibrate" });
    await calibrationAck;
  } catch (error) {
    setUiState(UI_STATES.ERROR);
    setHint(error.message);
  }
}

async function startHardwareSession() {
  if (!canStartHardware(app.uiState, app.connected, app.calibrated)) {
    setHint("Connect BLE and pass calibration before using the hardware. Use Run Demo without hardware.");
    return;
  }
  const session = createNewSession();
  try {
    setUiState(UI_STATES.STARTING);
    const modeAck = waitForAck("mode_ack", 5000);
    await app.ble.send({ cmd: "set_protocol", protocol_id: session.protocol_id });
    await modeAck;
    const startedAck = waitForAck("started", 5000);
    await app.ble.send({
      cmd: "start",
      session_id: session.session_id,
      protocol_id: session.protocol_id,
      protocol_version: session.protocol_version,
    });
    await startedAck;
  } catch (error) {
    setUiState(UI_STATES.ERROR);
    setHint(error.message);
  }
}

async function stopSession() {
  window.clearInterval(app.demoId);
  app.demoId = null;
  app.demoActive = false;
  stopTimer();
  if (app.currentSession) {
    app.currentSession.completed = false;
    app.currentSession.stop_reason = "web_stop";
    app.currentSession.completed_at = new Date().toISOString();
  }
  if (app.connected && app.ble) {
    try {
      await app.ble.send({ cmd: "stop", reason: "web_stop" });
    } catch (error) {
      console.warn(error);
    }
  }
  setUiState(UI_STATES.STOPPED);
  setHint("Stopped. Current results are still saved.");
  render();
}

function demoTrialFromPlan(planTrial, session, index) {
  const isGo = planTrial.stim_class === "go";
  const rand = Math.sin(index * 9.17 + 2.2) * 0.5 + 0.5;
  if (!isGo) {
    const falseAlarm = rand < 0.22;
    return normalizeTrial({
      ...planTrial,
      session_id: session.session_id,
      result: falseAlarm ? "false_alarm" : "correct_withhold",
      rt_ms: falseAlarm ? 360 + rand * 240 : null,
      pressed_zone: falseAlarm ? planTrial.zone : null,
      pressed_zones: falseAlarm ? [planTrial.zone] : [],
      trigger_adc: falseAlarm ? Math.round(700 + rand * 900) : null,
      post_contact_peak_adc: falseAlarm ? Math.round(1400 + rand * 1000) : null,
    }, session);
  }
  const miss = rand > 0.92;
  const wrong = rand > 0.82 && rand <= 0.92;
  const anticipation = rand < 0.04;
  let result = "go_correct";
  if (miss) result = "miss";
  if (wrong) result = "wrong_zone";
  if (anticipation) result = "anticipation";
  const pressedZone = wrong ? (planTrial.zone + 1) % 6 : planTrial.zone;
  return normalizeTrial({
    ...planTrial,
    session_id: session.session_id,
    result,
    rt_ms: miss ? null : anticipation ? 42 : 390 + rand * 280,
    pressed_zone: miss ? null : pressedZone,
    pressed_zones: miss ? [] : [pressedZone],
    trigger_adc: miss ? null : Math.round(650 + rand * 1100),
    post_contact_peak_adc: miss ? null : Math.round(1300 + rand * 1500),
  }, session);
}

function runDemo() {
  window.clearInterval(app.demoId);
  app.demoId = null;
  app.demoActive = true;
  app.calibrated = true;
  app.calibration = {
    ok: true,
    source: "demo",
    baseline_adc: [41, 46, 39, 44, 48, 43],
    press_threshold_adc: [320, 330, 315, 335, 340, 325],
    release_threshold_adc: [180, 185, 176, 190, 188, 182],
  };
  const session = createNewSession();
  session.started_at = new Date().toISOString();
  beginTimer();
  setUiState(UI_STATES.RUNNING);
  setHint("Demo mode is running sample trials without hardware.");
  let index = 0;
  const finishDemo = () => {
    window.clearInterval(app.demoId);
    app.demoId = null;
    app.demoActive = false;
    session.completed = true;
    session.completed_at = new Date().toISOString();
    stopTimer();
    setUiState(UI_STATES.COMPLETE);
    setHint("Demo complete. You can export the results as JSON or CSV.");
    render();
  };
  app.demoId = window.setInterval(() => {
    if (index >= session.trial_plan.length) {
      finishDemo();
      return;
    }
    const planTrial = session.trial_plan[index];
    const trial = demoTrialFromPlan(planTrial, session, index);
    if (canAcceptTrial(session, trial)) {
      session.trials.push(trial);
      flashLastTrial(trial);
    }
    index += 1;
    render();
    if (index >= session.trial_plan.length) {
      finishDemo();
    }
  }, 360);
}

function tagForResult(result) {
  if (["go_correct", "correct_withhold"].includes(result)) return "ok";
  if (["anticipation", "false_start", "multi_contact"].includes(result)) return "warn";
  return "bad";
}

function labelForResult(result) {
  const labels = {
    go_correct: "correct step",
    wrong_zone: "wrong zone",
    false_alarm: "stepped on green",
    correct_withhold: "held correctly",
    miss: "missed",
    anticipation: "too early",
    false_start: "early step",
    multi_contact: "multi-zone",
    sensor_not_ready: "sensor not ready",
    aborted: "stopped",
    unknown: "unknown",
    invalid_data: "invalid",
  };
  return labels[result] || result || "--";
}

function labelForFlag(flag) {
  if (!flag) return "";
  return String(flag)
    .replace(/^missing_/, "missing ")
    .replace(/_/g, " ");
}

function labelForPart(part) {
  if (part === "practice") return "Practice";
  if (part === "recorded") return "Test";
  return part || "--";
}

function labelForLight(trial) {
  if (trial.stim_class === "go") return "Red step";
  if (trial.stim_class === "nogo") return "Green hold";
  return trial.stim || "--";
}

function renderCounters() {
  const trials = currentTrials();
  const last = trials.at(-1);
  const recordedPlan = plannedRecordedCount();
  const recorded = Math.min(completedRecordedCount(), recordedPlan);
  els.trialCounter.textContent = `${recorded} / ${recordedPlan}`;
  els.lastSrt.textContent = last && Number.isFinite(last.rt_ms) ? formatMs(last.rt_ms) : "-- ms";
  els.triggerSignal.textContent = last?.trigger_adc ? `${last.trigger_adc} ADC` : "--";
}

function renderTable() {
  const trials = currentTrials();
  if (!trials.length) {
    els.trialTable.innerHTML = `<tr><td colspan="8" class="empty">No trials yet</td></tr>`;
    return;
  }
  els.trialTable.innerHTML = trials.slice().reverse().map((trial) => `
    <tr>
      <td>${trial.trial}</td>
      <td>${labelForPart(trial.trial_phase)}</td>
      <td>${trial.zone_name}</td>
      <td>${labelForLight(trial)}</td>
      <td>${trial.pressed_zones.length ? trial.pressed_zones.map((z) => ZONES[z]?.name || z).join("|") : "--"}</td>
      <td>${formatMs(trial.rt_ms)}</td>
      <td><span class="tag ${tagForResult(trial.result)}">${labelForResult(trial.result)}</span></td>
      <td>${trial.quality_flags.length ? trial.quality_flags.map(labelForFlag).join("; ") : "--"}</td>
    </tr>
  `).join("");
}

function renderAnalysis() {
  const trials = currentTrials();
  const stepping = summarizeSteppingTrials(trials);
  els.srtSummary.textContent = formatMs(stepping.median_ms);
  els.srtInterpretation.textContent = stepping.n
    ? `Median ${formatMs(stepping.median_ms)}, middle spread ${formatMs(stepping.iqr_ms)}, average ${formatMs(stepping.mean_ms)}.`
    : "Time from target light to foot contact. It includes seeing, deciding, moving, and stepping.";

  const spatial = summarizeSpatialSides(trials);
  if (Number.isFinite(spatial.signed_difference_ms)) {
    els.spatialScore.textContent = `${spatial.signed_difference_ms > 0 ? "+" : ""}${Math.round(spatial.signed_difference_ms)} ms`;
    els.spatialInterpretation.textContent = `Left targets ${formatMs(spatial.left_median_ms)} (n=${spatial.left_n}); right targets ${formatMs(spatial.right_median_ms)} (n=${spatial.right_n}). Positive means right targets were slower.`;
    els.spatialBar.style.width = `${Math.min(100, Math.abs(spatial.signed_difference_ms))}%`;
  } else {
    els.spatialScore.textContent = "--";
    els.spatialInterpretation.textContent = "Run both left and right target zones to compare sides. This does not identify which leg was used.";
    els.spatialBar.style.width = "0";
  }

  const inhibitory = summarizeGoNoGo(trials);
  els.inhibitionScore.textContent = inhibitory.go_trials || inhibitory.nogo_trials ? formatPercent(inhibitory.go_hit_rate) : "--";
  els.commissionRate.textContent = formatPercent(inhibitory.nogo_commission_rate);
  els.rejectionRate.textContent = formatPercent(inhibitory.correct_rejection_rate);
  els.inhibitionInterpretation.textContent = inhibitory.go_trials || inhibitory.nogo_trials
    ? `Red Go accuracy ${formatPercent(inhibitory.go_hit_rate)}, missed Go trials ${formatPercent(inhibitory.go_omission_rate)}, Go median ${formatMs(inhibitory.go_median_ms)}.`
    : "Red trials measure stepping. Green trials measure holding back.";

  const drift = summarizePerformanceDrift(trials);
  els.driftScore.textContent = Number.isFinite(drift.drift_percent) ? `${drift.drift_percent.toFixed(0)}%` : "--";
  els.driftInterpretation.textContent = Number.isFinite(drift.drift_percent)
    ? `Early median ${formatMs(drift.early_median_ms)}, late median ${formatMs(drift.late_median_ms)}, trend ${formatNumber(drift.slope_ms_per_trial, 1)} ms per trial.`
    : "At least six valid Go trials are needed to show long-run change.";
}

function renderChart() {
  const canvas = els.srtChart;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f8fafb";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const valid = validGoSrtTrials(currentTrials());
  if (!valid.length) return;
  const values = valid.map((trial) => trial.rt_ms);
  const max = Math.max(800, ...values);
  ctx.strokeStyle = "#0f766e";
  ctx.lineWidth = 3;
  ctx.beginPath();
  valid.forEach((trial, index) => {
    const x = 32 + (index / Math.max(1, valid.length - 1)) * (canvas.width - 64);
    const y = canvas.height - 24 - (trial.rt_ms / max) * (canvas.height - 56);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function renderHeatmap() {
  const valid = validGoSrtTrials(currentTrials());
  els.zoneHeatmap.innerHTML = ZONES.map((zone) => {
    const values = valid.filter((trial) => trial.zone === zone.id).map((trial) => trial.rt_ms);
    const zoneMedian = median(values);
    return `<div class="heat-cell"><span>${zone.name}</span><strong>${formatMs(zoneMedian)}</strong><small>n=${values.length}</small></div>`;
  }).join("");
}

function render() {
  renderCounters();
  renderTable();
  renderAnalysis();
  renderChart();
  renderHeatmap();
}

function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportJson() {
  download("smart-reaction-pad-v2-assessment.json", JSON.stringify(buildExportPayload(app.assessment), null, 2), "application/json");
}

function exportCsv() {
  download("smart-reaction-pad-v2-trials.csv", buildCsv(app.assessment.sessions), "text/csv");
}

els.connectButton.addEventListener("click", connectBle);
els.calibrateButton.addEventListener("click", calibrate);
els.startButton.addEventListener("click", startHardwareSession);
els.stopButton.addEventListener("click", stopSession);
els.demoButton.addEventListener("click", runDemo);
els.exportJsonButton.addEventListener("click", exportJson);
els.exportCsvButton.addEventListener("click", exportCsv);
els.protocolSelect.addEventListener("change", () => {
  const protocol = getProtocol(els.protocolSelect.value);
  setHint(`${protocol.label}: ${protocol.description}`);
});

populateProtocols();
setUiState(UI_STATES.DISCONNECTED);
if (!navigator.bluetooth) {
  setHint("Web Bluetooth is unavailable in this browser. Use Bluefy on iPhone or Chrome/Edge on desktop/Android, or run demo mode.");
}
render();
