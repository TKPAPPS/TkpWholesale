# TKP Wholesale — Hebrew onboarding video (code-rendered)

Builds a ~2–3 min onboarding video for the B2B portal: hand-built HTML/CSS slides
rendered with headless Chrome at 1920×1080 @2×, composited with **live, un-cropped**
screenshots of the real app, **narrated in Hebrew (Carmit Enhanced)** with
**burned-in Hebrew subtitles**.

## Requirements (macOS)
- Google Chrome (`/Applications/Google Chrome.app`) — used headless via `puppeteer-core`.
- `ffmpeg` + `ffprobe` (Homebrew).
- macOS `say` with the **Carmit (Enhanced)** voice installed
  (System Settings → Accessibility → Spoken Content → System Voice → manage voices).
- Node 18+.

## Run it
From this folder:

```bash
LOGIN=customer@example.com PASSWORD=secret bash build.sh
```

`build.sh` installs `puppeteer-core`, starts the app's dev server if it isn't already
running, captures the screens, generates narration + subtitles, renders the slides,
assembles the MP4, and opens it. The final file lands at
`~/Desktop/tkp-wholesale-onboarding-he.mp4`.

## What each piece does
| File | Role |
|------|------|
| `content.he.json` | Storyboard: slide order, Hebrew headings + narration (single source of truth) |
| `capture.mjs` | Logs in (lang=he) and screenshots each route, whole/un-cropped |
| `tts.sh` + `_lib.mjs` | Carmit narration → WAV + `timings.json` |
| `build_srt.mjs` | Hebrew `subs.srt` sidecar (reference), timed to the narration |
| `slides/slide.css` + `render_slides.mjs` | On-brand RTL slides + transparent Hebrew subtitle overlays → PNGs |
| `assemble.sh` | ffmpeg: per-slide segments (image + subtitle overlay + audio) → concat → MP4 |

> Subtitles are baked in as Chrome-rendered transparent PNG overlays (perfect Hebrew
> RTL shaping, on-brand box), composited with ffmpeg's `overlay` filter. This avoids
> any dependency on a libass-enabled ffmpeg build.
| `build.sh` | Orchestrates all of the above |

Intermediate artifacts live under `assets/` (gitignored). To re-render after editing
narration or slides, re-run `build.sh` (or a single step, e.g. `node render_slides.mjs`).

## Tuning
- Subtitle look: `SUBFONT`, `SUBSIZE` env vars for `assemble.sh`.
- Voice: `VOICE` env var for `tts.sh` (default `Carmit (Enhanced)`).
- Output path: `OUT` env var.
