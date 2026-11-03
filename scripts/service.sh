#!/bin/bash
# Run Retro in the background on macOS (launchd): starts at login, restarts if it
# stops, no Terminal window needed.
#
#   scripts/service.sh install "<data folder>"   install and start (once)
#   scripts/service.sh update                     git pull + restart  (what `retro` runs)
#   scripts/service.sh status                     is it running? which address?
#   scripts/service.sh logs                       follow the log (Ctrl+C to stop watching)
#   scripts/service.sh restart | stop | start
#   scripts/service.sh uninstall                  stop and remove the service
#
# Written for the bash 3.2 that ships with macOS.

set -euo pipefail

LABEL="com.retro.server"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-4173}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/Retro"
LOG="$LOG_DIR/server.log"
DOMAIN="gui/$(id -u)"
ZSHRC="$HOME/.zshrc"
BLOCK_START="# >>> retro service >>>"
BLOCK_END="# <<< retro service <<<"

say() { printf '%s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

xml_escape() { # & < > " for the plist
  printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'
}

is_loaded() { launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; }

wait_healthy() { # up to ~15s for the server to answer
  local i
  for i in $(seq 1 30); do
    if curl -fsS "http://localhost:$PORT/api/config" >/dev/null 2>&1; then return 0; fi
    sleep 0.5
  done
  return 1
}

tailscale_cli() {
  command -v tailscale 2>/dev/null && return 0
  local app="/Applications/Tailscale.app/Contents/MacOS/Tailscale"
  [ -x "$app" ] && printf '%s\n' "$app"
  return 0
}

lan_addresses() {
  local ifc ip ts url
  for ifc in en0 en1 en2; do
    ip="$(ipconfig getifaddr "$ifc" 2>/dev/null || true)"
    [ -n "$ip" ] && say "  Phone (same Wi-Fi): http://$ip:$PORT"
  done
  # Tailscale HTTPS address (fixed, works anywhere, enables offline use) if set up
  ts="$(tailscale_cli)"
  if [ -n "$ts" ]; then
    url="$("$ts" serve status 2>/dev/null | grep -o 'https://[^ ]*' | head -n 1 || true)"
    [ -n "$url" ] && say "  Phone (anywhere, offline-ready): $url"
  fi
  return 0
}

data_dir_from_plist() {
  [ -f "$PLIST" ] || return 0
  /usr/bin/plutil -extract EnvironmentVariables.DATA_DIR raw -o - "$PLIST" 2>/dev/null || true
}

write_plist() { # $1 = data dir, $2 = node binary
  mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$2")</string>
    <string>$(xml_escape "$REPO/server/index.js")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$REPO")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>DATA_DIR</key>
    <string>$(xml_escape "$1")</string>
    <key>PORT</key>
    <string>$PORT</string>
    <key>PATH</key>
    <string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$LOG")</string>
</dict>
</plist>
EOF
}

remove_zshrc_block() {
  [ -f "$ZSHRC" ] || return 0
  local tmp
  tmp="$(mktemp)"
  awk -v s="$BLOCK_START" -v e="$BLOCK_END" '$0==s{skip=1} !skip{print} $0==e{skip=0}' "$ZSHRC" > "$tmp"
  cat "$tmp" > "$ZSHRC"
  rm -f "$tmp"
}

add_zshrc_block() {
  remove_zshrc_block
  {
    say ""
    say "$BLOCK_START"
    say "# Added by scripts/service.sh: Retro runs in the background, so \`retro\` now"
    say "# means: pull the latest code and restart it. Remove with: service.sh uninstall"
    say "alias retro='bash \"$REPO/scripts/service.sh\" update'"
    say "$BLOCK_END"
  } >> "$ZSHRC"
}

start_service() {
  if is_loaded; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; fi
  launchctl bootstrap "$DOMAIN" "$PLIST"
}

cmd_install() {
  local data="${1:-${DATA_DIR:-}}"
  [ -n "$data" ] || data="$(data_dir_from_plist)"
  [ -n "$data" ] || die "tell me where your data lives, e.g.  scripts/service.sh install \"\$HOME/…/data\""
  mkdir -p "$data" 2>/dev/null || true
  [ -d "$data" ] || die "data folder not found: $data"
  data="$(cd "$data" && pwd)"

  local node
  node="$(command -v node || true)"
  [ -n "$node" ] || die "node not found; install Node.js from nodejs.org first"
  case "$node" in
    *"/.nvm/"*|*"/.fnm/"*|*"/.volta/"*)
      say "Note: node comes from a version manager ($node)."
      say "      If you switch Node versions later, run install again." ;;
  esac

  # A copy started by hand (the old `retro`) would hold the port.
  if curl -fsS "http://localhost:$PORT/api/config" >/dev/null 2>&1 && ! is_loaded; then
    die "Retro is already running in a Terminal window. Close it (Ctrl+C) first, then run install again."
  fi

  write_plist "$data" "$node"
  start_service
  add_zshrc_block

  if wait_healthy; then
    say "Retro is running in the background and will start by itself after login."
    say "  This computer: http://localhost:$PORT"
    lan_addresses
    say "  Data: $data"
    say ""
    say "Open a new Terminal window (or run: source ~/.zshrc) and \`retro\` will"
    say "pull updates and restart the service. You can close Terminal now."
  else
    say "The service was installed but isn't answering yet. Last lines of the log:"
    tail -n 20 "$LOG" 2>/dev/null || true
    exit 1
  fi
}

cmd_update() {
  [ -f "$PLIST" ] || die "the service isn't installed. Run: scripts/service.sh install \"<data folder>\""
  say "Pulling the latest version…"
  git -C "$REPO" pull --ff-only
  say "Restarting…"
  if is_loaded; then launchctl kickstart -k "$DOMAIN/$LABEL"; else start_service; fi
  if wait_healthy; then
    say "Retro is running ($(git -C "$REPO" log -1 --format='%h %s'))."
    say "  This computer: http://localhost:$PORT"
    lan_addresses
  else
    say "Retro didn't come back up. Last lines of the log:"
    tail -n 20 "$LOG" 2>/dev/null || true
    exit 1
  fi
}

cmd_status() {
  if ! [ -f "$PLIST" ]; then say "Not installed."; return 0; fi
  if is_loaded; then say "Service: loaded"; else say "Service: installed but not loaded (run: scripts/service.sh start)"; fi
  if curl -fsS "http://localhost:$PORT/api/config" >/dev/null 2>&1; then
    say "Server: answering on http://localhost:$PORT"
    lan_addresses
    if ! curl -fsS "http://localhost:$PORT/api/weeks" >/dev/null 2>&1; then
      say "But it can't read the data folder. See the log: scripts/service.sh logs"
    fi
  else
    say "Server: not answering. Last lines of the log:"
    tail -n 20 "$LOG" 2>/dev/null || true
  fi
  say "Data: $(data_dir_from_plist)"
  say "Log:  $LOG"
}

cmd_uninstall() {
  if is_loaded; then launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true; fi
  rm -f "$PLIST"
  remove_zshrc_block
  say "Removed the background service. Your data is untouched."
  say "Open a new Terminal window; \`retro\` is back to running Retro in that window."
}

case "${1:-}" in
  install) shift; cmd_install "$@" ;;
  update) cmd_update ;;
  status) cmd_status ;;
  logs) mkdir -p "$LOG_DIR"; touch "$LOG"; tail -n 50 -f "$LOG" ;;
  restart) is_loaded && launchctl kickstart -k "$DOMAIN/$LABEL" || start_service; wait_healthy && say "Restarted." ;;
  start) start_service; wait_healthy && say "Started." ;;
  stop) launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null && say "Stopped (starts again at next login; uninstall to remove)." || say "Not running." ;;
  uninstall) cmd_uninstall ;;
  *) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
