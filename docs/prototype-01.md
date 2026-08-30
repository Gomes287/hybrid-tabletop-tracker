# Prototype 01 — ArUco multi-marker tracking

Date: 2026-08-29

## Objective

Determine whether inexpensive computer vision can reliably identify physical tabletop objects and return their positions while observed through a transparent surface.

The experiment intentionally isolates the tracking problem from VTT integration, NFC identity binding, projection/display technology, and the final table construction.

## Test sequence

### 1. Video transport

An iPhone running Lantern RTSP Cam was used as a temporary overhead network camera.

The MacBook and iPhone were connected to the same local network. Connectivity was verified independently using `ping`, TCP port testing, and `ffplay` before OpenCV was introduced.

An important behavior was observed: Lantern stopped the RTSP listener when iOS considered the application inactive. Keeping the streaming application active restored the RTSP endpoint.

### 2. Computer-vision environment

A Python virtual environment was created on the MacBook. OpenCV contrib was selected because the ArUco module is required.

Validated versions:

```text
Python 3.10.11
OpenCV 5.0.0
ArUco module: available
NumPy 2.2.6
FFmpeg/ffplay 9.0.1
```

### 3. Single-marker detection

A first ArUco marker was printed and placed on/under the transparent test surface. OpenCV successfully detected the marker, outlined its four corners, identified its ID, and calculated its center coordinate.

This validated the basic pipeline from physical marker to machine-readable `(ID, X, Y)` data.

### 4. Marker scale

A sheet containing IDs 01–10 was generated and printed on A4 paper. The resulting physical marker size used in the experiment was approximately 23 mm.

The markers were cut while preserving the required surrounding contrast/quiet zone and positioned on the test surface.

### 5. Multi-marker test

The detector successfully identified all intended marker IDs simultaneously.

The final test frame contained 11 detections because the original ID 01 marker from the first experiment was deliberately reused together with the new ID 01–10 set.

Detected set:

```text
01
01  (duplicate physical marker retained from initial test)
02
03
04
05
06
07
08
09
10
```

Therefore the meaningful result is:

**IDs 01–10 were all visible to the detector simultaneously, with 11 physical markers detected in the frame.**

## What this proves

Under the tested camera distance, lighting, surface, print quality, and marker size:

- printed ArUco markers can be detected through the transparent test surface;
- ~23 mm markers are sufficient for the current prototype geometry;
- multiple markers can be tracked in the same frame;
- marker identity can be recovered;
- marker center coordinates can be recovered;
- arbitrary marker rotation does not prevent detection in the demonstrated configuration.

## What this does NOT prove

The experiment does not yet establish:

- reliable tracking over a full 55-inch tabletop display;
- the required resolution for the final camera;
- maximum usable camera height;
- tolerance to player hands and miniatures occluding markers;
- performance under illumination from a display beneath the glass;
- marker readability when permanently mounted under miniature bases;
- latency requirements for VTT synchronization;
- grid accuracy;
- real-world millimeter coordinates;
- robustness against duplicate IDs.

## Duplicate-ID observation

Two physical ID 01 markers were deliberately visible in the final experiment. OpenCV can detect both physical instances, but identical IDs are not sufficient to distinguish their persistent identities.

Production use should therefore ensure unique visual IDs or combine visual tracking with a separate identity-binding mechanism.

## Next experiment

The next prototype should convert raw camera coordinates into a stable tabletop coordinate system.

Four fixed reference points will define the usable surface. A homography will rectify perspective and produce a top-down coordinate plane. A configurable grid can then be drawn over this plane and each marker assigned to a grid cell.

Success criterion for Prototype 02:

> A marker can be lifted, moved, and placed on a physical square, and the software consistently reports the corresponding calibrated grid cell rather than only raw camera pixels.
