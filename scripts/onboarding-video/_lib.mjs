// Shared helpers + small CLI used by tts.sh.
//   node _lib.mjs narration <audioDir>   -> writes <audioDir>/<id>.txt, prints ids
//   node _lib.mjs timings   <audioDir>   -> reads durations.tsv, writes timings.json

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const HEAD = 0.45 // quiet beat before narration starts (less rushed)
export const TAIL = 1.2 // seconds the slide lingers after narration ends
export const XFADE = 0.5 // crossfade duration between slides

export function loadContent() {
  const raw = readFileSync(resolve(__dirname, 'content.he.json'), 'utf8')
  return JSON.parse(raw)
}

// Wrap Hebrew text into <= maxChars lines (libass handles RTL/bidi).
export function wrap(text, maxChars = 42) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines = []
  let line = ''
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) {
      lines.push(line.trim())
      line = w
    } else {
      line = (line + ' ' + w).trim()
    }
  }
  if (line) lines.push(line.trim())
  return lines
}

function cli() {
  const [cmd, audioDir] = process.argv.slice(2)
  const { slides } = loadContent()

  if (cmd === 'narration') {
    const ids = []
    for (const s of slides) {
      writeFileSync(resolve(audioDir, `${s.id}.txt`), s.narration, 'utf8')
      ids.push(s.id)
    }
    process.stdout.write(ids.join(' '))
    return
  }

  if (cmd === 'timings') {
    const tsv = readFileSync(resolve(audioDir, 'durations.tsv'), 'utf8')
    const dur = {}
    for (const line of tsv.split('\n')) {
      if (!line.trim()) continue
      const [id, d] = line.split('\t')
      dur[id] = parseFloat(d)
    }
    writeFileSync(
      resolve(audioDir, 'timings.json'),
      JSON.stringify(dur, null, 2),
      'utf8'
    )
    return
  }

  if (cmd === 'segments') {
    // print "id<TAB>head<TAB>narrationDuration<TAB>segmentDuration" in slide order
    const dur = JSON.parse(
      readFileSync(resolve(audioDir, 'timings.json'), 'utf8')
    )
    const out = slides
      .map((s) => {
        const n = dur[s.id] ?? 3
        return `${s.id}\t${HEAD.toFixed(3)}\t${n.toFixed(3)}\t${(HEAD + n + TAIL).toFixed(3)}`
      })
      .join('\n')
    process.stdout.write(out + '\n') // trailing newline so `while read` gets the last line
    return
  }

  console.error('usage: node _lib.mjs narration|timings|segments <audioDir>')
  process.exit(1)
}

if (process.argv[1] && process.argv[1].endsWith('_lib.mjs')) cli()
