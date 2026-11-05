#!/bin/sh
# Copy the display page to the Pi, run setup.sh there, and restart the kiosk browser.
# Run from the repo root in Git Bash:   sh pi/deploy.sh [hdmi|jack]
# Needs SSH key login to the Pi. Override the target with PI=user@host.
set -eu

PI="${PI:-acc-admin@acc-clock.local}"
AUDIO="${1:-hdmi}"
cd "$(dirname "$0")/.."

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
