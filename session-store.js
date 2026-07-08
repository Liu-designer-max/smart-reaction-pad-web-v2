import { PROTOCOL_VERSION, getProtocol, zoneName } from "./protocols.js";
import { countResults } from "./metrics.js";

export const ANALYSIS_VERSION = "2.0.0";
export const FIRMWARE_VERSION = "2.0.0";
export const WEB_VERSION = "2.0.0";

export function makeId(prefix) {
  const cryptoPart = globalThis.crypto?.randomUUID?.() || Math.random().toString(16).slice(2);
  return `${prefix}_${cryptoPart}`;
}

export function createAssessment(meta = {}) {
  return {
    assessment_id: makeId("assessment"),
    created_at: new Date().toISOString(),
    participant: {
      anonymous_id: meta.anonymous_id || "anonymous-001",
      injured_side: meta.injured_side || "unknown",
    },
    conditions: {
      footwear: meta.footwear || "not_recorded",
      stance: "central",
      supervised: true,
    },
    versions: {
      firmware_version: FIRMWARE_VERSION,
      web_version: WEB_VERSION,
      protocol_version: PROTOCOL_VERSION,
      analysis_version: ANALYSIS_VERSION,
    },
    sessions: [],
  };
}

export function createSession(protocolId, meta = {}) {
  const protocol = getProtocol(protocolId);
  return {
    session_id: makeId("session"),
    protocol_id: protocol.id,
    protocol_label: protocol.label,
    protocol_version: PROTOCOL_VERSION,
    started_at: null,
    completed_at: null,
    completed: false,
    stop_reason: null,
    calibration: meta.calibration || null,
    trial_plan: meta.trial_plan || [],
    trials: [],
    firmware_summary: null,
  };
}

export function requiredMissing(event) {
  const missing = [];
  for (const key of ["trial", "zone", "stim_class", "result"]) {
    if (event[key] === undefined || event[key] === null || event[key] === "") missing.push(key);
  }
  if (event.result === "go_correct" && !Number.isFinite(Number(event.rt_ms))) missing.push("rt_ms");
  if (["go_correct", "wrong_zone", "false_alarm", "multi_contact"].includes(event.result) && event.pressed_zone === undefined && !Array.isArray(event.pressed_zones)) {
    missing.push("pressed_zone");
  }
  return missing;
}

export function normalizeTrial(event, fallback = {}) {
  const missing = requiredMissing(event);
  const zone = event.zone === undefined || event.zone === null ? null : Number(event.zone);
  const pressedZone = event.pressed_zone === undefined || event.pressed_zone === null ? null : Number(event.pressed_zone);
  const rawResult = event.result || "unknown";
  const quality_flags = [...(event.quality_flags || [])];
  for (const field of missing) quality_flags.push(`missing_${field}`);
  if (missing.length) quality_flags.push("invalid_data");
  if (event.rt_ms !== null && event.rt_ms !== undefined && Number(event.rt_ms) < 50) quality_flags.push("anticipation_window");
  return {
    event: "trial",
    session_id: event.session_id || fallback.session_id || null,
    protocol_id: event.protocol_id || fallback.protocol_id || null,
    protocol_version: event.protocol_version || PROTOCOL_VERSION,
    trial: Number(event.trial ?? fallback.nextTrial ?? 0),
    total: Number(event.total ?? fallback.total ?? 0),
    trial_phase: event.trial_phase || "recorded",
    included_in_analysis: event.included_in_analysis !== false && event.trial_phase !== "practice",
    zone,
    zone_name: event.zone_name || (zone === null ? "--" : zoneName(zone)),
    stim_class: event.stim_class || null,
    stim: event.stim || (event.stim_class === "nogo" ? "GREEN" : event.stim_class === "go" ? "RED" : "--"),
    pressed_zone: pressedZone,
    pressed_zone_name: event.pressed_zone_name || (pressedZone === null ? "--" : zoneName(pressedZone)),
    pressed_zones: Array.isArray(event.pressed_zones) ? event.pressed_zones.map(Number) : (pressedZone === null ? [] : [pressedZone]),
    first_pressed_zone: event.first_pressed_zone === undefined || event.first_pressed_zone === null ? pressedZone : Number(event.first_pressed_zone),
    contact_mask: Number(event.contact_mask ?? 0),
    rt_ms: event.rt_ms === null || event.rt_ms === undefined ? null : Number(event.rt_ms),
    stimulus_us: event.stimulus_us === undefined ? null : Number(event.stimulus_us),
    contact_us: event.contact_us === undefined ? null : Number(event.contact_us),
    result: missing.length ? "invalid_data" : rawResult,
    trigger_adc: event.trigger_adc === undefined ? null : Number(event.trigger_adc),
    post_contact_peak_adc: event.post_contact_peak_adc === undefined ? null : Number(event.post_contact_peak_adc),
    metric_definition: event.metric_definition || "stimulus_to_target_contact",
    time_origin: event.time_origin || "zone_led_command",
    response_event: event.response_event || "fsr_threshold_crossing",
    quality_flags: [...new Set(quality_flags)],
    timestamp: event.timestamp || new Date().toISOString(),
  };
}

export function buildSessionSummary(session) {
  const formal = session.trials.filter((trial) => trial.included_in_analysis !== false && !trial.quality_flags.includes("invalid_data"));
  return {
    event: "summary",
    session_id: session.session_id,
    protocol_id: session.protocol_id,
    completed: session.completed,
    stop_reason: session.stop_reason,
    planned_trials: session.trial_plan.filter((trial) => trial.included_in_analysis).length,
    completed_trials: formal.length,
    counts: countResults(session.trials),
  };
}

export function buildExportPayload(assessment) {
  return {
    exported_at: new Date().toISOString(),
    ...assessment,
    sessions: assessment.sessions.map((session) => ({
      ...session,
      computed_summary: buildSessionSummary(session),
    })),
  };
}

export function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const text = Array.isArray(value) ? value.join("|") : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCsv(sessions) {
  const header = [
    "assessment_id", "session_id", "protocol_id", "trial", "trial_phase", "included_in_analysis",
    "zone", "zone_name", "stim_class", "stim", "pressed_zone", "pressed_zones", "rt_ms",
    "result", "trigger_adc", "post_contact_peak_adc", "quality_flags", "timestamp",
  ];
  const rows = [];
  for (const session of sessions) {
    for (const trial of session.trials) {
      rows.push({
        assessment_id: session.assessment_id,
        session_id: session.session_id,
        protocol_id: session.protocol_id,
        ...trial,
      });
    }
  }
  return [header.join(","), ...rows.map((row) => header.map((key) => csvEscape(row[key])).join(","))].join("\n");
}
