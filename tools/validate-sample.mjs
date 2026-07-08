import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeTrial } from "../session-store.js";
import { summarizeSteppingTrials, summarizeSpatialSides } from "../metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const samplePath = path.join(__dirname, "..", "samples", "baseline-session.json");
const sample = JSON.parse(fs.readFileSync(samplePath, "utf8"));

const trials = sample.trials.map((trial, index) => normalizeTrial(trial, {
  session_id: sample.session_id,
  protocol_id: sample.protocol_id,
  nextTrial: index + 1,
  total: sample.trials.length,
}));

const stepping = summarizeSteppingTrials(trials);
const spatial = summarizeSpatialSides(trials);

if (stepping.n !== 2) {
  throw new Error(`Expected 2 valid Go SRT trials, got ${stepping.n}`);
}

if (!Number.isFinite(spatial.signed_difference_ms)) {
  throw new Error("Expected spatial side comparison to be computable");
}

console.log(`Validated ${trials.length} sample v2 trials. Median SRT ${Math.round(stepping.median_ms)} ms.`);
