import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { afterEach, test } from 'node:test'
import { createWebServer } from '../../../apps/web/server.mjs'

const openServers = []

/** Listen on a random loopback port and return the resolved origin. */
const listen = async (server) => {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  openServers.push(server)
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address.')
  return `http://127.0.0.1:${address.port}`
}

/** Close a listening test server. */
const closeServer = async (server) => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map(closeServer))
})

test('proxies same-origin API requests to the private service', async () => {
  const api = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ body, method: request.method, url: request.url }))
  })
  const apiOrigin = await listen(api)
  const web = createWebServer({
    apiUrl: apiOrigin,
    clientDirectory: '/missing',
    serverEntry: { fetch: () => new Response('rendered') }
  })
  const webOrigin = await listen(web)

  const response = await fetch(`${webOrigin}/rpc/downloads?view=active`, {
    body: 'payload',
    method: 'POST'
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    body: 'payload',
    method: 'POST',
    url: '/rpc/downloads?view=active'
  })
})

test('falls back to the built server entry for page requests', async () => {
  const web = createWebServer({
    apiUrl: 'http://127.0.0.1:1',
    clientDirectory: '/missing',
    serverEntry: { fetch: () => new Response('rendered page', { status: 203 }) }
  })
  const webOrigin = await listen(web)

  const response = await fetch(`${webOrigin}/downloads`)

  assert.equal(response.status, 203)
  assert.equal(await response.text(), 'rendered page')
})
