#!/usr/bin/env bash
# The public demo of the AMC web portal (amc-demo.rjana.in): the same app as
# production, beside it on the same server, with sample exams that go back to
# the same state every night. See README.md.
#
#   demo/demo.sh reset    wipe everything and restore the sample exams
#                         (the first start too); a nightly cron job runs this
#   demo/demo.sh check    is it up, does the demo account work, is its password locked?
#   demo/demo.sh stop     stop it (a reset brings it back)
#   demo/demo.sh ...      any other docker compose command (ps, logs, exec, config...)
#
# Settings are in demo/demo.env (DEMO_ENV for another file); see demo.env.example.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ENV_FILE=${DEMO_ENV:-$HERE/demo.env}
SEED=${DEMO_SEED:-$HERE/seed.tar.gz}
[ -f "$ENV_FILE" ] || { echo "No $ENV_FILE: copy demo.env.example to it." >&2; exit 1; }
set -a; . "$ENV_FILE"; set +a
APP=$(cd "$AMC_WEBAPP_DIR" && pwd)

# --env-file also keeps compose away from production's .env in that folder,
# which holds production's tunnel token.
compose() {
  local files=(-f "$APP/docker-compose.yml" -f "$APP/docker-compose.override.yml" -f "$APP/compose.login.yml"
               -f "$APP/compose.tunnel.yml" -f "$HERE/compose.demo.yml")
  [ -n "${AMC_DEMO_FILES:-}" ] && files+=(-f "$HERE/compose.disk.yml")
  local extra
  for extra in ${DEMO_EXTRA_COMPOSE:-}; do files+=(-f "$extra"); done
  DEMO_DIR=$HERE docker compose -p amcdemo --project-directory "$APP" --env-file "$ENV_FILE" "${files[@]}" "$@"
}

say() { echo "$(date '+%F %T') $*"; }

# A laptop test sets DEMO_NO_TUNNEL=1: there is no token to run a tunnel with.
services() { echo amc-web amc-auth caddy; [ -n "${DEMO_NO_TUNNEL:-}" ] || echo cloudflared; }

reset() {
  [ -f "$SEED" ] || { echo "No $SEED: make it with demo/make-seed.sh." >&2; exit 1; }
  [ -z "${AMC_DEMO_FILES:-}" ] || mountpoint -q "$AMC_DEMO_FILES" ||
    { echo "$AMC_DEMO_FILES is not mounted: refusing to fill the server's own disk." >&2; exit 1; }
  say "Stopping"
  compose stop amc-web amc-auth caddy >/dev/null 2>&1 || true

  say "Restoring the sample exams"
  local branding
  branding=$(printf '{"name": "%s", "color": "%s", "updated": %s, "by": "demo.sh"}' "$DEMO_SCHOOL" "$DEMO_COLOR" "$(date +%s)")
  compose run --rm --no-deps -T -e BRANDING="$branding" --entrypoint sh amc-home-init -c '
    set -e
    cd /amc-web/files
    find . -mindepth 1 -maxdepth 1 ! -name lost+found -exec rm -rf {} +
    tar xzf -
    mkdir -p MC-Projects/_branding
    printf "%s" "$BRANDING" > MC-Projects/_branding/branding.json
    chown -R '"${AMC_UID:-1000}:${AMC_GID:-0}"' .
  ' < "$SEED"

  # Sign-in data starts again too (the secret key stays, so it isn't made anew).
  mkdir -p "$AMC_DATA_DIR/auth" "$AMC_DATA_DIR/caddy"
  rm -f "$AMC_DATA_DIR"/auth/users.sqlite*

  # Recreating picks up the image production last built, and empties /tmp.
  say "Starting"
  # shellcheck disable=SC2046
  compose up -d --no-build --force-recreate --no-deps amc-web amc-auth caddy >/dev/null 2>&1
  # shellcheck disable=SC2046
  compose up -d --no-build --no-deps $(services) >/dev/null 2>&1
  local i
  for i in $(seq 1 60); do compose exec -T amc-auth flask user count >/dev/null 2>&1 && break; sleep 2; done
  printf '%s\n%s\n' "$DEMO_PASS" "$DEMO_PASS" | compose exec -T amc-auth flask user add "$DEMO_USER" 2>/dev/null | grep '^Account' || true
  check
}

# Signs in over the private address, as a visitor would.
check() {
  local base="https://localhost:$AMC_PORT" jar csrf code n want bad=0
  jar=$(mktemp)
  web() { curl -sk --max-time 30 --resolve "localhost:$AMC_PORT:127.0.0.1" -b "$jar" -c "$jar" "$@"; }
  result() { if [ "$2" = "$3" ]; then say "ok    $1 ($2)"; else say "WRONG $1: got $2, want $3"; bad=1; fi; }

  local i
  for i in $(seq 1 30); do [ "$(web -o /dev/null -w '%{http_code}' "$base/auth/login")" = 200 ] && break; sleep 2; done
  csrf=$(web "$base/auth/login" | sed -n 's/.*name="csrf" value="\([^"]*\)".*/\1/p')
  code=$(web -o /dev/null -w '%{http_code}' -H "Origin: $base" -H "Referer: $base/auth/login" \
    --data-urlencode "csrf=$csrf" --data-urlencode "next=/" --data-urlencode "username=$DEMO_USER" \
    --data-urlencode "password=$DEMO_PASS" "$base/auth/login")
  result "the demo account signs in" "$code" 302

  n=$(web "$base/ui/api/projects" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["projects"]))' 2>/dev/null || echo none)
  want=$(tar tzf "$SEED" | awk -F/ -v u="$DEMO_USER" '$2==u && NF>=4 && $3!~/^_/ {print $3}' | sort -u | wc -l | tr -d ' ')
  result "sample exams" "$n" "$want"

  # The public site's rule, from inside the demo's caddy.
  code=$(compose exec -T caddy sh -c "wget -S -O /dev/null --header 'Host: $AMC_PUBLIC_HOST' --post-data x http://127.0.0.1:8091/auth/account 2>&1 | grep -o 'HTTP/1.1 [0-9]*' | head -1 | cut -d' ' -f2" || echo none)
  result "changing the password is refused" "$code" 403

  rm -f "$jar"
  [ "$bad" = 0 ] || { say "Something is wrong."; return 1; }
  say "All good."
}

case "${1:-}" in
  reset) reset ;;
  check) check ;;
  stop) compose stop ;;
  "") sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//' ;;
  *) compose "$@" ;;
esac
