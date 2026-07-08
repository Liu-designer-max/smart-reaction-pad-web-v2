import test from "node:test";
import assert from "node:assert/strict";
import {
  median,
  iqr,
  summarizeSteppingTrials,
  summarizeGoNoGo,
  summarizeSpatialSides,
  summarizePerformanceDrift,
  calculateMotorDtc,
  calculateCognitiveDtc,
} from "../metrics.js";
import { normalizeTrial } from "../session-store.js";

const trials = [
  normalizeTrial({ trial: 1, zone: 0, stim_class: "go", result: "go_correct", rt_ms: 400, pressed_zone: 0 }),
  normalizeTrial({ trial: 2, zone: 1, stim_class: "go", result: "go_correct", rt_ms: 500, pressed_zone: 1 }),
  normalizeTrial({ trial: 3, zone: 2, stim_class: "go", result: "miss", rt_ms: null }),
  normalizeTrial({ trial: 4, zone: 3, stim_class: "nogo", result: "false_alarm", rt_ms: 420, pressed_zone: 3 }),
  normalizeTrial({ trial: 5, zone: 4, stim_class: "nogo", result: "correct_withhold", rt_ms: null }),
  normalizeTrial({ trial: 6, zone: 5, stim_class: "go", result: "go_correct", rt_ms: 650, pressed_zone: 5 }),
];

test("median and IQR are robust descriptive statistics", () => {
  assert.equal(median([400, 500, 650]), 500);
  assert.equal(iqr([1, 2, 3, 4, 5]), 2);
});

test("stepping summary uses only valid Go SRT trials", () => {
  const summary = summarizeSteppingTrials(trials);
  assert.equal(summary.n, 3);
  assert.equal(summary.counts.miss, 1);
  assert.equal(summary.median_ms, 500);
});

test("Go/No-Go uses separate denominators", () => {
  const summary = summarizeGoNoGo(trials);
  assert.equal(Math.round(summary.go_hit_rate), 75);
  assert.equal(Math.round(summary.go_omission_rate), 25);
  assert.equal(Math.round(summary.nogo_commission_rate), 50);
  assert.equal(Math.round(summary.correct_rejection_rate), 50);
});

test("spatial comparison reports signed target-side difference", () => {
  const spatial = summarizeSpatialSides(trials);
  assert.equal(spatial.left_median_ms, 400);
  assert.equal(spatial.right_median_ms, 575);
  assert.equal(spatial.signed_difference_ms, 175);
});

test("drift and DTC direction use performance-cost convention", () => {
  const drift = summarizePerformanceDrift([
    normalizeTrial({ trial: 1, zone: 0, stim_class: "go", result: "go_correct", rt_ms: 300, pressed_zone: 0 }),
    normalizeTrial({ trial: 2, zone: 1, stim_class: "go", result: "go_correct", rt_ms: 320, pressed_zone: 1 }),
    normalizeTrial({ trial: 3, zone: 2, stim_class: "go", result: "go_correct", rt_ms: 340, pressed_zone: 2 }),
    normalizeTrial({ trial: 4, zone: 3, stim_class: "go", result: "go_correct", rt_ms: 400, pressed_zone: 3 }),
    normalizeTrial({ trial: 5, zone: 4, stim_class: "go", result: "go_correct", rt_ms: 440, pressed_zone: 4 }),
    normalizeTrial({ trial: 6, zone: 5, stim_class: "go", result: "go_correct", rt_ms: 480, pressed_zone: 5 }),
  ]);
  assert.ok(drift.drift_percent > 0);
  assert.equal(calculateMotorDtc(400, 500), 25);
  assert.equal(calculateCognitiveDtc(90, 81), 10);
});

test("missing pressed zone is invalid, not assumed correct", () => {
  const trial = normalizeTrial({ trial: 1, zone: 0, stim_class: "go", result: "go_correct", rt_ms: 400 });
  assert.equal(trial.result, "invalid_data");
  assert.ok(trial.quality_flags.includes("missing_pressed_zone"));
});
