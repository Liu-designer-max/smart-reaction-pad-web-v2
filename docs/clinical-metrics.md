# Smart Reaction Pad v2 Metrics

This document defines the biomedical engineering metrics used by v2. The system is an educational prototype for structured discussion, not a clinical clearance tool.

## Stepping Response Time

**Stepping Response Time (SRT)** is the interval from the zone LED command to first FSR threshold crossing.

It reflects a combined perception-decision-posture-step-contact process. It should not be described as pure neural reaction time or motor initiation time.

Primary descriptors:

- Median SRT
- IQR
- Mean and SD as secondary descriptors
- Anticipation, miss, wrong-zone, false-start, and multi-contact counts

## Spatial Side Comparison

The device groups targets by spatial side:

```text
left-target median SRT
right-target median SRT
signed difference = right median - left median
```

This is not automatic limb symmetry. The pad does not identify which foot was used. A supervised assigned-limb protocol can be added later, but must be labelled as instructed and operator-observed.

## Inhibitory Stepping

The Go/No-Go protocol reports response inhibition, not dual-task cost.

Metrics:

```text
Go hit rate = go_correct / all Go trials
Go omission rate = miss / all Go trials
No-Go commission rate = false_alarm / all No-Go trials
Correct rejection rate = correct_withhold / all No-Go trials
```

No-Go trials do not belong in the denominator for valid Go SRT.

## Repeated-Trial Performance Drift

Drift compares early and late repeated-trial performance:

```text
drift % = (late-tertile median - early-tertile median) / early-tertile median * 100
```

This is descriptive time-on-task drift, not a fatigue diagnosis. Later slowing can reflect attention, motivation, strategy, learning, sensor movement, or physiological fatigue.

## FSR Signal Fields

v2 exports:

- `trigger_adc`: relative ADC at detection.
- `post_contact_peak_adc`: relative post-contact ADC peak.

These are not force, GRF, kg, or Newton values.
