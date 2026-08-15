# LabVIEW Simulation

## Overview

`simulation.vi` is the LabVIEW simulation file used as part of the **Smart Fire Detection and Automatic Suppression System for Electrical Distribution Boards** project.

The VI is intended for testing and demonstrating the control/DAQ side of the project before or alongside operation with the complete hardware system.

## File

```text
simulation/
├── simulation.vi
└── README.md
```

## Confirmed from `simulation.vi`

Inspection of the uploaded VI confirms that it contains NI-DAQmx components, including:

- **DAQ Assistant**
- **DAQmx Create Task**
- **DAQmx Create Virtual Channel**
- **DAQmx Start Task**
- **DAQmx Write**
- **DAQmx Stop Task**
- **DAQmx Clear Task**
- A configured **digital output**
- DAQ channel reference: `Dev6/port0/line2`
- TDMS logging configuration is present in the VI

The VI therefore depends on the NI-DAQmx environment and a compatible NI DAQ device/configuration.

## Role in the Project

The complete project uses LabVIEW and NI DAQ for sensing, decision making, and actuator control.

The main project functions include:

- Monitoring temperature
- Monitoring smoke
- Monitoring flame
- Monitoring current
- Controlling the cooling fan
- Activating the buzzer
- Controlling the fire-suppression prototype
- Sending system information to the cloud/web monitoring layer

`simulation.vi` is kept separately so the LabVIEW-side behaviour can be demonstrated and tested without mixing it with the website or Telegram-bot source code.

## Requirements

To open and run this file, you will typically need:

- **NI LabVIEW**
- **NI-DAQmx**
- A compatible NI DAQ device, or an appropriately configured simulated NI-DAQmx device
- The required DAQ channels configured to match the VI

## Important DAQ Configuration

The uploaded VI contains a reference to:

```text
Dev6/port0/line2
```

This device/channel name depends on the DAQ configuration of the computer on which the VI was created.

If your computer shows the DAQ under another name such as:

```text
Dev1
Dev2
Dev3
```

you may need to update the DAQ Assistant or DAQmx channel inside the VI before running it.

## How to Run

1. Install **LabVIEW** and **NI-DAQmx**.
2. Connect the NI DAQ device.
3. Open **NI MAX (Measurement & Automation Explorer)**.
4. Confirm that the DAQ device is detected.
5. Check the device name and digital I/O channel configuration.
6. Open `simulation.vi` in LabVIEW.
7. If required, edit the DAQ Assistant/channel so it matches your current DAQ device.
8. Run the VI.
9. Use the front-panel controls to test the simulation.
10. Observe the corresponding indicators and DAQ outputs.

## If the DAQ Device Is Not Available

For demonstration on another computer, create a **simulated NI-DAQmx device** in NI MAX when the required hardware model is supported.

After creating the simulated device, update the channel used by the VI so that it points to the simulated device.

## TDMS Logging

The VI contains TDMS logging-related configuration.

TDMS can be used to store test or simulation data generated during LabVIEW operation for later analysis.

Because file paths can differ between computers, check the logging configuration before running the VI on another machine.

## Troubleshooting

### DAQ device not found

If LabVIEW reports that `Dev6` does not exist:

- Open NI MAX.
- Find the actual device name.
- Edit the DAQ Assistant / DAQmx channel.
- Replace `Dev6` with the device configured on your computer.

### Missing NI-DAQmx VIs

If DAQmx blocks appear broken or unavailable:

- Install or repair **NI-DAQmx**.
- Restart LabVIEW after installation.

### Digital output does not respond

Check:

- The correct physical channel is selected.
- The DAQ device supports that digital output line.
- Ground/reference connections are correct.
- The connected external circuit is not drawing more current than the DAQ output can supply.

For the real project, DAQ digital outputs are used mainly as **control signals** for driver stages rather than directly powering higher-current actuators.

## Repository Placement

Recommended placement in the main project repository:

```text
smart-fire-detection-system/
│
├── README.md
│
├── website/
│
├── telegram-bot/
│
├── labview/
│   ├── simulation.vi
│   └── README.md
│
├── docs/
├── data/
└── images/
```

## Notes

The uploaded `.vi` file is a compiled LabVIEW resource file rather than a plain-text source file. The NI-DAQmx dependencies and channel configuration above were confirmed directly from the file, but detailed front-panel labels and every block-diagram decision cannot be reliably reconstructed from binary inspection alone.

For the most accurate documentation, screenshots of the **Front Panel** and **Block Diagram** can also be added to this README.

---

**Project:** Smart Fire Detection and Automatic Suppression System for Electrical Distribution Boards
