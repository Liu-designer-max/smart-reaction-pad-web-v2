export const PROTOCOL_VERSION = "2026-07-08-v2";

export const ZONES = [
  { id: 0, name: "LF", side: "left", label: "Left front" },
  { id: 1, name: "RF", side: "right", label: "Right front" },
  { id: 2, name: "LR", side: "left", label: "Left rear" },
  { id: 3, name: "RR", side: "right", label: "Right rear" },
  { id: 4, name: "LL", side: "left", label: "Left lateral" },
  { id: 5, name: "RL", side: "right", label: "Right lateral" },
];

export const PROTOCOLS = {
  baseline_v2: {
    id: "baseline_v2",
    label: "Baseline",
    optionText: "24 Go trials",
    shortLabel: "Baseline",
    formalTrials: 24,
    practiceTrials: 4,
    zones: [0, 1, 2, 3, 4, 5],
    goTrials: 24,
    noGoTrials: 0,
    description: "Measures stepping response across all six target zones.",
  },
  left_target_v2: {
    id: "left_target_v2",
    label: "Left targets",
    optionText: "18 Go trials",
    shortLabel: "Left targets",
    formalTrials: 18,
    practiceTrials: 3,
    zones: [0, 2, 4],
    goTrials: 18,
    noGoTrials: 0,
    description: "Uses the left-side target zones only. This compares target side, not which leg was used.",
  },
  right_target_v2: {
    id: "right_target_v2",
    label: "Right targets",
    optionText: "18 Go trials",
    shortLabel: "Right targets",
    formalTrials: 18,
    practiceTrials: 3,
    zones: [1, 3, 5],
    goTrials: 18,
    noGoTrials: 0,
    description: "Uses the right-side target zones only. This compares target side, not which leg was used.",
  },
  inhibitory_v2: {
    id: "inhibitory_v2",
    label: "Go/No-Go",
    optionText: "30 mixed trials",
    shortLabel: "Go/No-Go",
    formalTrials: 30,
    practiceTrials: 6,
    zones: [0, 1, 2, 3, 4, 5],
    goTrials: 21,
    noGoTrials: 9,
    description: "Tests response control. Red means step, green means do not step.",
  },
  drift_v2: {
    id: "drift_v2",
    label: "Long Run",
    optionText: "42 Go trials",
    shortLabel: "Long run",
    formalTrials: 42,
    practiceTrials: 4,
    zones: [0, 1, 2, 3, 4, 5],
    goTrials: 42,
    noGoTrials: 0,
    description: "A longer run for checking whether response speed changes over time.",
  },
  quick_demo_v2: {
    id: "quick_demo_v2",
    label: "Quick Demo",
    optionText: "12 mixed trials",
    shortLabel: "Quick demo",
    formalTrials: 12,
    practiceTrials: 3,
    zones: [0, 1, 2, 3, 4, 5],
    goTrials: 9,
    noGoTrials: 3,
    description: "Short demo with both red Go and green No-Go examples.",
  },
};

export function getProtocol(protocolId) {
  return PROTOCOLS[protocolId] || PROTOCOLS.baseline_v2;
}

export function zoneName(zoneId) {
  return ZONES.find((zone) => zone.id === Number(zoneId))?.name || "--";
}

export function zoneSide(zoneId) {
  return ZONES.find((zone) => zone.id === Number(zoneId))?.side || "unknown";
}

export function hashSeed(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function balancedZones(zones, count) {
  const result = [];
  for (let i = 0; i < count; i += 1) result.push(zones[i % zones.length]);
  return result;
}

function stimClasses(protocol, phase) {
  if (phase === "practice") {
    if (protocol.noGoTrials > 0) return ["go", "nogo", "go", "nogo", "go", "go"].slice(0, protocol.practiceTrials);
    return Array.from({ length: protocol.practiceTrials }, () => "go");
  }
  return [
    ...Array.from({ length: protocol.goTrials }, () => "go"),
    ...Array.from({ length: protocol.noGoTrials }, () => "nogo"),
  ];
}

function shuffle(items, rand) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function hasTripleRepeat(plan) {
  for (let i = 2; i < plan.length; i += 1) {
    if (plan[i].zone === plan[i - 1].zone && plan[i].zone === plan[i - 2].zone) return true;
  }
  return false;
}

function makePhasePlan(protocol, phase, seedText) {
  const classes = stimClasses(protocol, phase);
  const zones = balancedZones(protocol.zones, classes.length);
  const seed = hashSeed(`${protocol.id}:${phase}:${seedText}`);
  let best = [];
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rand = seededRandom(seed + attempt);
    const shuffledZones = shuffle(zones, rand);
    const shuffledClasses = shuffle(classes, rand);
    const candidate = shuffledZones.map((zone, index) => ({
      plan_index: index + 1,
      trial_phase: phase,
      included_in_analysis: phase === "recorded",
      zone,
      zone_name: zoneName(zone),
      stim_class: shuffledClasses[index],
      stim: shuffledClasses[index] === "go" ? "RED" : "GREEN",
    }));
    best = candidate;
    if (!hasTripleRepeat(candidate)) break;
  }
  return best.map((trial, index) => ({ ...trial, plan_index: index + 1 }));
}

export function generateTrialPlan(protocolId, seedText = new Date().toISOString()) {
  const protocol = getProtocol(protocolId);
  const practice = makePhasePlan(protocol, "practice", seedText);
  const recorded = makePhasePlan(protocol, "recorded", seedText);
  return [...practice, ...recorded].map((trial, index) => ({
    ...trial,
    trial: index + 1,
    total: practice.length + recorded.length,
    recorded_total: protocol.formalTrials,
    protocol_id: protocol.id,
    protocol_version: PROTOCOL_VERSION,
  }));
}
