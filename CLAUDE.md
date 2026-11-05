# ACC Draw Clock

Countdown clock for the Almonte Curling Club rink. Keeps draws on schedule (default: 95-minute draw).

## Goal
- A TV in the rink shows a big countdown full-screen (kiosk mode).
- Members start a preset from their phone or a tablet by the door.
- Sounds at start, at the warning, and at time-up.

## Architecture
```
[Phone / tablet]  --taps-->  [Google Apps Script web app]  <--polls every 5-10 s--  [Display page on Pi / Android TV box]  -->  TV + powered speaker
   control page                 state + JSON API                   local HTML, counts down itself
```

### 1. Apps Script web app (hosted in the club's Google Workspace)
- `doGet` serves:
  - the control page (HtmlService), and
  - a JSON state endpoint for the display (e.g. `?mode=state`).
- Stores state in PropertiesService (optionally logs actions to a Google Sheet).
- State shape (suggested):
  ```json
  {
    "status": "idle | running | paused",
    "label": "95-min Draw",
    "endsAt": 1730822400000,
    "remainingMsWhenPaused": null,
    "warningMin": 15,
    "serverNow": 1730816700000
  }
  ```
- Return `serverNow` so the display can correct for device clock drift.
- Access: display/state endpoint read-only and open; controls restricted by Workspace sign-in OR a club PIN (**not decided yet**).

### 2. Control page
Phone-friendly, big buttons:
- Presets: 8-End Draw (95 min), 6-End Draw (65 min), 2-hr, Mixed Doubles (configurable list)
  - End-based timing: when the clock runs out, teams finish the current end and play one more, so countdown ≈ (ends − 1.5) × ~14.6 min/end
- Start now / Start in N minutes (delayed start)
- Pause / Resume, +1 min / -1 min, Stop

### 3. Display page
- Static HTML/CSS/JS stored locally on the device (not served from Apps Script — avoids the Google iframe/banner and keeps working offline).
- Polls the state endpoint every 5-10 s; computes the countdown locally from `endsAt` + clock offset, so polling never makes the clock jump and an internet drop mid-draw doesn't stop it.
- Huge digits (MM:SS; 95 min fits), auto-scales to any screen.
- Whole background changes colour: normal → yellow at warning → red at zero.
- Plays start / warning / end sounds (mp3) through a powered speaker. Future: relay-triggered horn.

### Devices
- Raspberry Pi 4/5: Chromium `--kiosk` with `--autoplay-policy=no-user-gesture-required`, screen blanking off, launch on boot.
- Android TV box: Fully Kiosk Browser (launch on boot, keep screen on, allow autoplay).

## Background / alternatives considered
- Howard Griffin gametimer (howardgriffin.org/gametimer) — single local HTML page; control only on the Pi itself (keyboard/mouse/VNC).
- Eye on the Clock (github.com/T-Hugs/eyeontheclock) — beta; local server not yet released.
- Commercial LED gym timers / shot clocks — small digits or expensive.

## Open decisions
- Control access: Workspace sign-in vs club PIN
- Warning time default (e.g. 15 min before end)
- Pi vs Android TV box (design supports both)
- Sound files / horn
