#!/usr/bin/env bash
# Generates the Squirrel install animation: icon + title + operation label.
# Timeline approximates a typical 20-25s install, then holds at "Almost done"
# for the slow-machine tail. Frame every 0.5s. No progress bar — Squirrel gives
# no real progress signal, so a bar would just be a fake timeline.
set -euo pipefail

ICON=$(dirname "$0")/icon.png
# DejaVu Sans by name on systems that have it installed; set FONT to a
# DejaVuSans.ttf path on systems that don't (e.g. Windows/macOS).
FONT="${FONT:-DejaVu-Sans}"
OUT_DIR=$(mktemp -d)
mkdir -p "$OUT_DIR"
rm -f "$OUT_DIR"/frame-*.png

FRAMES=110  # 55s total at 0.5s/frame

for i in $(seq 0 $((FRAMES - 1))); do
  label=$(awk -v i="$i" 'BEGIN {
    t = i * 0.5
    if (t < 14) print "Installing"; else if (t < 21) print "Creating shortcuts"; else print "Almost done"
  }')

  # Animated trailing dots (ellipsis), cycling every 2s
  ndots=$((i % 4))
  dots=""
  for _ in $(seq 1 $ndots); do dots=". $dots"; done

  magick -size 480x320 xc:'#252525' \
    \( "$ICON" -resize 84x84 \) -gravity center -geometry +0-72 -composite \
    -gravity center -font "$FONT" -pointsize 21 -fill '#e8e8e8' -annotate +0+8 'Installing Rowboat' \
    -gravity center -font "$FONT" -pointsize 14 -fill '#9a9a9a' -annotate +0+78 "$label" \
    -gravity center -font "$FONT" -pointsize 14 -fill '#6f6f6f' -annotate +0+100 "$dots" \
    "$OUT_DIR/frame-$(printf '%03d' "$i").png"
done

magick -delay 50 -loop 0 "$OUT_DIR"/frame-*.png -layers Optimize "$(dirname "$0")/install-loading.gif"
echo "frames: $FRAMES"
ls -la "$(dirname "$0")/install-loading.gif"
