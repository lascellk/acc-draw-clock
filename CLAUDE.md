# ACC Draw Clock

Countdown clock for the Almonte Curling Club rink. Keeps draws on schedule (default: 95-minute draw).

## Goal
- A TV in the rink shows a big countdown full-screen (kiosk mode).
- Members start a preset from their phone or a tablet by the door.
- Sounds at start and at time-up (the warning is silent).

## Repo layout
```
apps-script/   Apps Script backend: Code.gs (state + JSON API), Control.html (fallback control page), Logo.html
control/       Member control page, published to GitHub Pages by .github/workflows/pages.yml on push to main
display/       Local display page for the TV (index.html, display.js, config.js holds stateUrl)
pi/            Pi kiosk: deploy.sh (Git Bash on the PC) copies display/ to the Pi and runs setup.sh there
.clasp.json    Links apps-script/ to the Apps Script project
print/         Git-ignored, only on keith-t430: kiosk infographic (infographic.html, rendered to infographic.png at 12.5" x 5.5", 300 dpi, by node print/render-infographic.cjs) and tv-screens/ screenshots
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
    "blackoutFrom": "23:00",
    "blackoutTo": "08:00",
    "serverNow": 1730816700000
  }
  ```
- Return `serverNow` so the display can correct for device clock drift.
- Access: display/state endpoint read-only and open; controls require the club PIN (`CLUB_PIN` script property), checked server-side on every command.
- Bonspiel link: the ACC Bonspiel Manager (`D:\DEV\ACC_Apps\ACC_Bonspiel_Manager`, repo `lascellk/ACC-Bonspiel-Manager`) drives this clock with `doPost {cmd: "sync", key, arg}`, authorized by the `SYNC_KEY` script property (its `DRAW_CLOCK_KEY`), not the PIN. Its Start draw takes the clock (`takeOver`, runId `bsp-<drawId>`) for any scoreboard draw with Show timer ticked, bonspiel or ad-hoc (decided 2026-11-15; unticking Show timer keeps a draw off this clock); its pause/adjust/reset only apply while the clock still shows that draw, so league draws started here are never interrupted. Either app must keep working without the other. Unset `SYNC_KEY` = link off. A synced draw has `source: "bonspiel"` in the state; both control pages then show "Scoreboard draw: run it from the Bonspiel Manager" and confirm before any change (override allowed, decided 2026-11-14; changes made here don't reach the scoreboard).

### 2. Control page
Hosted on **GitHub Pages** (`control/` → https://lascellk.github.io/acc-draw-clock/), not Apps Script: Apps Script pages fail with "Sorry, unable to open the file" on phones signed in to several Google accounts. It calls the `/exec` JSON API (`doPost`, `?mode=config|state`) with plain fetch. It opens on a PIN screen; the controls show only after the server accepts the PIN. `noindex` keeps it out of search results. The repo is public (required for free Pages), so no secrets go in it.

Phone-friendly, big buttons:
- Presets: 8-End Draw (95 min), 6-End Draw (65 min), Mixed Doubles (configurable list, `PRESETS` in `Code.gs`)
- Custom: user-entered minutes (1–240, `MAX_CUSTOM_MIN`), labelled "N-min Countdown"; optional warning minutes (0 = none, must be less than the countdown), blank = a quarter of the time, capped at the usual 15. `?mode=config` returns `maxCustomMin` and `warningMin` for the form. Replaced the 2-hr preset (2026-11-06). The fallback Apps Script control page has no Custom button.
  - End-based timing: when the clock runs out, teams finish the current end and play one more, so countdown ≈ (ends − 1.5) × ~14.6 min/end
- Start now / Start in N minutes (delayed start)
- Pause / Resume, +1 min / -1 min, Stop
- The delay choice (kept on each phone) goes back to "Now" when the draw ends or is stopped

### 3. Display page
- Static HTML/CSS/JS stored locally on the device (not served from Apps Script — avoids the Google iframe/banner and keeps working offline).
- Polls the state endpoint every 5-10 s; computes the countdown locally from `endsAt` + clock offset, so polling never makes the clock jump and an internet drop mid-draw doesn't stop it.
- Huge digits (MM:SS; 95 min fits), auto-scales to any screen.
- Delayed start: "Draw starts in:" on top, smaller gold digits (40% of the height instead of 62%), the draw name and start time below.
- Whole background changes colour: normal → yellow at warning → red at zero.
- Plays start and time-up sounds (mp3) through the TV/speaker. No sound at the warning (curlers could take it for time-up), only the yellow screen. Future: relay-triggered horn.
- Night blackout: black screen from `BLACKOUT_FROM` to `BLACKOUT_TO` (script properties, default 23:00-08:00, sent in the state) while idle; any draw wakes it. Test with `?night=1`.

### Devices
- Raspberry Pi 4 (main): built and online. `acc-admin@acc-clock.local`, Raspberry Pi OS 64-bit (Debian 13 Trixie), labwc desktop with autologin, browser is `chromium`. This PC logs in by SSH key; `sudo` needs a password, so keep Pi setup to user-level changes.
  - Chromium `--kiosk` with `--autoplay-policy=no-user-gesture-required`, started from `~/.config/labwc/autostart` via `lwrespawn`; screen blanking off (no `swayidle` line).
  - **Overlay file system ON, boot partition read-only** (since 2026-11-06). Any change on the Pi, including `sh pi/deploy.sh`, lasts only until the next reboot. To make a lasting change the user turns the overlay off in `sudo raspi-config` (Performance → Overlay File System) and reboots, then the change is made, then the overlay goes back on. Check with `findmnt -no FSTYPE /` (`overlay` = on). Tell the user when a display deploy won't survive a reboot.
  - Remote access: Tailscale (tailnet owned by lascellesk@gmail.com, set up 2026-11-06). SSH as `acc-admin@acc-clock.taile237ab.ts.net` from anywhere; `pi/deploy.sh` uses it by default. This PC (`keith-t430`, a PowerEdge T430 server, not a laptop) is on the tailnet in unattended mode. Key expiry is disabled for the Pi. Raspberry Pi Connect is also on, for the user only (browser, Raspberry Pi ID).
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
- Git: before starting any change, `git pull --ff-only` so work starts from the latest GitHub code (the user works from several machines). If the pull can't fast-forward (local and GitHub have both changed), stop and tell the user. Commit and push to `main` after each finished change, without asking. Never force-push.
- Backend: if `apps-script/` changed, also `clasp --user clubmgr push --force` then `clasp --user clubmgr update-deployment <deployment ID> --description "<note>"`, without asking.
- Control page: any push to `main` that touches `control/` republishes https://lascellk.github.io/acc-draw-clock/.
- Display: if `display/` or `pi/` changed, also run `sh pi/deploy.sh` (Git Bash) to update the Pi, without asking. While the overlay is on this only lasts until the next reboot (see Devices), so say so.

## Background / alternatives considered
- Howard Griffin gametimer (howardgriffin.org/gametimer) — single local HTML page; control only on the Pi itself (keyboard/mouse/VNC).
- Eye on the Clock (github.com/T-Hugs/eyeontheclock) — beta; local server not yet released.
- Commercial LED gym timers / shot clocks — small digits or expensive.

## Decided
- Control access: club PIN (members mostly don't have club Workspace accounts)
- Warning default: 15 min (`WARNING_MIN` script property or per preset)
- Display device: Raspberry Pi 4 (Raspberry Pi OS 64-bit with desktop); Android box is the spare
- Theme: club logo colours (navy/red/gold/cream); warning stays bright yellow for visibility
- Buzzer on/off toggle on the control page, default on. Off lasts one draw (stored on the server, shared by all phones): back on at Stop, at auto-clear, or 1 min after time's up; off with no draw on the clock mutes the next draw
- Time's-up screen clears itself 25 min after zero, so a 95-min draw is back to the logo 2 h after it starts (`CLEAR_AFTER_MIN` script property, 0 = never); server, display and control page all apply it

## Open decisions
- Lockout after repeated wrong PINs (not built yet)
- Sound files / horn relay

## Wear OS watch app (v1 built, being tested)
Agreed 2026-11-26. Android Studio and watch pairing done on keith-t430 2026-11-27; skeleton in `wear/` (Gradle 9.9.3 wrapper, AGP 9.5.3 with built-in Kotlin, Kotlin 2.4.21 compose plugin, Wear Compose Material3 1.7.2, compileSdk 37, minSdk 33) builds with `./gradlew assembleDebug`, JAVA_HOME = Android Studio's `jbr`. v1 (2026-11-27): Api.kt (manual redirect follow for POST), PinStore.kt (Keystore AES-GCM), ClockViewModel.kt (5 s poll only while started), ClockView.kt (same render rules as control/index.html), MainActivity.kt (Wear Compose M3 screens). Install: `adb install -r app/build/outputs/apk/debug/app-debug.apk`.
- For the user only, on a Google Pixel Watch 1 (checked 2026-11-27: Android 15 / API 35, Wear OS 6, build BW1A.260305.003): sideloaded from Android Studio, no Play Store, no developer account, no release signing key. minSdk 33 (Wear OS 4) is enough.
- Native app (Wear OS has no browser, so the GitHub Pages control page can't be reused): Kotlin + Compose for Wear OS, in a new `wear/` folder. No backend changes; it uses the same `/exec` API as `control/` (`?mode=config`, `?mode=state`, `doPost` text/plain `{pin, cmd, arg}`). Test early that the Apps Script POST redirect is followed correctly.
- v1 screens: PIN screen on first use (`cmd: "verify"`, then kept in encrypted storage on the watch); main screen with draw name + live countdown from `endsAt`/`serverNow`, yellow at warning, red at zero; presets from `?mode=config`, Pause/Resume, +/-1 min, Stop, buzzer toggle; bonspiel notice + confirm when `source: "bonspiel"`. Custom added 2026-11-27 (minutes picker, automatic warning); delayed start stays phone-only. Poll only while the app is open (battery).
- Later, if wanted: tile (time left + Start/Pause), and a watch-face complication that counts down from `endsAt` on its own without polling.
- User setup first: install Android Studio (with SDK + Wear OS emulator); on the watch tap Settings → System → About → Versions → Build number 7×, then turn on ADB debugging and Wireless debugging; pair in Android Studio (Device Manager → Pair devices using Wi-Fi). Watch and PC on the same Wi-Fi. On keith-t430 (2026-11-27): Android Studio installed (SDK platform 37, no Wear emulator image; the emulator may not run on this Windows Server box anyway). Watch paired with `adb pair` from the command line, since Device Manager's Wi-Fi pairing only shows with a project open: read the current pairing port with `adb mdns services`, and keep the watch screen awake, as its Wi-Fi sleeps with the screen. It reconnects by itself through mDNS while Wireless debugging is on. The old standalone `C:\adb` (v31) was taken off the system PATH and the SDK's `platform-tools` added to the user PATH, so only Android Studio's adb runs (the folder itself is still there).
- Repo is public: no PIN or keystore in `wear/`; add Android build output (`build/`, `.gradle/`, `local.properties`, `.idea/`) to `.gitignore`.

## Installed
- Pi installed at the rink 2026-11-14: same Wi-Fi extender, switched to the club Wi-Fi, Pi on its Ethernet port (DHCP, no Pi changes, overlay still on). Checked over Tailscale the same day: kiosk running, logo + time on screen, HDMI is the default sink at full volume, internet and the state endpoint reachable. Tailscale goes through a DERP relay at the club (no direct connection), which is fine for SSH.
- Louder built-in tones (`display.js`: gain 0.35 → 0.9, start 1.5/2 kHz, time-up 4 × 1 s blasts at 1 kHz) deployed to the Pi 2026-11-27 with the overlay off, then overlay back on; confirmed after reboot. Tested at the rink by the user the same day: much better.
- Tested on site by the user 2026-11-14: draw start from a phone, Custom countdown with warning, start and time-up sounds through the TV, silent yellow warning, red at zero. All working as designed.
