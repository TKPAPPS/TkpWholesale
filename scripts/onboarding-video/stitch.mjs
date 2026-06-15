// Crossfade-stitch the per-slide segments into one MP4 (video xfade + audio
// acrossfade), then write to the Desktop.

import { spawnSync } from 'node:child_process'
import { readFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { loadContent, XFADE } from './_lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SEG = resolve(__dirname, 'assets/segments')
const AUDIO = resolve(__dirname, 'assets/audio')

// Always a NEW, timestamped file in ~/media (never overwrite) unless OUT is set.
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const MEDIA = resolve(homedir(), 'media')
mkdirSync(MEDIA, { recursive: true })
const OUT = process.env.OUT || resolve(MEDIA, `tkp-wholesale-onboarding-he-${stamp}.mp4`)

const { slides } = loadContent()
const dur = JSON.parse(readFileSync(resolve(AUDIO, 'timings.json'), 'utf8'))

// segment display duration must match assemble.sh: HEAD + narration + TAIL
import { HEAD, TAIL } from './_lib.mjs'
const segs = slides.map((s) => ({
  file: resolve(SEG, `${s.id}.mp4`),
  d: HEAD + (dur[s.id] ?? 3) + TAIL,
}))

const inputs = segs.flatMap((s) => ['-i', s.file])

// Build xfade (video) + acrossfade (audio) chains.
const XF = XFADE
let vfilters = []
let afilters = []
let vlab = '0:v'
let alab = '0:a'
let cum = segs[0].d
for (let i = 1; i < segs.length; i++) {
  const offset = (cum - XF).toFixed(3)
  const vout = `v${i}`
  const aout = `a${i}`
  vfilters.push(`[${vlab}][${i}:v]xfade=transition=fade:duration=${XF}:offset=${offset}[${vout}]`)
  afilters.push(`[${alab}][${i}:a]acrossfade=d=${XF}[${aout}]`)
  vlab = vout
  alab = aout
  cum += segs[i].d - XF
}

const filter = [...vfilters, ...afilters].join(';')

const args = [
  '-y', '-nostdin', '-loglevel', 'error',
  ...inputs,
  '-filter_complex', filter,
  '-map', `[${vlab}]`, '-map', `[${alab}]`,
  '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p',
  '-r', '30',
  '-c:a', 'aac', '-b:a', '192k', '-ar', '44100',
  OUT,
]

const r = spawnSync('ffmpeg', args, { stdio: 'inherit' })
if (r.status !== 0) process.exit(r.status || 1)
console.log('Video written to', OUT, `(${cum.toFixed(1)}s)`)
