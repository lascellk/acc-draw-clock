# ACC Draw Clock — setup

```
apps-script/   Google Apps Script web app (JSON API + state; also a fallback control page)
control/       Member control page, published to GitHub Pages
display/       Local display page for the TV (Pi / Android TV box)
pi/            Pi kiosk setup: deploy.sh (run on a PC) copies display/ and runs setup.sh on the Pi
```

**Members use: <https://lascellk.github.io/acc-draw-clock/>** (put this in the QR code)

The control page is hosted on GitHub Pages, not Apps Script. Apps Script's own pages fail with "Sorry, unable to open the file at this time" on phones signed in to more than one Google account. The GitHub page talks to the Apps Script `/exec` URL with plain requests, so Google sign-in never comes into it. Every push that changes `control/` republishes it automatically (see `.github/workflows/pages.yml`).

## 1. Try the display (no server needed)

Open `display/index.html?demo=1&warn=0.5` in Chrome. That runs a 1-minute demo with a 30-second warning.
- Press **F** for fullscreen.
- Press **1 / 2** to test the start and end sounds. (The warning is silent.)
- Add `&night=1` to see the night blackout (a black screen).
- Click once if a "Sound is blocked" bar appears.

## 2. Deploy the Apps Script web app

### With clasp (how it's set up now)
The project lives in the club shared drive (Countdown Timer folder), owned by clubmgr@almontecurling.ca. It's linked to this repo through `.clasp.json`.
- Script editor: <https://script.google.com/d/1ANzTEOKjTfNg-e0ZKoscBr1KnpcQCElu_LGk6PRJEQEwaunDlsk4GguP/edit>
- Web app URL: <https://script.google.com/macros/s/AKfycbwU_wM84nwdgzD-wbVRGAq7vwXXuVEgfHiOFh1I4ZcPjYek5JcBRp7nkUwduYVeRo8T/exec>

To ship a code change while keeping the same URL:
```
clasp --user clubmgr push
clasp --user clubmgr update-deployment AKfycbwU_wM84nwdgzD-wbVRGAq7vwXXuVEgfHiOFh1I4ZcPjYek5JcBRp7nkUwduYVeRo8T --description "what changed"
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
   | `CLEAR_AFTER_MIN` | Minutes after time-up before the draw clears itself and the display goes back to the logo (default 25; `0` = stay until someone presses Stop) |
   | `LOG_SHEET_ID` | Spreadsheet ID to log every button press to |
6. **Deploy → New deployment → Web app**, with *Execute as: Me* and *Who has access: Anyone*. Authorize it, then copy the URL that ends in `/exec`.
   - Every later code change needs **Deploy → Manage deployments → Edit → Version: New version**. That keeps the same URL.
7. The `/exec` URL also serves a control page, but give members the GitHub Pages link above instead. If you redeploy to a **new** URL, update `API_URL` in [control/index.html](control/index.html) and `stateUrl` in [display/config.js](display/config.js).

To change the preset buttons, edit `PRESETS` at the top of `Code.gs` and redeploy.

## 3. Point the display at it

Paste the `/exec` URL into `stateUrl` in [display/config.js](display/config.js). Or add it to the page address: `index.html?url=https://script.google.com/macros/s/.../exec`.

To use your own sounds, add `start.mp3` and `end.mp3` to `display/sounds/`. Any file that's missing falls back to a built-in tone.

## 4. Kiosk devices

The **Raspberry Pi 4** is the main display device. The Android box is the spare. The Pi was chosen because:
- Chromium's kiosk flag removes the browser's sound block completely.
- It can be updated over SSH.
- Its GPIO pins can drive a horn relay later.
- It doesn't install surprise firmware updates or show pop-ups.

### Raspberry Pi 4

#### 1. Install the OS
Use the standard **Raspberry Pi OS (64-bit) with desktop**: not Lite (it has no desktop or browser) and not Full (it adds apps we don't need).

1. On a PC, install **Raspberry Pi Imager** from <https://www.raspberrypi.com/software/>.
2. Choose:
   - Device: **Raspberry Pi 4**
   - OS: **Raspberry Pi OS (64-bit)**
   - Storage: a good 32 GB card, such as a SanDisk High Endurance or a Samsung PRO Endurance. Keep a spare.
3. At **OS customisation**, click **Edit settings**:
   - Hostname: `acc-clock`
   - Username / password: record these with the club's admin notes
   - Wi-Fi: the rink's network (wired Ethernet is more reliable if there's a jack)
   - Locale: time zone `America/Toronto`, keyboard `us`
   - Services: enable **SSH** with password login
4. Write the card. Connect the TV by HDMI and the powered speaker to the **3.5 mm jack**, then boot. The first boot takes a few minutes.
5. Check you can reach it from a PC on the same network: `ssh <user>@acc-clock.local`

#### 2. Set up the kiosk
The club Pi is `acc-admin@acc-clock.local` on the same network, and `acc-admin@acc-clock.taile237ab.ts.net` from anywhere through Tailscale. It's set up from a PC with the scripts in `pi/`.

**Remote access (Tailscale).** The Pi and the admin PC are on a private Tailscale network (lascellesk@gmail.com's account), so SSH and `pi/deploy.sh` work wherever the Pi is, with no changes to the club router. Key expiry is turned off for the Pi in the Tailscale admin page; otherwise it would have to log in again every 180 days, which the overlay file system wouldn't keep. To add another PC, install Tailscale on it and sign in to the same account. Raspberry Pi Connect (connect.raspberrypi.com) is also on, for screen sharing and a browser terminal.

1. **One time: SSH key login.** In Git Bash, run `ssh-keygen -t ed25519` if you don't have a key yet. Then in PowerShell run this and type the Pi password once:
   ```
   type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh acc-admin@acc-clock.local "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
   ```
2. **Set up or update.** From the repo folder in Git Bash:
   ```
   sh pi/deploy.sh          # sound through the TV (HDMI)
   sh pi/deploy.sh jack     # sound through the 3.5 mm jack instead
   ```
   It copies `display/` to `~/acc-clock` on the Pi and runs [pi/setup.sh](pi/setup.sh) there, then starts or restarts the kiosk. Run it again any time `display/` changes. Use `PI=user@host sh pi/deploy.sh` for a different Pi. If the Pi's overlay file system is on (step 4), it still deploys, but it warns that the update will be lost at the next reboot.

What `setup.sh` does (no `sudo` needed):
- Adds Chromium in kiosk mode to `~/.config/labwc/autostart`, so it starts on login. The Pi logs in automatically. Pi OS's `lwrespawn` reopens Chromium within a second if it's closed or crashes.
- Keeps screen blanking off. On this desktop, blanking is a `swayidle` line in that same file, and the script removes it.
- Hides the mouse pointer from boot by giving the desktop an invisible cursor theme (`XCURSOR_THEME=acc-blank` in `~/.config/labwc/environment`). The page's own CSS only hides the pointer after the mouse moves. To get a visible pointer back for maintenance, delete that line and reboot.
- Sets the default sound output (HDMI or jack) at 100%; set the volume on the TV or speaker. The choice survives reboots and the TV being switched off and on.

To get to the desktop for maintenance, stop the kiosk over SSH: `pkill -f "[l]wrespawn /usr/bin/chromium"; pkill -x chromium`. A reboot or another deploy brings it back.

#### 3. Network: build at home, run at the club
The Pi is set up on a home network, then moved to the rink. Options, best first:

**A. Wi-Fi extender as an Ethernet bridge (preferred)**
The extender joins the club Wi-Fi, and the Pi plugs into the extender's Ethernet port. The Pi just sees a wired network, so it needs no club-specific settings and can be finished completely at home.
- The extender must be in **Extender / Repeater** mode, not **Access Point** mode (Access Point mode expects an incoming cable). Check that its Ethernet port gives internet in that mode.
- Place the extender where the club Wi-Fi signal is strong, and run a cable to the Pi.
- At home: set the extender up on the home Wi-Fi, plug the Pi in, and check that a draw started from a phone shows on the TV. Also unplug the extender and plug it back in, to check it reconnects on its own after a power cut.
- At the club: use the extender's app to switch it to the club Wi-Fi. The Pi needs no changes.

**B. Pi on the club Wi-Fi directly**
Before leaving home, add the club network so the Pi joins it automatically at the rink. It's saved even though that network isn't in range:
```
sudo nmcli connection add type wifi con-name ACC-Club ifname wlan0 \
  ssid "<club wifi name>" wifi-sec.key-mgmt wpa-psk wifi-sec.psk "<club wifi password>" \
  connection.autoconnect yes
```
`sudo nmtui` does the same thing through a menu. It's worth doing with option A too, as a backup: the Pi prefers Ethernet when it's connected and falls back to the club Wi-Fi if the extender dies.

**At the club**
- Bring a USB keyboard. If the Pi doesn't get online, press **Ctrl+Alt+T** for a terminal and run `sudo nmtui` to fix the Wi-Fi details.
- If the club Wi-Fi has a **login or "accept terms" page**, neither the Pi nor the extender can click through it. You'd need a network without one, or have the device's address put on an allow list.
- If the network drops mid-draw, the clock keeps counting and shows "Offline" in the corner. It won't see button presses from phones until it reconnects.

#### 4. Protect against power cuts
Do this **last**: after any club Wi-Fi has been added (option B) and the Pi has worked at the club. With the overlay on, network and other changes are lost on reboot.

Once everything works, turn on **`sudo raspi-config` → Performance → Overlay File System**. Then a power cut can't corrupt the SD card, but changes are lost on reboot. To update the files later, turn the overlay off, reboot, make the change, then turn it back on.

Use the official Pi 4 power supply. An underpowered Pi gets unreliable.

### Android TV box (spare)
Install **Fully Kiosk Browser** and copy `display/` to the box's storage. Set:
- Start URL: `file:///sdcard/acc-clock/index.html`
- Launch on boot: on
- Keep screen on: on
- Autoplay audio/video: on

## How it behaves
- The display checks the server every 5 s. It works out the countdown itself from `endsAt` plus the server clock offset, so if the internet drops mid-draw the clock keeps going. A small "Offline" note shows in the corner.
- Background colours (club palette):
  - Dark navy while running, with cream digits.
  - Lighter navy before a delayed start.
  - **Bright yellow with black digits** at the warning: the last 15 min, or whatever `WARNING_MIN` is set to. The warning makes no sound, so curlers don't take it for time-up.
  - **Black from 23:00 to 08:00** while no draw is on the clock, since the TV stays on all the time. Starting a draw, even a delayed one, wakes it at once. Change the hours with the `BLACKOUT_FROM` / `BLACKOUT_TO` script properties (`HH:MM`; the same time for both turns it off). No Pi update needed.
  - **Club red with blinking white `00:00`** at time up, plus how long it's been over. After 25 minutes over (`CLEAR_AFTER_MIN`), so 2 hours after an 8-end draw starts, it clears itself and goes back to the logo. Stop or starting the next draw clears it sooner.
  - When nothing is running, it shows the club logo and the time of day.
- The **Buzzer** checkbox on the control page mutes or unmutes the TV's sounds. It's on by default and stays as set across draws.
- Sounds only play on changes the display sees as they happen, so rebooting the TV mid-draw won't sound the start horn again.
- The control page shows the same countdown as the display. It also has Start now / in 5-10-15 min, Pause/Resume, ±1 min and Stop.
- **Custom** starts a countdown of any length from 1 to 240 minutes. Tap it, type the minutes, then Start. The **Warning** box is optional: type how many minutes before the end the screen turns yellow (`0` = no warning), or leave it blank for the automatic warning. Automatic means a quarter of the time, up to the usual 15 minutes, so short countdowns don't start out yellow; the empty box shows that value, e.g. "auto 11". The phone remembers both numbers.
