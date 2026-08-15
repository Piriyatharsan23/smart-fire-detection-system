# SCT-013-100 Current Sensor Calibration

## Sensor

**SCT-013-100 current transformer**

The sensor output was measured as a voltage across a burden resistor and logged using NI DAQ / DAQmx. Known current values were applied and the corresponding voltages were recorded.

## Calibration Data

| Current (A) | Voltage (V) |
|---:|---:|
| 0.4 | 0.173 |
| 0.5 | 0.219 |
| 0.6 | 0.264 |
| 0.8 | 0.356 |
| 1.0 | 0.447 |
| 1.2 | 0.537 |
| 1.4 | 0.634 |
| 1.6 | 0.726 |
| 1.8 | 0.812 |

These data are also stored in [`../data/current_sensor_calibration.csv`](../data/current_sensor_calibration.csv).

## Use in LabVIEW

The calibration characteristic is used to convert measured burden-resistor voltage back into current.

Examples documented in the project:

- approximately **0.447 V → 1.0 A**
- approximately **0.812 V → 1.8 A**

For the final LabVIEW implementation, use the team's fitted/calibrated conversion implemented in the VI rather than replacing it with an undocumented formula.
