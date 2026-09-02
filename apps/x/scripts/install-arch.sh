#!/usr/bin/env bash
# Build the Rowboat desktop app as an Arch package and install it with pacman.
#
# Usage: apps/x/scripts/install-arch.sh
#
# Steps:
#   1. Refuse to run while anything is executing from apps/main/.package —
#      forge's generateAssets hook deletes that directory, and on an ntfs-3g
#      checkout unlinking files a live process holds open wedges the build.
#   2. pnpm install, then electron-forge make scoped to the pacman maker only
#      (the rpm maker always fails on Arch: no /var/lib/rpm database).
#   3. sudo pacman -U the freshly built .pkg.tar.zst.
#
# The build takes several minutes; sudo prompts for your password at the end.

set -euo pipefail

X_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN_DIR="$X_DIR/apps/main"

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v makepkg >/dev/null || die "makepkg not found — this script is for Arch Linux"
command -v pnpm >/dev/null || die "pnpm not found"

# --- 1. nothing may be running from .package/ ------------------------------
if pgrep -f "$MAIN_DIR/.package" >/dev/null 2>&1; then
    echo "Processes are running from $MAIN_DIR/.package (probably the dev app):"
    pgrep -af "$MAIN_DIR/.package" | head -5
    read -r -p "Kill them and continue? [y/N] " reply || reply=n
    [[ "$reply" == [yY]* ]] || die "quit the dev app first, then re-run"
    pkill -f "$MAIN_DIR/.package" || true
    sleep 2
fi

# --- 2. build ---------------------------------------------------------------
say "pnpm install"
(cd "$X_DIR" && pnpm install)

# --targets matches the maker's config name; for the local pacman maker that
# is its require.resolve()d absolute path.
PACMAN_MAKER="$(cd "$MAIN_DIR" && node -p "require.resolve('./makers/maker-pacman.cjs')")"

say "electron-forge make (pacman only — this is the slow part)"
STAMP="$(mktemp)"
# stdin redirected: forge exits early (status 0!) if its stdin closes mid-build.
(cd "$MAIN_DIR" && npm run make -- --targets="$PACMAN_MAKER" < /dev/null)

# Only accept a package newer than the build start — never install a stale one.
PKG="$(find "$MAIN_DIR"/out/make/pacman -name '*.pkg.tar.zst' -newer "$STAMP" 2>/dev/null | head -1)"
rm -f "$STAMP"
[[ -n "$PKG" ]] || die "build finished but produced no fresh .pkg.tar.zst under $MAIN_DIR/out/make/pacman"

# --- 3. install -------------------------------------------------------------
say "installing $(basename "$PKG")"
sudo pacman -U --noconfirm "$PKG"

say "done — restart the app to pick up the new version"
echo "    (Spaces needs ROWBOAT_SPACES=1 in the environment, e.g. ~/.config/environment.d/rowboat.conf)"
