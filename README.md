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
A setup script for this is planned. Until it exists, do it by hand:
1. Copy `display/` to `~/acc-clock/` on the Pi, for example with `scp -r display <user>@acc-clock.local:~/acc-clock`.
2. Run `sudo raspi-config`:
   - Display Options → Screen Blanking → **Off**
   - System Options → Audio → **Headphones**
3. Add the line below to `~/.config/labwc/autostart`. Newer releases (based on Debian "Trixie") name the browser `chromium`; older Bookworm releases call it `chromium-browser`. Run `which chromium chromium-browser` to see which one you have.
   ```
   chromium --kiosk --noerrdialogs --disable-infobars --incognito \
     --autoplay-policy=no-user-gesture-required \
     --allow-file-access-from-files \
     file:///home/<user>/acc-clock/index.html
   ```
4. Reboot. The clock should come up fullscreen. Use `?demo=1&warn=0.5` to check the colours and sounds.

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
  - **Bright yellow with black digits** at the warning: the last 15 min, or whatever `WARNING_MIN` is set to.
  - **Club red with blinking white `00:00`** at time up, plus how long it's been over.
  - When nothing is running, it shows the club logo and the time of day.
- The **Buzzer** checkbox on the control page mutes or unmutes the TV's sounds. It's on by default and stays as set across draws.
- Sounds only play on changes the display sees as they happen, so rebooting the TV mid-draw won't sound the start horn again.
- The control page shows the same countdown as the display. It also has Start now / in 5-10-15 min, Pause/Resume, ±1 min and Stop.
