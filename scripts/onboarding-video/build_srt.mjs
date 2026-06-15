// Build a Hebrew SRT timed to the narration, in slide order.
// Each cue spans the narration audio; the slide lingers TAIL seconds after.

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadContent, wrap, HEAD, TAIL } from './_lib.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const AUDIO = resolve(__dirname, 'assets/audio')

const fmt = (t) => {
  const ms = Math.round(t * 1000)
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0')
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
  const mm = String(ms % 1000).padStart(3, '0')
  return `${h}:${m}:${s},${mm}`
}

const { slides } = loadContent()
const dur = JSON.parse(readFileSync(resolve(AUDIO, 'timings.json'), 'utf8'))

let cursor = 0
const cues = []
slides.forEach((s, i) => {
  const d = dur[s.id] ?? 3
  const start = cursor + HEAD
  const end = start + d // subtitle visible during narration only
  cues.push(
    `${i + 1}\n${fmt(start)} --> ${fmt(end)}\n${wrap(s.narration).join('\n')}\n`
  )
  cursor += HEAD + d + TAIL
})

writeFileSync(resolve(AUDIO, 'subs.srt'), cues.join('\n'), 'utf8')
console.log(`subs.srt written (${slides.length} cues, total ${cursor.toFixed(1)}s)`)
