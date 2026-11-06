# ACC Draw Clock

Countdown clock for the Almonte Curling Club rink. Keeps draws on schedule (default: 95-minute draw).

## Goal
- A TV in the rink shows a big countdown full-screen (kiosk mode).
- Members start a preset from their phone or a tablet by the door.
- Sounds at start, at the warning, and at time-up.

## Repo layout
```
apps-script/   Apps Script backend: Code.gs (state + JSON API), Control.html (fallback control page), Logo.html
control/       Member control page, published to GitHub Pages by .github/workflows/pages.yml on push to main
display/       Local display page for the TV (index.html, display.js, config.js holds stateUrl)
pi/            Pi kiosk: deploy.sh (Git Bash on the PC) copies display/ to the Pi and runs setup.sh there
.clasp.json    Links apps-script/ to the Apps Script project
```

## Architecture
```
[Phone / tablet]  --POST /exec-->  [Google Apps Script web app]  <--GET ?mode=state every 5-10 s--  [Display page on Pi]  -->  TV + powered speaker
 control page on GitHub Pages        state + JSON API                                          local HTML, counts down itself
```

### 1. Apps Script web app (hosted in the club's Google Workspace)
- `doGet`:
  - `?mode=state`: JSON state for the display (open, read-only)
  - `?mode=config`: preset list and whether a PIN is required (used by the control page)
  - no mode: the fallback Apps Script control page (HtmlService); members use the GitHub Pages page instead
- `doPost`: commands from the control page, `{pin, cmd, arg}` sent as text/plain to avoid a CORS preflight. `cmd: "verify"` checks the PIN without changing anything.
- Stores state in PropertiesService (optionally logs actions to a Google Sheet via `LOG_SHEET_ID`).
- Presets are the `PRESETS` array at the top of `Code.gs`.
- State shape:
  ```json
  {
    "status": "idle | running | paused",
    "label": "95-min Draw",
    "endsAt": 1730822400000,
    "remainingMsWhenPaused": null,
    "warningMin": 15,
    "buzzer": true,
    "clearAfterMin": 25,
    "serverNow": 1730816700000
  }
  ```
- Return `serverNow` so the display can correct for device clock drift.
- Access: display/state endpoint read-only and open; controls require the club PIN (`CLUB_PIN` script property), checked server-side on every command.

### 2. Control page
Hosted on **GitHub Pages** (`control/` → https://lascellk.github.io/acc-draw-clock/), not Apps Script: Apps Script pages fail with "Sorry, unable to open the file" on phones signed in to several Google accounts. It calls the `/exec` JSON API (`doPost`, `?mode=config|state`) with plain fetch. It opens on a PIN screen; the controls show only after the server accepts the PIN. `noindex` keeps it out of search results. The repo is public (required for free Pages), so no secrets go in it.

Phone-friendly, big buttons:
- Presets: 8-End Draw (95 min), 6-End Draw (65 min), Mixed Doubles (configurable list, `PRESETS` in `Code.gs`)
- Custom: user-entered minutes (1–240, `MAX_CUSTOM_MIN`), labelled "N-min Countdown"; warning = a quarter of the time, capped at the usual 15. Replaced the 2-hr preset (2026-11-06). The fallback Apps Script control page has no Custom button.
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
- Raspberry Pi 4 (main): built and online. `acc-admin@acc-clock.local`, Raspberry Pi OS 64-bit (Debian 13 Trixie), labwc desktop with autologin, browser is `chromium`. This PC logs in by SSH key; `sudo` needs a password, so keep Pi setup to user-level changes.
  - Chromium `--kiosk` with `--autoplay-policy=no-user-gesture-required`, started from `~/.config/labwc/autostart` via `lwrespawn`; screen blanking off (no `swayidle` line).
  - Network: Ethernet only. Wi-Fi radio turned off 2026-11-05 at the user's request (`sudo nmcli radio wifi on|off`; needs the user's password). Hidden pointer confirmed after reboot.
  - Sound: TV over HDMI for now (`sh pi/deploy.sh`); `jack` option for the 3.5 mm output later.
  - Commands run over SSH that touch the desktop need the labwc session env (`XDG_*`, `DBUS_SESSION_BUS_ADDRESS`, `WAYLAND_DISPLAY=wayland-0`); `grim` takes screenshots to check the screen.
- Android TV box (spare): Fully Kiosk Browser (launch on boot, keep screen on, allow autoplay).

## Deployment
- Apps Script project is in the club shared drive (Countdown Timer folder), owned by clubmgr@almontecurling.ca.
  - Script ID: `1ANzTEOKjTfNg-e0ZKoscBr1KnpcQCElu_LGk6PRJEQEwaunDlsk4GguP`
  - Web app deployment ID: `AKfycbwU_wM84nwdgzD-wbVRGAq7vwXXuVEgfHiOFh1I4ZcPjYek5JcBRp7nkUwduYVeRo8T`. Update this deployment in place (`clasp update-deployment <id>`) so the `/exec` URL never changes; that URL is hard-coded in `control/index.html` (`API_URL`) and `display/config.js` (`stateUrl`).
  - Always run clasp as `clasp --user clubmgr ...`. The default clasp login on this machine is rentals@almontecurling.ca, which is for the Rental Manager.
  - Don't `clasp pull`/`clasp clone`: they overwrite `appsscript.json`.
- Git: commit and push to `main` after each finished change, without asking. Never force-push.
- Backend: if `apps-script/` changed, also `clasp --user clubmgr push --force` then `clasp --user clubmgr update-deployment <deployment ID> --description "<note>"`, without asking.
- Control page: any push to `main` that touches `control/` republishes https://lascellk.github.io/acc-draw-clock/.
- Display: if `display/` or `pi/` changed, also run `sh pi/deploy.sh` (Git Bash) to update the Pi, without asking.

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
- Time's-up screen clears itself 25 min after zero, so a 95-min draw is back to the logo 2 h after it starts (`CLEAR_AFTER_MIN` script property, 0 = never); server, display and control page all apply it

## Open decisions
- Lockout after repeated wrong PINs (not built yet)
- Sound files / horn relay
- Pi: kiosk comes up after reboot (confirmed 2026-11-05); hidden pointer needs confirming after a reboot. Last step: overlay file system (needs `sudo raspi-config`, done by the user)
