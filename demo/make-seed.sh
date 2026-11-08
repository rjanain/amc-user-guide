#!/usr/bin/env bash
# Makes demo/seed.tar.gz, what the demo portal goes back to every night:
#
#   Maths Unit Test 1         finished: every step done, the marks exported
#   Maths Class Test 3        printed and scanned, waiting at Check scans
#   Maths Unit Test 2         questions from the bank, before the exam
#   Olympiad Practice Paper   the RJ Style Paper Builder, before the exam
#   the Class 8 Mathematics question bank, and a deleted exam in the trash
#
# It takes them from the guide's test copy (stack/stack.sh), by running the
# capture, so the demo and the guide's pictures show the same exams. It needs
# what the capture needs (capture/README.md) and takes about eight minutes.
# Only made-up students in it. It empties the demo account of the test copy.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(dirname "$HERE")
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# The capture rewrites ../screenshots: run a copy, so the guide's pictures stay as they are.
mkdir "$TMP/capture"
cp "$ROOT"/capture/* "$TMP/capture/"

"$ROOT/stack/stack.sh" up
( cd "$TMP/capture"
  node capture.mjs
  GUIDE_EXAM='Maths Class Test 3' GUIDE_SCAN_SEED=23 node capture.mjs wizard fill marking papers print scans upload classList )

docker run --rm -v amcguide_amc-home:/v:ro alpine:3 \
  tar czf - -C /v MC-Projects/demo_instructor MC-Projects/_amcweb/demo_instructor > "$HERE/seed.tar.gz.new"
mv "$HERE/seed.tar.gz.new" "$HERE/seed.tar.gz"
"$ROOT/stack/stack.sh" stop
ls -la "$HERE/seed.tar.gz"
