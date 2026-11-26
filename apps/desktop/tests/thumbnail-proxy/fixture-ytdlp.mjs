#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'

// Owned process protocol fixture: exercises the real wrapper and --proxy argv.
// It deliberately does not implement extraction or claim to produce real video.
const args = process.argv.slice(2)
const proxyIndex = args.indexOf('--proxy')
if (proxyIndex < 0) {
  process.stderr.write('Fixture missing --proxy\n')
  process.exit(7)
}
const proxy = new URL(args[proxyIndex + 1])
const thumbnail = process.env.PROBE_COVER_URL
const bytes = await new Promise((resolve, reject) => {
  http
    .get({ hostname: proxy.hostname, port: proxy.port, path: thumbnail }, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`fixture HTTP ${response.statusCode}`))
        response.resume()
        return
      }
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => resolve(Buffer.concat(chunks)))
    })
    .on('error', reject)
})
const file = path.join(process.env.PROBE_PROFILE, 'synthetic-output.mp4')
await fs.writeFile(file, bytes)
await fs.writeFile(
  path.join(process.env.PROBE_PROFILE, 'argv.json'),
  JSON.stringify({
    args,
    thumbnail,
    hash: crypto.createHash('sha256').update(bytes).digest('hex'),
    node: process.version,
    file
  })
)
process.stdout.write('[download] 100% of 87.00B in 00:00 at 1.00MiB/s\n')
process.stdout.write(`__VIDBEE_OUTPUT_PATH__:${file}\n`)
