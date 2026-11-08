#!/usr/bin/env bash
# A test copy of the AMC web portal to take the guide's screenshots on:
# shared mode (sign-in), https://localhost:8096, built from a local
# checkout of amc-webapp, with its own images, data and Docker volume.
#
#   stack/stack.sh up      build and start it, make the demo account and set
#                          the branding of amc.rjana.in
#   stack/stack.sh stop    stop it (its data and images are kept)
#   stack/stack.sh down    remove its containers (add -v to delete its exams too)
#   stack/stack.sh ...     any other docker compose command (ps, logs, exec...)
#
# Settings, from the environment:
#   AMC_WEBAPP_DIR  the amc-webapp checkout       (../amc-web-ui)
#   GUIDE_DATA      sign-in data and certificate  (~/.cache/amc-guide)
#   GUIDE_PORT      port on 127.0.0.1             (8096)
#   GUIDE_USER, GUIDE_PASS                        (the demo account in the guide)
#   GUIDE_SCHOOL, GUIDE_COLOR                     (the branding of amc.rjana.in)
#
# Never point capture/capture.mjs at a copy holding real exams: its first
# scene empties the account it signs in with.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
APP=$(cd "${AMC_WEBAPP_DIR:-$ROOT/../amc-web-ui}" 2>/dev/null && pwd) ||
  { echo "No amc-webapp checkout at ${AMC_WEBAPP_DIR:-$ROOT/../amc-web-ui}; set AMC_WEBAPP_DIR." >&2; exit 1; }
DATA=${GUIDE_DATA:-$HOME/.cache/amc-guide}   # not on the repository's drive: SQLite over a shared exFAT folder is unreliable
PORT=${GUIDE_PORT:-8096}
USER_NAME=${GUIDE_USER:-demo_instructor}
USER_PASS=${GUIDE_PASS:-Demo@1234!4567}
SCHOOL=${GUIDE_SCHOOL:-RJ School Of Technology}
COLOR=${GUIDE_COLOR:-#3b5bdb}

compose() {
  AMC_DATA_DIR="$DATA" AMC_PORT="$PORT" AMC_BIND=127.0.0.1 \
  AMC_SITES="https://localhost:$PORT" AMC_ORIGINS="https://localhost:$PORT" AMC_DEFAULT_SNI=localhost \
  AMC_ISOLATE=1 TZ="${TZ:-Asia/Kolkata}" \
  docker compose -p amcguide --project-directory "$APP" \
    -f "$APP/docker-compose.yml" -f "$APP/docker-compose.override.yml" -f "$APP/compose.login.yml" \
    -f "$HERE/compose.guide.yml" "$@"
}

# The screenshots of this edition show amc-webapp at the commit in amc-webapp.version.
check_version() {
  local want have
  want=$(tr -d ' \n' < "$ROOT/amc-webapp.version")
  have=$(git -C "$APP" rev-parse HEAD 2>/dev/null || echo unknown)
  if [ "${have#"$want"}" = "$have" ] && [ "${want#"$have"}" = "$want" ]; then
    echo "Note: $APP is at ${have:0:7}; this edition's screenshots show ${want:0:7}." >&2
    echo "      Fine for a new edition (then update amc-webapp.version); otherwise check out ${want:0:7}." >&2
  fi
}

up() {
  check_version
  # macOS writes ._* twins on exFAT drives; they break the image build.
  find "$APP" -path "$APP/.git" -prune -o -name '._*' -type f -exec rm -f {} + 2>/dev/null || true
  mkdir -p "$DATA/auth" "$DATA/caddy"
  compose up -d --build
  echo "Waiting for https://localhost:$PORT ..."
  local i
  for i in $(seq 1 90); do
    if [ "$(curl -sk -o /dev/null -w '%{http_code}' --resolve "localhost:$PORT:127.0.0.1" "https://localhost:$PORT/auth/login")" = 200 ]; then break; fi
    sleep 2
  done
  if ! compose exec -T amc-auth flask user list 2>/dev/null | awk '{print $1}' | grep -qx "$USER_NAME"; then
    printf '%s\n%s\n' "$USER_PASS" "$USER_PASS" | compose exec -T amc-auth flask user add "$USER_NAME" 2>/dev/null | grep -v '^Password\|^Repeat' || true
  fi
  # The branding of amc.rjana.in, written where the Appearance page keeps it.
  compose exec -T -e SCHOOL="$SCHOOL" -e COLOR="$COLOR" amc-web python3 -c '
import json, os, time
d = "/amc-web/files/MC-Projects/_branding"
os.makedirs(d, exist_ok=True)
with open(os.path.join(d, "branding.json"), "w", encoding="utf-8") as f:
    json.dump({"name": os.environ["SCHOOL"], "color": os.environ["COLOR"], "updated": int(time.time()), "by": "stack.sh"}, f, indent=1)
'
  echo "Ready: https://localhost:$PORT (sign in as $USER_NAME). Then: cd capture && node capture.mjs"
}

case "${1:-}" in
  up) up ;;
  "") sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) compose "$@" ;;
esac
