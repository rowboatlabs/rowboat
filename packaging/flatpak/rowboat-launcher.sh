#!/bin/bash
# Rowboat Flatpak Launcher
# Handles Wayland auto-detection and disables redundant Chromium sandbox (already sandboxed by Flatpak/Bubblewrap)

FLAGS=(
  "--no-sandbox"
  "--ozone-platform-hint=auto"
)

BIN="/app/lib/rowboat/Rowboat"
if [ ! -f "$BIN" ]; then
  BIN="/app/lib/rowboat/rowboat"
fi

exec "$BIN" "${FLAGS[@]}" "$@"
