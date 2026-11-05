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
- Access: display/state endpoint read-only and open; controls require the club PIN (`CLUB_PIN` script property), checked server-side on every command.

### 2. Control page
Hosted on **GitHub Pages** (`control/` → https://lascellk.github.io/acc-draw-clock/), not Apps Script: Apps Script pages fail with "Sorry, unable to open the file" on phones signed in to several Google accounts. It calls the `/exec` JSON API (`doPost`, `?mode=config|state`) with plain fetch. It opens on a PIN screen; the controls show only after the server accepts the PIN. `noindex` keeps it out of search results. The repo is public (required for free Pages), so no secrets go in it.

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

## Decided
- Control access: club PIN (members mostly don't have club Workspace accounts)
- Warning default: 15 min (`WARNING_MIN` script property or per preset)
- Display device: Raspberry Pi 4 (Raspberry Pi OS 64-bit with desktop); Android box is the spare
- Theme: club logo colours (navy/red/gold/cream); warning stays bright yellow for visibility
- Buzzer on/off toggle on the control page, default on

## Open decisions
- Lockout after repeated wrong PINs (not built yet)
- Sound files / horn relay
- Pi setup script (waiting on the Pi being built)
