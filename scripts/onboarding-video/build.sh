#!/usr/bin/env bash
# One-command, reproducible build of the Hebrew onboarding video.
#
#   LOGIN=customer@example.com PASSWORD=secret bash build.sh
#
# Steps: deps -> (start dev server if needed) -> capture -> tts -> srt -> slides -> assemble -> open
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$DIR/../.." && pwd)"
BASE_URL="${BASE_URL:-http://localhost:3000}"

: "${LOGIN:?Set LOGIN to the customer email}"
: "${PASSWORD:?Set PASSWORD to the customer password}"
export LOGIN PASSWORD BASE_URL

# Always write a NEW, timestamped file to ~/media (never overwrite).
MEDIA="$HOME/media"
mkdir -p "$MEDIA"
export OUT="${OUT:-$MEDIA/tkp-wholesale-onboarding-he-$(date +%Y%m%d-%H%M%S).mp4}"

echo "==> 1/6 deps"
[ -d "$DIR/node_modules/puppeteer-core" ] || (cd "$DIR" && npm install --no-audit --no-fund)

STARTED_DEV=""
cleanup() { [ -n "$STARTED_DEV" ] && kill "$STARTED_DEV" 2>/dev/null || true; }
trap cleanup EXIT

if ! curl -sf -o /dev/null "$BASE_URL"; then
  echo "==> starting dev server (npm run dev)"
  (cd "$APP_DIR" && npm run dev >/tmp/tkp-onboarding-dev.log 2>&1) &
  STARTED_DEV=$!
  echo "    waiting for $BASE_URL ..."
  for i in $(seq 1 60); do
    curl -sf -o /dev/null "$BASE_URL" && break
    sleep 1
  done
  curl -sf -o /dev/null "$BASE_URL" || { echo "dev server did not come up; see /tmp/tkp-onboarding-dev.log"; exit 1; }
fi

echo "==> 2/6 capture live screenshots"
node "$DIR/capture.mjs"

echo "==> 3/6 narration (Carmit Enhanced) + timings"
bash "$DIR/tts.sh"

echo "==> 4/6 subtitles"
node "$DIR/build_srt.mjs"

echo "==> 5/6 render slides"
node "$DIR/render_slides.mjs"

echo "==> 6/6 assemble video"
bash "$DIR/assemble.sh"

[ -f "$OUT" ] && open "$OUT"
echo "Done. -> $OUT"
