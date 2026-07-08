import test from "node:test";
import assert from "node:assert/strict";
import { PROTOCOLS, generateTrialPlan } from "../protocols.js";

function countsBy(items, key) {
  return items.reduce((counts, item) => {
    counts[item[key]] = (counts[item[key]] || 0) + 1;
    return counts;
  }, {});
}

test("protocol plans keep zone counts balanced and avoid triple repeats", () => {
  for (const protocol of Object.values(PROTOCOLS)) {
    const recorded = generateTrialPlan(protocol.id, "protocol-test").filter((trial) => trial.included_in_analysis);
    const zoneCounts = Object.values(countsBy(recorded, "zone"));
    assert.ok(Math.max(...zoneCounts) - Math.min(...zoneCounts) <= 1, protocol.id);
    for (let i = 2; i < recorded.length; i += 1) {
      assert.ok(!(recorded[i].zone === recorded[i - 1].zone && recorded[i].zone === recorded[i - 2].zone), protocol.id);
    }
  }
});

test("Go and No-Go counts match protocol definitions", () => {
  for (const protocol of Object.values(PROTOCOLS)) {
    const recorded = generateTrialPlan(protocol.id, "stim-counts").filter((trial) => trial.included_in_analysis);
    assert.equal(recorded.filter((trial) => trial.stim_class === "go").length, protocol.goTrials, protocol.id);
    assert.equal(recorded.filter((trial) => trial.stim_class === "nogo").length, protocol.noGoTrials, protocol.id);
  }
});

test("practice trials are excluded from formal analysis", () => {
  const plan = generateTrialPlan("inhibitory_v2", "practice-check");
  assert.ok(plan.some((trial) => trial.trial_phase === "practice"));
  assert.ok(plan.filter((trial) => trial.trial_phase === "practice").every((trial) => trial.included_in_analysis === false));
});
