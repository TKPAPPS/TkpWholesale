#!/usr/bin/env bash
# Build one MP4 per slide (static slide image + transparent Hebrew subtitle
# overlay shown during narration + narration audio with a short lead-in), then
# crossfade-stitch them into a single 1080p MP4 via stitch.mjs.
# Output -> ~/Desktop/tkp-wholesale-onboarding-he.mp4
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLIDES="$DIR/assets/slides"
SUBS="$DIR/assets/subs"
AUDIO="$DIR/assets/audio"
SEG="$DIR/assets/segments"

rm -rf "$SEG"; mkdir -p "$SEG"

while IFS=$'\t' read -r id head narr segdur; do
  [ -z "$id" ] && continue
  png="$SLIDES/$id.png"
  sub="$SUBS/$id.png"
  wav="$AUDIO/$id.wav"
  seg="$SEG/$id.mp4"
  headms=$(node -e "process.stdout.write(String(Math.round(${head}*1000)))")
  subEnd=$(node -e "process.stdout.write((${head}+${narr}).toFixed(3))")
  echo "  segment: $id (lead ${head}s / narr ${narr}s / seg ${segdur}s)"
  ffmpeg -y -nostdin -loglevel error \
    -loop 1 -i "$png" \
    -loop 1 -i "$sub" \
    -i "$wav" \
    -filter_complex "[0:v]scale=1920:1080:flags=lanczos,setsar=1[bg];[1:v]scale=1920:1080[ov];[bg][ov]overlay=0:0:enable='between(t,${head},${subEnd})',format=yuv420p[v];[2:a]adelay=${headms}:all=1,apad,aformat=sample_rates=44100:channel_layouts=stereo[a]" \
    -map "[v]" -map "[a]" \
    -t "$segdur" -r 30 \
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
    -c:a aac -b:a 192k -ar 44100 \
    "$seg"
done < <(node "$DIR/_lib.mjs" segments "$AUDIO")

echo "  crossfade-stitching..."
node "$DIR/stitch.mjs"
