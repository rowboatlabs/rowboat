/**
 * Regenerates the bundled product-tour narration clips.
 *
 * Parses the TOUR_STEPS texts straight out of product-tour.tsx (so the code
 * stays the single source of truth), synthesizes each one via @x/core's
 * synthesizeSpeech (Rowboat proxy when signed in, direct ElevenLabs otherwise,
 * using the voice id configured there / in ~/.rowboat/config/elevenlabs.json),
 * and writes MP3s to src/assets/tour/<step-id>.mp3.
 *
 * Run whenever a step's narration text or the tour voice changes:
 *   cd apps/x && npm run deps   # script imports core's built output
 *   node apps/renderer/scripts/generate-tour-audio.mjs
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const tourSource = path.join(here, '../src/components/product-tour.tsx')
const outDir = path.join(here, '../src/assets/tour')
const corePath = path.join(here, '../../../packages/core/dist/voice/voice.js')

const { synthesizeSpeech } = await import(corePath)

const src = await readFile(tourSource, 'utf8')
const start = src.indexOf('const TOUR_STEPS')
const end = src.indexOf('\n]', start)
if (start === -1 || end === -1) throw new Error('Could not locate TOUR_STEPS in product-tour.tsx')
const block = src.slice(start, end)

const steps = []
const re = /id: '([^']+)'[\s\S]*?text:\s*("[^"]*"|'[^']*')/g
for (let m; (m = re.exec(block)); ) {
    // The capture is a JS string literal from our own source; evaluate it to
    // resolve the quoting.
    steps.push({ id: m[1], text: new Function(`return ${m[2]}`)() })
}
if (steps.length === 0) throw new Error('Parsed zero tour steps — regex out of sync with product-tour.tsx?')
console.log(`Parsed ${steps.length} tour steps`)

await mkdir(outDir, { recursive: true })
for (const step of steps) {
    process.stdout.write(`synthesizing ${step.id}... `)
    const { audioBase64 } = await synthesizeSpeech(step.text)
    const file = path.join(outDir, `${step.id}.mp3`)
    await writeFile(file, Buffer.from(audioBase64, 'base64'))
    console.log(`${(audioBase64.length * 0.75 / 1024).toFixed(0)} KB`)
}
console.log(`Done — ${steps.length} clips in ${path.relative(process.cwd(), outDir)}`)
