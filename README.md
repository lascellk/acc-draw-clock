# ACC Draw Clock — setup

```
apps-script/   Google Apps Script web app (control page + JSON state)
display/       Local display page for the TV (Pi / Android TV box)
```

## 1. Try the display (no server needed)

Open `display/index.html?demo=1&warn=0.5` in Chrome. That runs a 1-minute demo with a 30-second warning.
- Press **F** for fullscreen.
- Press **1 / 2 / 3** to test the start, warning and end sounds.
- Click once if a "Sound is blocked" bar appears.

## 2. Deploy the Apps Script web app

### With clasp (how it's set up now)
The project lives in the club shared drive (Countdown Timer folder), owned by clubmgr@almontecurling.ca. It's linked to this repo through `.clasp.json`.
- Script editor: <https://script.google.com/d/1ANzTEOKjTfNg-e0ZKoscBr1KnpcQCElu_LGk6PRJEQEwaunDlsk4GguP/edit>
- Web app URL: <https://script.google.com/macros/s/AKfycbwU_wM84nwdgzD-wbVRGAq7vwXXuVEgfHiOFh1I4ZcPjYek5JcBRp7nkUwduYVeRo8T/exec>

To ship a code change while keeping the same URL:
```
clasp push
clasp update-deployment AKfycbwU_wM84nwdgzD-wbVRGAq7vwXXuVEgfHiOFh1I4ZcPjYek5JcBRp7nkUwduYVeRo8T --description "what changed"
```
Avoid `clasp pull`/`clasp clone`: they overwrite `appsscript.json` with Google's copy.

### By hand (copy and paste)
1. Signed in to the club Google account, go to <https://script.google.com> → **New project**. Name it "ACC Draw Clock".
2. Replace `Code.gs` with [apps-script/Code.gs](apps-script/Code.gs).
3. **+ → HTML**, name it `Control` and paste in [apps-script/Control.html](apps-script/Control.html). Do the same for `Logo` with [apps-script/Logo.html](apps-script/Logo.html), which holds the club logo as an embedded image.
4. **Project Settings** → tick "Show appsscript.json". Replace it with [apps-script/appsscript.json](apps-script/appsscript.json).
5. Optional: **Project Settings → Script properties**
   | Property | Meaning |
   |---|---|
   | `CLUB_PIN` | PIN needed to use the controls. Leave unset for open controls. |
   | `WARNING_MIN` | Minutes before the end when the warning starts (default 15) |
   | `LOG_SHEET_ID` | Spreadsheet ID to log every button press to |
6. **Deploy → New deployment → Web app**, with *Execute as: Me* and *Who has access: Anyone*. Authorize it, then copy the URL that ends in `/exec`.
   - Every later code change needs **Deploy → Manage deployments → Edit → Version: New version**. That keeps the same URL.
7. Open the `/exec` URL on a phone to get the control page. Add it to the home screen, and put a QR code by the door.

To change the preset buttons, edit `PRESETS` at the top of `Code.gs` and redeploy.

## 3. Point the display at it

Paste the `/exec` URL into `stateUrl` in [display/config.js](display/config.js). Or add it to the page address: `index.html?url=https://script.google.com/macros/s/.../exec`.

To use your own sounds, add `start.mp3`, `warning.mp3` and `end.mp3` to `display/sounds/`. Any file that's missing falls back to a built-in tone.

## 4. Kiosk devices

### Raspberry Pi (Pi OS Bookworm, desktop)
1. Copy `display/` to `/home/pi/acc-clock/`.
2. `sudo raspi-config` → Display Options → Screen Blanking → **Off**.
3. Add the line below to `~/.config/labwc/autostart` (Bookworm's default compositor). On older Wayfire images, use `~/.config/wayfire.ini` `[autostart]` instead.
   ```
   chromium-browser --kiosk --noerrdialogs --disable-infobars --incognito \
     --autoplay-policy=no-user-gesture-required \
     --allow-file-access-from-files \
     file:///home/pi/acc-clock/index.html
   ```
4. Plug the powered speaker into the 3.5 mm jack or use HDMI audio. Pick the output from the volume icon on the taskbar.

### Android TV box
Install **Fully Kiosk Browser** and copy `display/` to the box's storage. Set:
- Start URL: `file:///sdcard/acc-clock/index.html`
- Launch on boot: on
- Keep screen on: on
- Autoplay audio/video: on

## How it behaves
- The display checks the server every 5 s. It works out the countdown itself from `endsAt` plus the server clock offset, so if the internet drops mid-draw the clock keeps going. A small "Offline" note shows in the corner.
- Background colours: navy while running, blue before a delayed start, yellow at the warning, red flashing at zero. When nothing is running, it shows the time of day.
- Sounds only play on changes the display sees as they happen, so rebooting the TV mid-draw won't sound the start horn again.
- The control page shows the same countdown as the display. It also has Start now / in 5-10-15 min, Pause/Resume, ±1 min and Stop.
