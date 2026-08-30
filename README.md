# Hybrid Tabletop Tracker

Experimental computer-vision tracking system for a hybrid tabletop RPG table.

The goal is to connect **physical miniatures placed on a real tabletop** to a digital virtual tabletop (VTT), allowing physical and remote players to share the same game state.

## Current status

**Prototype 01: validated**

The first proof of concept demonstrated simultaneous identification and 2D position tracking of multiple physical markers through a transparent surface using a camera positioned above the table.

Observed test result: **11 markers detected simultaneously**, including IDs 01–10 plus a duplicate ID 01 retained from the initial single-marker test.

This prototype validates the basic chain:

`physical miniature / marker -> camera -> computer vision -> unique ID + image coordinates (X,Y)`

The duplicate ID was intentional and demonstrates an important architectural requirement: production miniatures must use unique marker IDs (or an additional identity-binding layer) if each physical object is expected to map unambiguously to a digital token.

## Prototype 01 hardware

- MacBook Air (Apple Silicon) as processing host
- iPhone as temporary overhead camera
- Lantern RTSP Cam as temporary RTSP video source
- Transparent glass test surface
- Printed ArUco markers
- Marker outer size: approximately **23 mm**
- Standard consumer printer

The iPhone/Lantern combination is deliberately temporary. The tracking software should remain camera-agnostic so that the video source can later be replaced by a USB webcam, dedicated camera, network camera, or another capture device.

## Software environment

Validated environment:

- macOS
- Python 3.10.11
- OpenCV contrib 5.0.0
- NumPy 2.2.6
- FFmpeg / ffplay 9.0.1
- `cv2.aruco` available

Install the Python dependencies with:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## RTSP test

The camera stream was first validated independently from the computer-vision pipeline.

Example:

```bash
ffplay rtsp://CAMERA_IP:8554/live
```

Do not hard-code a private LAN address in application code. The camera endpoint should be configurable.

A useful diagnostic sequence is:

```bash
ping CAMERA_IP
nc -vz CAMERA_IP 8554
ffplay rtsp://CAMERA_IP:8554/live
```

During testing, the iOS RTSP application stopped its listener whenever the application became inactive. Therefore the streaming application had to remain active in the foreground. This is an implementation detail of the temporary camera solution, not a requirement of the final architecture.

## ArUco tracking

The prototype uses OpenCV's ArUco detector. Each detected marker provides:

- marker ID;
- four image-space corners;
- center coordinate `(X,Y)`;
- orientation information derivable from the corners.

For each marker, its center can be calculated from the four detected corners. The prototype displays the marker boundary, ID, center point, and image coordinates over the camera feed.

### Marker size

The physical test markers were approximately **23 mm across** and were successfully detected through the glass in the prototype setup. This size is therefore considered validated for this test geometry, rather than a theoretical minimum for the final table.

Markers should retain a white quiet zone around the black ArUco border. Cutting directly into the black border can reduce detection reliability.

## Why image coordinates are not enough

The current `(X,Y)` values are camera-pixel coordinates. They are not yet tabletop coordinates and therefore cannot directly identify a VTT grid cell.

The next major step is **surface calibration**.

We need a transformation:

`camera coordinates -> calibrated tabletop plane -> physical coordinates -> VTT/grid coordinates`

A practical implementation will use four fixed reference points defining the usable tabletop area and compute a perspective transform (homography). Once calibrated, marker centers can be projected into a normalized tabletop coordinate system independent of camera perspective.

## Target architecture

```text
Physical miniature
       |
       v
ArUco marker / physical identifier
       |
       v
Overhead camera
       |
       v
Video capture layer
       |
       v
OpenCV detector
       |
       +--> marker ID
       +--> center X,Y
       +--> orientation
       |
       v
Perspective calibration / homography
       |
       v
Table coordinates
       |
       v
Grid / VTT coordinates
       |
       v
Token synchronization layer
       |
       v
Virtual tabletop
```

The final system may also use NFC as an **identity-binding mechanism** between a miniature and a VTT token. NFC is not intended to perform positional tracking. Position remains a computer-vision problem.

## Design principles

1. **Camera agnostic** — tracking must not depend on Lantern or an iPhone.
2. **Identity and position are separate concerns** — ArUco/computer vision determines position; NFC may later bind a physical miniature to a digital entity.
3. **Calibration before VTT integration** — raw camera pixels must first become stable tabletop coordinates.
4. **Physical play remains physical** — the system should observe miniature movement rather than require players to manipulate digital tokens manually.
5. **Remote parity** — the long-term goal is to make physical miniature movement visible to remote players in the shared VTT.

## Prototype roadmap

### P0 — Marker detection

- [x] Receive live camera stream
- [x] Detect one ArUco marker
- [x] Detect multiple ArUco markers
- [x] Read unique IDs
- [x] Calculate marker centers
- [x] Track markers through transparent glass
- [x] Validate ~23 mm markers

### P1 — Tabletop coordinate system

- [ ] Define four fixed calibration references
- [ ] Compute perspective transform / homography
- [ ] Rectify the camera image to a top-down tabletop view
- [ ] Convert marker centers to normalized surface coordinates
- [ ] Draw a configurable virtual grid
- [ ] Determine the grid cell occupied by each marker
- [ ] Test stability while miniatures are lifted and replaced

### P2 — Physical miniature behavior

- [ ] Handle temporary marker disappearance while a miniature is in hand
- [ ] Add movement debounce / stabilization
- [ ] Define pickup and placement events
- [ ] Prevent false movement from detection jitter
- [ ] Evaluate marker placement under miniature bases

### P3 — Identity layer

- [ ] Evaluate NFC reader in the Game Master's area
- [ ] Bind NFC-tagged miniature to VTT token
- [ ] Persist miniature-token association
- [ ] Prototype an NFC disconnect tray

### P4 — VTT integration

- [ ] Define tracker event API
- [ ] Map tabletop coordinates to VTT map coordinates
- [ ] Synchronize physical movement with digital tokens
- [ ] Evaluate Roll20 integration options
- [ ] Implement remote-to-physical interaction strategy

## Long-term table concept

The tracker is part of a larger hybrid tabletop RPG table concept designed around four physically present players and two remote players. The intended table uses a central digital display while preserving physical miniatures and physical dice for players at the table.

This repository focuses first on the **physical-to-digital tracking subsystem**. Display integration, audio/video presence, dice capture, NFC identity binding, and VTT synchronization will be developed as separate layers around that core.

## Experimental status

This is an early engineering prototype. The current implementation demonstrates feasibility under one test geometry; it does not yet establish the maximum table size, camera height, minimum marker size, illumination requirements, occlusion tolerance, or production tracking accuracy.

Those parameters will be measured experimentally in later prototypes.
