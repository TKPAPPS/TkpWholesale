#!/usr/bin/env bash
# Assemble per-slide image+audio segments into a single 1080p MP4. Hebrew
# subtitles are baked in as transparent PNG overlays (Chrome-rendered, perfect
# RTL) shown for the narration duration of each slide. No libass required.
# Output -> ~/Desktop/tkp-wholesale-onboarding-he.mp4
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SLIDES="$DIR/assets/slides"
SUBS="$DIR/assets/subs"
AUDIO="$DIR/assets/audio"
SEG="$DIR/assets/segments"
OUT_DESKTOP="${OUT:-$HOME/Desktop/tkp-wholesale-onboarding-he.mp4}"

rm -rf "$SEG"; mkdir -p "$SEG"
: > "$SEG/list.txt"

# One MP4 per slide: static slide image + subtitle overlay (visible during the
# narration only) + narration audio padded with silence to the trailing pause.
while IFS=$'\t' read -r id narr segdur; do
  [ -z "$id" ] && continue
  png="$SLIDES/$id.png"
  sub="$SUBS/$id.png"
  wav="$AUDIO/$id.wav"
  seg="$SEG/$id.mp4"
  echo "  segment: $id (narr ${narr}s / seg ${segdur}s)"
  ffmpeg -y -nostdin -loglevel error \
    -loop 1 -i "$png" \
    -loop 1 -i "$sub" \
    -i "$wav" \
    -filter_complex "[0:v]scale=1920:1080:flags=lanczos,setsar=1[bg];[1:v]scale=1920:1080[ov];[bg][ov]overlay=0:0:enable='between(t,0,${narr})',format=yuv420p[v]" \
    -map "[v]" -map 2:a \
    -t "$segdur" -r 30 \
    -af "apad" \
    -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p \
    -c:a aac -b:a 192k -ar 44100 \
    "$seg"
  echo "file '$seg'" >> "$SEG/list.txt"
done < <(node "$DIR/_lib.mjs" segments "$AUDIO")

# Concatenate (identical codecs => stream copy).
echo "  concatenating..."
ffmpeg -y -nostdin -loglevel error -f concat -safe 0 -i "$SEG/list.txt" -c copy "$OUT_DESKTOP"

echo "Video written to $OUT_DESKTOP"
