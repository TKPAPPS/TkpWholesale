#!/usr/bin/env bash
# Generate Hebrew narration and record per-slide durations into
# assets/audio/timings.json.
#
# Engine: ElevenLabs (natural) when ELEVEN_API_KEY is set, otherwise macOS
# Carmit (Enhanced) as a no-key fallback.
#   ELEVEN_API_KEY    ElevenLabs API key
#   ELEVEN_VOICE_ID   voice id (default: a multilingual female voice)
#   ELEVEN_MODEL      model id (default: eleven_multilingual_v2)
#   VOICE             Carmit voice name (fallback; default "Carmit (Enhanced)")
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUDIO="$DIR/assets/audio"
mkdir -p "$AUDIO"

# NOTE: only eleven_v3 supports Hebrew (he). The multilingual/turbo/flash models
# do NOT, and will mispronounce Hebrew into an unrecognizable language.
VOICE="${VOICE:-Carmit (Enhanced)}"
# Default male narrator "Eric - Smooth, Trustworthy". Swap via ELEVEN_VOICE_ID.
ELEVEN_VOICE_ID="${ELEVEN_VOICE_ID:-cjVigY5qzO86Huf0OWal}"
ELEVEN_MODEL="${ELEVEN_MODEL:-eleven_v3}"

if [ -n "${ELEVEN_API_KEY:-}" ]; then
  echo "  engine: ElevenLabs ($ELEVEN_MODEL, voice $ELEVEN_VOICE_ID)"
else
  echo "  engine: macOS Carmit ($VOICE) [set ELEVEN_API_KEY for natural TTS]"
fi

# Write per-slide narration text files and get the ordered id list.
IDS=$(node "$DIR/_lib.mjs" narration "$AUDIO")

: > "$AUDIO/durations.tsv"
for id in $IDS; do
  txt="$AUDIO/$id.txt"
  wav="$AUDIO/$id.wav"

  if [ -n "${ELEVEN_API_KEY:-}" ]; then
    # Build a safe JSON body from the Hebrew text and request MP3 from ElevenLabs.
    body=$(ELEVEN_MODEL="$ELEVEN_MODEL" node -e '
      const fs = require("fs");
      const text = fs.readFileSync(process.argv[1], "utf8").trim();
      process.stdout.write(JSON.stringify({
        text,
        model_id: process.env.ELEVEN_MODEL,
        language_code: "he"
      }));
    ' "$txt")
    mp3="$AUDIO/$id.mp3"
    code=$(curl -s -w '%{http_code}' -o "$mp3" -X POST \
      "https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}?output_format=mp3_44100_128" \
      -H "xi-api-key: ${ELEVEN_API_KEY}" \
      -H "Content-Type: application/json" \
      --data "$body")
    if [ "$code" != "200" ]; then
      echo "  ElevenLabs error for $id (HTTP $code): $(head -c 300 "$mp3")" >&2
      exit 1
    fi
    echo "  TTS (ElevenLabs): $id"
    ffmpeg -nostdin -y -loglevel error -i "$mp3" -ar 44100 -ac 1 "$wav"
  else
    echo "  TTS ($VOICE): $id"
    aiff="$AUDIO/$id.aiff"
    say -v "$VOICE" -r 165 -f "$txt" -o "$aiff"
    afconvert -f WAVE -d LEI16@44100 "$aiff" "$wav"
  fi

  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$wav")
  printf '%s\t%s\n' "$id" "$dur" >> "$AUDIO/durations.tsv"
done

node "$DIR/_lib.mjs" timings "$AUDIO"
echo "Audio + timings.json written to $AUDIO"
