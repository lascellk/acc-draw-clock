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

# 2. Hide the mouse pointer. The page's CSS only hides it once the mouse moves, so at boot
#    it would sit on top of the clock. Instead give labwc a cursor theme whose pointers are
#    a single transparent pixel (takes effect at the next login/reboot).
#    To get a visible pointer back: delete the XCURSOR_THEME line from $ENVFILE and reboot.
ENVFILE="$HOME/.config/labwc/environment"
THEME_DIR="$HOME/.local/share/icons/acc-blank"
mkdir -p "$THEME_DIR/cursors"
printf '[Icon Theme]\nName=acc-blank\nComment=Invisible pointer for the ACC Draw Clock kiosk\n' > "$THEME_DIR/index.theme"
# Xcursor file: 16-byte header, one table entry, one 1x1 fully transparent image (nominal size 24).
printf 'Xcur\020\000\000\000\000\000\001\000\001\000\000\000\002\000\375\377\030\000\000\000\034\000\000\000\044\000\000\000\002\000\375\377\030\000\000\000\001\000\000\000\001\000\000\000\001\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000\000' \
  > "$THEME_DIR/cursors/default"
for name in left_ptr arrow top_left_arrow pointer hand1 hand2 text xterm wait watch progress \
    left_ptr_watch crosshair cross move grab grabbing all-scroll not-allowed help \
    n-resize s-resize e-resize w-resize ne-resize nw-resize se-resize sw-resize \
    ew-resize ns-resize nesw-resize nwse-resize col-resize row-resize \
    top_side bottom_side left_side right_side top_left_corner top_right_corner \
    bottom_left_corner bottom_right_corner sb_h_double_arrow sb_v_double_arrow; do
  ln -sf default "$THEME_DIR/cursors/$name"
done
touch "$ENVFILE"
sed -i '/^XCURSOR_THEME=/d' "$ENVFILE"
echo 'XCURSOR_THEME=acc-blank' >> "$ENVFILE"
echo "Mouse pointer hidden (from next reboot)"

# 3. Sound output. WirePlumber remembers the default by name, so it survives reboots
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
