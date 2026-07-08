# Smart Reaction Pad Web v2

Scientific revision of the Smart Reaction Pad web + BLE demo for a biomedical engineering wearable-device course.

This version preserves the original hardware wiring while tightening the measurement definition, protocol control, data quality flags, and biomedical interpretation. It is an educational prototype for sport rehabilitation and return-to-play discussion support. It is not a medical diagnosis or clinical clearance tool.

## What v2 Measures

The primary timing metric is **Stepping Response Time (SRT)**, also named **Stimulus-to-Contact Time**:

```text
zone LED command -> first FSR threshold crossing
```

This is not pure neural reaction time. It includes visual perception, response selection, posture adjustment, stepping movement, foot contact, sensor threshold crossing, and firmware sampling latency.

FSR ADC values are reported as:

- `trigger_adc`: relative ADC value at threshold detection.
- `post_contact_peak_adc`: relative ADC peak sampled after contact.

They are relative sensor signals only, not Newtons, kg, ground reaction force, or calibrated force.

## Hardware Match

No GPIO or wiring changes are required from v1:

- ESP32 Dev Module
- 6 FSR pressure sensors on ADC1 pins
- 2x 74HC164N shift registers
- 12 zone LEDs
- R/G/B/GND common-cathode RGB status LED
- SSD1306 I2C OLED
- 4-digit seven-segment display
- Button on GPIO 19

Zone labels:

| Zone | Label | Position |
| --- | --- | --- |
| 0 | LF | Left front |
| 1 | RF | Right front |
| 2 | LR | Left rear |
| 3 | RR | Right rear |
| 4 | LL | Left lateral |
| 5 | RL | Right lateral |

## Protocol v2

The project keeps the established colour rule:

```text
Red zone LED = Go / step on the target
Green zone LED = No-Go / do not step
```

This is a reverse colour-response mapping compared with common traffic-light intuition, so v2 includes practice trials before recorded trials.

Protocols:

| Protocol | Recorded trials | Purpose |
| --- | ---: | --- |
| `baseline_v2` | 24 | Balanced six-zone SRT |
| `left_target_v2` | 18 | Left-target spatial performance |
| `right_target_v2` | 18 | Right-target spatial performance |
| `inhibitory_v2` | 30 | Go/No-Go inhibitory stepping |
| `drift_v2` | 42 | Repeated-trial performance drift |
| `quick_demo_v2` | 12 | Short classroom demo |

## Scientific Changes from v1

- Removed clinical-style LSI labels and thresholds. The dashboard now reports **Spatial Side Comparison** because the device knows target side, not which leg was used.
- Renamed Dual Task to **Inhibitory Stepping**. Go/No-Go tests response inhibition, not a full dual-task protocol with independent cognitive performance.
- Renamed Fatigue to **Repeated-Trial Performance Drift**. Later-trial slowing is descriptive and not specific to physiological fatigue.
- Added six-zone independent FSR calibration and per-zone thresholds.
- Added sensor-clear, foreperiod false-start detection, explicit result categories, multi-contact detection, and command acknowledgements.
- Uses median and IQR as primary timing descriptors.
- Missing key fields are marked `invalid_data` and never assumed correct.

## BLE UART Protocol

UUIDs are unchanged from v1:

| Role | UUID |
| --- | --- |
| Service | `6E400001-B5A3-F393-E0A9-E50E24DCCA9E` |
| RX write | `6E400002-B5A3-F393-E0A9-E50E24DCCA9E` |
| TX notify | `6E400003-B5A3-F393-E0A9-E50E24DCCA9E` |

Browser commands:

```json
{"cmd":"calibrate"}
{"cmd":"set_protocol","protocol_id":"inhibitory_v2"}
{"cmd":"start","session_id":"session_x","protocol_id":"inhibitory_v2"}
{"cmd":"stop","reason":"web_stop"}
```

Trial events include protocol metadata, stimulus class, pressed zones, SRT, and data-quality fields.

## Local Testing

No build step is required. Use any static server for local browser testing.

Run the JavaScript tests with the bundled or system Node:

```bash
node --test tests/*.test.mjs
```

Current test groups:

- Protocol balance and practice exclusion
- Metrics and missing-data handling
- BLE newline JSON parser
- UI state and export behavior

## GitHub Pages / Bluefy

Publish the repository root with GitHub Pages:

```text
Settings -> Pages -> Deploy from a branch -> main -> / root
```

On iPhone, open the Pages URL in Bluefy, tap `Connect BLE`, select `SmartReactionPad`, run calibration, then start a protocol.

## References

- FDA human factors guidance: https://www.fda.gov/medical-devices/device-advice-comprehensive-regulatory-assistance/human-factors-and-medical-devices
- W3C WCAG use of color: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color
- Reactive stepping context: https://pmc.ncbi.nlm.nih.gov/articles/PMC2691798/
- LSI caution after ACL injury: https://pmc.ncbi.nlm.nih.gov/articles/PMC5483854/
- Dual-task framework: https://pmc.ncbi.nlm.nih.gov/articles/PMC4412054/
- PVT reaction-time metrics: https://pmc.ncbi.nlm.nih.gov/articles/PMC3079937/
- FSR smart insole calibration context: https://www.mdpi.com/1424-8220/20/4/957
