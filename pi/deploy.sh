#!/bin/sh
# Copy the display page to the Pi, run setup.sh there, and restart the kiosk browser.
# Run from the repo root in Git Bash:   sh pi/deploy.sh [hdmi|jack]
# Needs SSH key login to the Pi. Override the target with PI=user@host.
set -eu

PI="${PI:-acc-admin@acc-clock.taile237ab.ts.net}"  # Tailscale name: works at home and at the club
AUDIO="${1:-hdmi}"
cd "$(dirname "$0")/.."

# With the overlay file system on, everything written to the SD card is really kept in
# memory, so this update would vanish at the next reboot. Still deploy (it's live until
# then), but say so clearly at the start and the end.
OVERLAY=no
[ "$(ssh "$PI" 'findmnt -no FSTYPE /')" = overlay ] && OVERLAY=yes
overlay_warning() {
  echo ""
  echo "*** WARNING: the Pi's overlay file system is ON. This update is live now but will be"
  echo "*** LOST at the next reboot or power cut. To keep it: turn the overlay off in"
  echo "*** 'sudo raspi-config' (Performance > Overlay File System), reboot, run this again,"
  echo "*** then turn the overlay back on and reboot."
  echo ""
}
[ "$OVERLAY" = yes ] && overlay_warning

echo "Copying display/ to $PI:~/acc-clock"
tar -C display -cf - . | ssh "$PI" 'set -e; rm -rf ~/acc-clock.new; mkdir ~/acc-clock.new; tar -C ~/acc-clock.new -xf -; rm -rf ~/acc-clock; mv ~/acc-clock.new ~/acc-clock'

ssh "$PI" "sh -s $AUDIO" < pi/setup.sh

# Load the new files: start the kiosk if it isn't running, otherwise restart Chromium
# (lwrespawn brings it straight back).
# An SSH login lacks the desktop's session variables (Chromium exits without them),
# so copy them from the running labwc.
ssh "$PI" 'set -e
  wm=$(pgrep -xo labwc) || { echo "Desktop not running; the kiosk will start at next login/reboot"; exit 0; }
  for v in $(tr "\0" "\n" < /proc/$wm/environ | grep -E "^(XDG_[A-Z_]*|DBUS_SESSION_BUS_ADDRESS)="); do export "$v"; done
  export WAYLAND_DISPLAY=wayland-0
  if pgrep -f "[l]wrespawn .*acc-clock" >/dev/null; then pkill -x chromium || true; echo "Kiosk restarted"
  else line=$(grep "acc-clock/index.html" ~/.config/labwc/autostart); nohup sh -c "$line" >/dev/null 2>&1 & echo "Kiosk started"; fi'

[ "$OVERLAY" = yes ] && overlay_warning
exit 0
