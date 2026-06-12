#!/usr/bin/env bash
# One-shot code-mode diagnostics (macOS / Linux).
#
# When code mode misbehaves on your machine (stuck runs, "CLI not found",
# startup timeouts), run this and send the FULL output back — it collects
# everything needed to diagnose in one round trip:
#
#   bash apps/x/scripts/diagnose-code-mode.sh
#
# Read-only except for one tiny `claude -p` probe (a single short API call).

section() { printf '\n=== %s ===\n' "$1"; }

# Portable timeout: mac has no `timeout` binary by default.
run_with_timeout() {
    local secs="$1"; shift
    "$@" & local pid=$!
    ( sleep "$secs" && kill "$pid" 2>/dev/null ) & local killer=$!
    wait "$pid" 2>/dev/null; local rc=$?
    kill "$killer" 2>/dev/null
    return $rc
}

describe_binary() { # $1 = name
    local p
    p="$(/bin/sh -lc "command -v $1" 2>/dev/null)"
    if [ -z "$p" ]; then
        echo "$1: NOT on login-shell PATH"
        return
    fi
    echo "$1: $p"
    [ -L "$p" ] && echo "  symlink -> $(readlink "$p")"
    # Node-shebang script vs native binary — the distinction that matters for
    # GUI launches (shebang scripts need `node` on the SPAWNING process's PATH).
    local head1
    head1="$(head -c 64 "$p" 2>/dev/null | head -n 1 | tr -d '\0')"
    case "$head1" in
        '#!'*) echo "  type: script ($head1)" ;;
        *)     echo "  type: native binary" ;;
    esac
    echo "  version: $(run_with_timeout 15 "$1" --version 2>&1 | head -n 1)"
}

section "system"
echo "os:    $(uname -sr) ($(uname -m))"
echo "shell: ${SHELL:-unset}"
echo "date:  $(date)"

section "engines"
describe_binary claude
describe_binary codex
describe_binary node

section "PATH: login shell vs GUI"
echo "login-shell PATH:"
/bin/sh -lc 'echo "  $PATH"'
if [ "$(uname -s)" = "Darwin" ]; then
    echo "launchd (GUI) PATH:"
    echo "  $(launchctl getenv PATH 2>/dev/null || echo '(unset — GUI apps get the system default)')"
fi

section "auth presence (no secrets printed)"
if [ "$(uname -s)" = "Darwin" ]; then
    if security find-generic-password -s "Claude Code-credentials" >/dev/null 2>&1; then
        echo "claude: keychain credential present"
    else
        echo "claude: NO keychain credential (signed in?)"
    fi
fi
[ -f "$HOME/.claude/.credentials.json" ] && echo "claude: ~/.claude/.credentials.json present"
[ -f "$HOME/.codex/auth.json" ] && echo "codex: ~/.codex/auth.json present" || echo "codex: NO ~/.codex/auth.json"

section "claude stream-json probe (what the app does under the hood)"
# A healthy claude prints a `system`/`init` JSON line within seconds. A hang or
# error here reproduces the in-app failure WITHOUT the app.
run_with_timeout 45 claude -p "reply with exactly: ok" --output-format stream-json --verbose 2>&1 | head -n 3
echo "(probe exit: $? — 143 means it hung and was killed after 45s)"

section "newest SDK debug log (~/.claude/debug)"
latest="$(ls -t "$HOME/.claude/debug"/sdk-*.txt 2>/dev/null | head -n 1)"
if [ -n "$latest" ]; then
    echo "$latest:"
    tail -n 40 "$latest"
else
    echo "(none found)"
fi

printf '\ndone — send everything above.\n'
