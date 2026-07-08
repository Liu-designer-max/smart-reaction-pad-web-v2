import { zoneSide } from "./protocols.js";

export const RESULT_KEYS = [
  "go_correct",
  "wrong_zone",
  "false_alarm",
  "correct_withhold",
  "miss",
  "anticipation",
  "false_start",
  "multi_contact",
  "sensor_not_ready",
  "aborted",
  "unknown",
  "invalid_data",
];

export function mean(values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

export function median(values) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

export function quantile(values, q) {
  const clean = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return null;
  const pos = (clean.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (clean[base + 1] === undefined) return clean[base];
  return clean[base] + rest * (clean[base + 1] - clean[base]);
}

export function iqr(values) {
  const q1 = quantile(values, 0.25);
  const q3 = quantile(values, 0.75);
  if (!Number.isFinite(q1) || !Number.isFinite(q3)) return null;
  return q3 - q1;
}

export function sd(values) {
  const clean = values.filter(Number.isFinite);
  if (clean.length < 2) return null;
  const avg = mean(clean);
  const variance = clean.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (clean.length - 1);
  return Math.sqrt(variance);
}

export function isAnalyzableTrial(trial) {
  return trial?.included_in_analysis !== false && !trial?.quality_flags?.includes("invalid_data");
}

export function validGoSrtTrials(trials) {
  return trials.filter((trial) =>
    isAnalyzableTrial(trial) &&
    trial.stim_class === "go" &&
    trial.result === "go_correct" &&
    Number.isFinite(trial.rt_ms) &&
    trial.rt_ms >= 50 &&
    trial.rt_ms <= 2000
  );
}

export function countResults(trials) {
  const counts = Object.fromEntries(RESULT_KEYS.map((key) => [key, 0]));
  for (const trial of trials.filter(isAnalyzableTrial)) {
    const key = RESULT_KEYS.includes(trial.result) ? trial.result : "unknown";
    counts[key] += 1;
  }
  return counts;
}

export function summarizeSteppingTrials(trials) {
  const valid = validGoSrtTrials(trials);
  const values = valid.map((trial) => trial.rt_ms);
  const formal = trials.filter(isAnalyzableTrial);
  return {
    n: valid.length,
    formal_n: formal.length,
    median_ms: median(values),
    iqr_ms: iqr(values),
    mean_ms: mean(values),
    sd_ms: sd(values),
    counts: countResults(trials),
  };
}

export function summarizeSpatialSides(trials) {
  const valid = validGoSrtTrials(trials);
  const leftValues = valid.filter((trial) => zoneSide(trial.zone) === "left").map((trial) => trial.rt_ms);
  const rightValues = valid.filter((trial) => zoneSide(trial.zone) === "right").map((trial) => trial.rt_ms);
  const leftMedian = median(leftValues);
  const rightMedian = median(rightValues);
  return {
    left_n: leftValues.length,
    right_n: rightValues.length,
    left_median_ms: leftMedian,
    right_median_ms: rightMedian,
    signed_difference_ms: Number.isFinite(leftMedian) && Number.isFinite(rightMedian) ? rightMedian - leftMedian : null,
  };
}

export function summarizeGoNoGo(trials) {
  const formal = trials.filter(isAnalyzableTrial);
  const goTrials = formal.filter((trial) => trial.stim_class === "go");
  const noGoTrials = formal.filter((trial) => trial.stim_class === "nogo");
  const goCorrect = goTrials.filter((trial) => trial.result === "go_correct").length;
  const goMiss = goTrials.filter((trial) => trial.result === "miss").length;
  const falseAlarms = noGoTrials.filter((trial) => trial.result === "false_alarm").length;
  const withholds = noGoTrials.filter((trial) => trial.result === "correct_withhold").length;
  const goValues = goTrials.filter((trial) => trial.result === "go_correct" && Number.isFinite(trial.rt_ms)).map((trial) => trial.rt_ms);
  return {
    go_trials: goTrials.length,
    nogo_trials: noGoTrials.length,
    go_hit_rate: goTrials.length ? (goCorrect / goTrials.length) * 100 : null,
    go_omission_rate: goTrials.length ? (goMiss / goTrials.length) * 100 : null,
    nogo_commission_rate: noGoTrials.length ? (falseAlarms / noGoTrials.length) * 100 : null,
    correct_rejection_rate: noGoTrials.length ? (withholds / noGoTrials.length) * 100 : null,
    go_median_ms: median(goValues),
    go_iqr_ms: iqr(goValues),
  };
}

export function summarizePerformanceDrift(trials) {
  const valid = validGoSrtTrials(trials);
  if (valid.length < 6) {
    return { n: valid.length, early_median_ms: null, late_median_ms: null, drift_percent: null, slope_ms_per_trial: null };
  }
  const sorted = [...valid].sort((a, b) => a.trial - b.trial);
  const block = Math.max(1, Math.floor(sorted.length / 3));
  const early = sorted.slice(0, block).map((trial) => trial.rt_ms);
  const late = sorted.slice(-block).map((trial) => trial.rt_ms);
  const earlyMedian = median(early);
  const lateMedian = median(late);
  const xs = sorted.map((trial, index) => index + 1);
  const ys = sorted.map((trial) => trial.rt_ms);
  const xMean = mean(xs);
  const yMean = mean(ys);
  const denom = xs.reduce((sum, x) => sum + (x - xMean) ** 2, 0);
  const slope = denom ? xs.reduce((sum, x, index) => sum + (x - xMean) * (ys[index] - yMean), 0) / denom : null;
  return {
    n: valid.length,
    early_median_ms: earlyMedian,
    late_median_ms: lateMedian,
    drift_percent: Number.isFinite(earlyMedian) && earlyMedian !== 0 ? ((lateMedian - earlyMedian) / earlyMedian) * 100 : null,
    slope_ms_per_trial: slope,
  };
}

export function calculateMotorDtc(singleMedian, dualMedian) {
  if (!Number.isFinite(singleMedian) || !Number.isFinite(dualMedian) || singleMedian === 0) return null;
  return ((dualMedian - singleMedian) / singleMedian) * 100;
}

export function calculateCognitiveDtc(singleAccuracy, dualAccuracy) {
  if (!Number.isFinite(singleAccuracy) || !Number.isFinite(dualAccuracy) || singleAccuracy === 0) return null;
  return ((singleAccuracy - dualAccuracy) / singleAccuracy) * 100;
}
