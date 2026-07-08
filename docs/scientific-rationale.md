# Scientific Rationale for Smart Reaction Pad v2

## Why SRT, not pure reaction time

The pad measures the interval from the firmware command that turns on the zone LED to the first FSR threshold crossing. This is best described as **Stepping Response Time** or **Stimulus-to-Contact Time**.

It includes visual perception, response selection, postural adjustment, stepping movement, foot contact, sensor mechanics, ADC sampling, and threshold detection. Without force plates, motion capture, EMG, or a photodiode timing rig, the system cannot separate neural reaction, motor initiation, weight shift, and foot-contact phases.

## Why default LSI was removed

The device knows target location, not actual limb use. A left-side target can be reached by the left foot, right foot, or a cross-step strategy. Therefore default reporting is **Spatial Side Comparison**, not limb symmetry.

Supervised assigned-limb testing may be added later, but it must state that limb use was instructed and operator-observed, not automatically identified.

## Why Go/No-Go is not full dual-task

The current task asks the participant to step for Go and withhold for No-Go. This is a response inhibition protocol. A true dual-task design needs a second task with independent cognitive performance measurement, such as separate accuracy or response counts.

The v2 dashboard therefore reports commission errors, omission errors, correct rejections, and Go SRT instead of a generic dual-task cost.

## Why drift is not automatically fatigue

Later-trial slowing can arise from physiological fatigue, attention loss, motivation, learning, strategy change, sensor movement, or speed-accuracy tradeoff. v2 therefore uses **Repeated-Trial Performance Drift** and reports descriptive early/late medians and slope.

The system does not claim to detect physiological fatigue without a standardized fatigue-induction protocol and supporting measures such as RPE or pre/post strength testing.

## Why FSR ADC is not force

FSRs are useful for contact detection, but their ADC output is nonlinear and depends on sensor placement, mounting pressure, material stack, wiring, ADC variation, and calibration. v2 reports `trigger_adc` and `post_contact_peak_adc` as relative signals only.

The project must not label ADC as Newtons, kilograms, ground reaction force, or peak force unless a mechanical calibration procedure is added.

## Human factors and colour use

v2 keeps the project rule `red = Go` and `green = No-Go`, but labels it as a reverse colour-response mapping and adds practice trials. The website and OLED also provide text cues so colour is not the only source of instruction.

The interface uses explicit states: connected, calibration, ready, starting, running, stopped, complete, and error. Start waits for device acknowledgement. Stop remains available during running states.
