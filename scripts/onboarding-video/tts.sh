#!/usr/bin/env bash
# Generate Hebrew narration with macOS Carmit (Enhanced), convert to WAV,
# and record per-slide durations into assets/audio/timings.json.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VOICE="${VOICE:-Carmit (Enhanced)}"
AUDIO="$DIR/assets/audio"
mkdir -p "$AUDIO"

# Write per-slide narration text files and get the ordered id list.
IDS=$(node "$DIR/_lib.mjs" narration "$AUDIO")

: > "$AUDIO/durations.tsv"
for id in $IDS; do
  txt="$AUDIO/$id.txt"
  aiff="$AUDIO/$id.aiff"
  wav="$AUDIO/$id.wav"
  echo "  TTS ($VOICE): $id"
  say -v "$VOICE" -f "$txt" -o "$aiff"
  afconvert -f WAVE -d LEI16@44100 "$aiff" "$wav"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$wav")
  printf '%s\t%s\n' "$id" "$dur" >> "$AUDIO/durations.tsv"
done

node "$DIR/_lib.mjs" timings "$AUDIO"
echo "Audio + timings.json written to $AUDIO"
