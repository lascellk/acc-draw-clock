#!/bin/sh
# ACC Draw Clock: turn a Raspberry Pi (Raspberry Pi OS with desktop, labwc) into the clock kiosk.
# Runs on the Pi as the desktop user, no sudo needed. Safe to run again.
#
#   sh setup.sh [hdmi|jack]     sound through the TV (hdmi, default) or the 3.5 mm jack
#
# Normally run from a PC with pi/deploy.sh, which also copies the display files.
set -eu

AUDIO="${1:-hdmi}"
CLOCK_DIR="$HOME/acc-clock"
AUTOSTART="$HOME/.config/labwc/autostart"
BEGIN='# >>> acc-draw-clock >>>'
END='# <<< acc-draw-clock <<<'

case "$AUDIO" in hdmi|jack) ;; *) echo "Audio must be hdmi or jack, not '$AUDIO'" >&2; exit 2 ;; esac
[ -f "$CLOCK_DIR/index.html" ] || { echo "Missing $CLOCK_DIR/index.html: copy display/ there first" >&2; exit 1; }

BROWSER=$(command -v chromium || command -v chromium-browser || true)
[ -n "$BROWSER" ] || { echo "Chromium not found" >&2; exit 1; }

# 1. Kiosk browser on login. labwc-pi starts labwc with -m, so this file runs as well as
#    the system autostart (desktop, panel). lwrespawn restarts Chromium if it closes.
#    No swayidle line here = screen never blanks (that's how raspi-config turns blanking on).
mkdir -p "$(dirname "$AUTOSTART")"
touch "$AUTOSTART"
tmp=$(mktemp)
sed "/^$BEGIN\$/,/^$END\$/d; /swayidle/d" "$AUTOSTART" > "$tmp"
cat >> "$tmp" <<EOF
$BEGIN
/usr/bin/lwrespawn $BROWSER --kiosk --noerrdialogs --disable-infobars --incognito --no-first-run --password-store=basic --check-for-update-interval=31536000 --autoplay-policy=no-user-gesture-required --allow-file-access-from-files file://$CLOCK_DIR/index.html &
$END
EOF
mv "$tmp" "$AUTOSTART"
echo "Kiosk autostart written to $AUTOSTART (screen blanking off)"

# 2. Sound output. WirePlumber remembers the default by name, so it survives reboots
#    and comes back when the TV is switched on again.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [ "$AUDIO" = hdmi ]; then pattern='\.hdmi'; else pattern='mailbox|Headphones|headphones|bcm2835'; fi
sink=""
for id in $(wpctl status 2>/dev/null | sed -n '/^Audio/,/^Video/p' | sed -n '/Sinks:/,/Sources:/p' | grep -oE '[0-9]+\.' | tr -d .); do
  if wpctl inspect "$id" | grep 'node.name' | grep -Eq "$pattern"; then sink=$id; break; fi
done
if [ -n "$sink" ]; then
  wpctl set-default "$sink"
  wpctl set-volume "$sink" 1.0
  echo "Sound: $AUDIO (sink $sink, volume 100%; use the TV or speaker volume)"
else
  echo "WARNING: no $AUDIO sound output found. Is the TV on and the desktop logged in? Run this again later." >&2
fi
