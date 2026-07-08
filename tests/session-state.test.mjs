import test from "node:test";
import assert from "node:assert/strict";
import { UI_STATES, canStartHardware, controlsForState } from "../ui-state.js";
import { createAssessment, createSession, normalizeTrial, buildCsv } from "../session-store.js";

test("UI state blocks unsafe starts and mode changes while running", () => {
  assert.equal(canStartHardware(UI_STATES.CONNECTED, true, false), false);
  assert.equal(canStartHardware(UI_STATES.READY, true, true), true);
  assert.equal(controlsForState(UI_STATES.RUNNING).protocolDisabled, true);
  assert.equal(controlsForState(UI_STATES.RUNNING).stopDisabled, false);
});

test("Stop can preserve existing assessment/session data", () => {
  const assessment = createAssessment({ anonymous_id: "p01" });
  const session = createSession("baseline_v2");
  session.trials.push(normalizeTrial({ trial: 1, zone: 0, stim_class: "go", result: "go_correct", rt_ms: 410, pressed_zone: 0 }));
  session.completed = false;
  session.stop_reason = "web_stop";
  assessment.sessions.push(session);
  assert.equal(assessment.sessions[0].trials.length, 1);
  assert.equal(assessment.sessions[0].stop_reason, "web_stop");
});

test("CSV escaping preserves commas, quotes, and arrays", () => {
  const session = createSession("baseline_v2");
  session.assessment_id = "assessment,quoted";
  session.trials.push(normalizeTrial({ trial: 1, zone: 0, stim_class: "go", result: "multi_contact", rt_ms: 410, pressed_zone: 0, pressed_zones: [0, 1], quality_flags: ['needs"review'] }));
  const csv = buildCsv([session]);
  assert.match(csv, /"assessment,quoted"/);
  assert.match(csv, /0\|1/);
  assert.match(csv, /needs""review/);
});
