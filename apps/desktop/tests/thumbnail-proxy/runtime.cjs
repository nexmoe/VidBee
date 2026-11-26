'use strict'
// @surface desktop-thumbnail-ipc
const { app, BrowserWindow, session, protocol, nativeImage } = require('electron')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const http = require('node:http')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { createRequire } = require('node:module')
const { once } = require('node:events')
const root = process.env.PROBE_ROOT
const profile = process.env.PROBE_PROFILE
const mode = 'regression'
const req = createRequire(path.resolve(root, '../../apps/desktop/package.json'))
console.log('Runtime entered', mode, process.pid)
app.setActivationPolicy('prohibited')
app.disableHardwareAcceleration()
for (const [name, dir] of [
  ['appData', 'Data/Roaming'],
  ['userData', 'Data/UserData'],
  ['sessionData', 'Data/SessionData'],
  ['logs', 'Data/Logs'],
  ['downloads', 'Downloads'],
  ['temp', 'Temp']
]) {
  fs.mkdirSync(path.join(profile, dir), { recursive: true })
  app.setPath(name, path.join(profile, dir))
}
protocol.registerSchemesAsPrivileged([
  { scheme: 'vidbee', privileges: { standard: false, secure: true, supportFetchAPI: true } }
])
const receipts = []
const failures = []
const servers = []
let win
let exit = 0
const record = (name, evidence) => {
  receipts.push({ name, evidence })
  console.log('PASS', name, JSON.stringify(evidence))
}
const listen = async (server) => {
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}
const eventually = async (fn, name, timeout = 2500) => {
  const deadline = Date.now() + timeout
  for (;;) {
    const result = await fn()
    if (result) {
      return result
    }
    if (Date.now() >= deadline) {
      throw new Error(`Timed out: ${name}`)
    }
    await new Promise((resolve) => setImmediate(resolve))
  }
}
const test = async (name, fn) => {
  try {
    await fn()
  } catch (error) {
    failures.push({ name, error: error.stack })
    console.error('FAIL', name, error.stack)
    exit = 1
  }
}
const state = () => win.webContents.executeJavaScript('window.probe.state()')
const run = (code) => win.webContents.executeJavaScript(code)
const coverageSession = new (require('node:inspector').Session)()
coverageSession.connect()
const coverageCommand = (method, params = {}) =>
  new Promise((resolve, reject) =>
    coverageSession.post(method, params, (error, result) =>
      error ? reject(error) : resolve(result)
    )
  )

app
  .whenReady()
  .then(async () => {
    await coverageCommand('Profiler.enable')
    await coverageCommand('Profiler.startPreciseCoverage', { callCount: true, detailed: true })
    // Trust only the owned certificate, including in the single reusable thumbnail session.
    const certificate = await fsp.readFile(path.join(root, 'tls/cert.pem'))
    const fingerprint = new crypto.X509Certificate(certificate).fingerprint256
    const createdSessions = new Set()
    app.on('session-created', (imageSession) => {
      createdSessions.add(imageSession)
      imageSession.setCertificateVerifyProc((request, callback) => {
        const owned =
          request.hostname === 'covers.invalid' &&
          new crypto.X509Certificate(request.certificate.data).fingerprint256 === fingerprint
        callback(owned ? 0 : -3)
      })
    })
    console.log('Background Electron ready; importing source modules')
    const { fixture: source } = await import(
      require('node:url').pathToFileURL(path.join(root, 'main.mjs')).href
    )
    source.createServices([source.SettingsService, source.ThumbnailService])
    const png = nativeImage
      .createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 })
      .toPNG()
    const hash = crypto.createHash('sha256').update(png).digest('hex')
    if (nativeImage.createFromBuffer(png).isEmpty()) {
      throw new Error('Invalid fixture PNG')
    }
    let originHits = 0
    let proxyHits = 0
    const proxyCookies = []
    const originPort = await listen(
      http.createServer((request, response) => {
        originHits += 1
        if (request.url === '/missing') {
          response.writeHead(404)
          response.end()
          return
        }
        if (request.url === '/not-image') {
          response.writeHead(200, { 'content-type': 'text/html' })
          response.end('<html>denied</html>')
          return
        }
        response.writeHead(200, {
          'content-type': 'image/png',
          'cache-control': 'no-store',
          'set-cookie': 'fixture-response=ignored; Path=/'
        })
        response.end(png)
      })
    )
    const proxyPort = await listen(
      http.createServer((request, response) => {
        proxyHits += 1
        proxyCookies.push(request.headers.cookie ?? null)
        const url = new URL(request.url)
        if (url.hostname !== 'covers.invalid' || url.port !== String(originPort)) {
          response.writeHead(403)
          response.end()
          return
        }
        const out = http.get(
          {
            hostname: '127.0.0.1',
            port: originPort,
            path: url.pathname,
            headers: { host: url.host }
          },
          (incoming) => {
            response.writeHead(incoming.statusCode, incoming.headers)
            incoming.pipe(response)
          }
        )
        out.on('error', () => {
          response.writeHead(502)
          response.end()
        })
      })
    )
    const url = `http://covers.invalid:${originPort}/cover.png`
    const proxy = `http://127.0.0.1:${proxyPort}`
    const closed = http.createServer()
    const deadPort = await listen(closed)
    await new Promise((resolve) => closed.close(resolve))
    const deadProxy = `http://127.0.0.1:${deadPort}`
    const controlSession = session.fromPartition(`control-${Date.now()}`, { cache: false })
    await controlSession.setProxy({
      mode: 'fixed_servers',
      proxyRules: proxy,
      proxyBypassRules: '<-loopback>'
    })
    await test('user controls prove valid image bytes are available only through the owned proxy', async () => {
      // Given a valid PNG available through an owned proxy and an unresolvable image hostname.
      // When both the configured Electron transport and direct fetch request it.
      // --no-proxy-server must not override explicit per-session configuration.
      const resolvedProxy = await controlSession.resolveProxy(url)
      assert.match(resolvedProxy, /^PROXY 127\.0\.0\.1:/)
      const controlResponse = await controlSession.fetch(url, { signal: AbortSignal.timeout(3000) })
      assert.deepEqual(Buffer.from(await controlResponse.arrayBuffer()), png)
      let directError
      try {
        await fetch(url, { signal: AbortSignal.timeout(3000) })
      } catch (error) {
        directError = error.cause?.code ?? error.name
      }
      assert.equal(directError, 'ENOTFOUND')
      record('user controls prove valid image bytes are available only through the owned proxy', {
        directError,
        resolvedProxy,
        hash,
        bytes: png.length,
        originHits,
        proxyHits
      })

      // Then only the proxy route returns the original bytes.
    })

    win = new BrowserWindow({
      show: false,
      focusable: false,
      skipTaskbar: true,
      paintWhenInitiallyHidden: false,
      webPreferences: {
        offscreen: true,
        backgroundThrottling: false,
        contextIsolation: true,
        sandbox: true,
        preload: path.join(root, 'preload.cjs')
      }
    })
    for (const event of ['show', 'focus']) {
      win.on(event, () => {
        console.error('ISOLATION VIOLATION', event)
        app.exit(99)
      })
    }
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    protocol.registerFileProtocol('vidbee', (request, callback) => {
      const parsed = new URL(request.url)
      const file = path.join(
        app.getPath('userData'),
        parsed.hostname,
        decodeURIComponent(parsed.pathname)
      )
      callback(file)
    })
    await win.loadFile(path.join(root, 'index.html'))
    win.webContents.debugger.attach('1.3')
    await win.webContents.debugger.sendCommand('Profiler.enable')
    await win.webContents.debugger.sendCommand('Profiler.startPreciseCoverage', {
      callCount: true,
      detailed: true
    })
    await eventually(async () => (await state()).mounts === 1, 'initial mount')
    await test('user runtime remains offscreen hidden and unfocused', async () => {
      // Given a background-only app and a window created hidden and unfocusable.
      // When its renderer loads the real settings atom and thumbnail hook.
      assert.equal(win.isVisible(), false)
      assert.equal(win.isFocused(), false)
      assert.equal(win.webContents.isOffscreen(), true)
      record('user runtime remains offscreen hidden and unfocused', {
        visible: win.isVisible(),
        focused: win.isFocused(),
        offscreen: win.webContents.isOffscreen(),
        profile: app.getPath('userData'),
        electron: process.versions.electron
      })
      // Then the window is offscreen, invisible and unfocused.
    })

    await test('user saved proxy reaches actual thumbnail IPC and cache', async () => {
      // Given the proxy-only cover and an empty disk cache.
      // When the settings atom persists the proxy through real settings IPC.
      assert.equal(await run(`window.probe.save(${JSON.stringify(proxy)})`), proxy)
      const before = proxyHits
      const localUrl = await run(`window.probe.raw(${JSON.stringify(url)})`)
      const observed = {
        localUrl,
        proxyRequests: proxyHits - before,
        persistedProxy: source.settingsManager.get('proxy')
      }
      // Then thumbnail IPC returns an app URL with byte-identical PNG data.
      assert.match(
        localUrl ?? '',
        /^vidbee:\/\/thumbnails\//,
        'Saved proxy must let real thumbnail IPC return local cover URL'
      )
      const filename = path.basename(localUrl)
      assert.deepEqual(
        await fsp.readFile(path.join(app.getPath('userData'), 'thumbnails', filename)),
        png
      )
      assert.equal(proxyHits - before, 1)
      record('user saved proxy reaches actual thumbnail IPC and cache', { ...observed, hash })
    })

    await test('user saved proxy change retries unchanged cover without remount', async () => {
      // Given a mounted cover whose first request fails with a dead proxy.
      const retryUrl = url.replace('cover.png', 'retry.png')
      await run(`window.probe.save(${JSON.stringify(deadProxy)})`)
      await run(`window.probe.show(${JSON.stringify(retryUrl)})`)
      // A second raw call shares the production pending request and establishes its terminal result.
      assert.equal(await run(`window.probe.raw(${JSON.stringify(retryUrl)})`), null)
      await run(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
      )
      assert.equal((await state()).resolved, 'missing')
      const before = await state()
      // When a working proxy is persisted without changing the cover URL.
      await run(`window.probe.save(${JSON.stringify(proxy)})`)
      try {
        await eventually(
          async () => (await state()).decoded === 1,
          'same URL cover after proxy save',
          1800
        )
      } catch (error) {
        console.log(
          'OBSERVED_RETRY',
          JSON.stringify({
            before,
            after: await state(),
            savedProxy: source.settingsManager.get('proxy')
          })
        )
        throw error
      }
      const after = await state()
      // Then that same mounted cover decodes without a remount.
      assert.equal(after.mounts, before.mounts)
      assert.match(after.resolved, /^vidbee:\/\/thumbnails\//)
      record('user saved proxy change retries unchanged cover without remount', { before, after })
    })

    await test('user established local and rejection controls remain usable', async () => {
      // Given local images, an invalid URL and a non-image response.
      // When they are requested, followed by repeated reads of a valid cached cover.
      for (const local of [
        'vidbee://thumbnails/local.png',
        'file:///tmp/fixture.png',
        `data:image/png;base64,${png.toString('base64')}`
      ]) {
        assert.equal(await run(`window.probe.raw(${JSON.stringify(local)})`), local)
      }
      assert.equal(await run('window.probe.raw("not a URL")'), null)
      assert.equal(
        await run(
          `window.probe.raw(${JSON.stringify(`http://127.0.0.1:${originPort}/not-image`)})`
        ),
        null
      )
      const directUrl = `http://127.0.0.1:${originPort}/cached.png`
      const first = await run(`window.probe.raw(${JSON.stringify(directUrl)})`)
      assert.match(first ?? '', /^vidbee:\/\/thumbnails\//)
      const before = originHits
      assert.equal(await run(`window.probe.raw(${JSON.stringify(directUrl)})`), first)
      // Then bypasses, rejections and valid disk cache hits keep their existing behavior.
      assert.equal(originHits, before)
      record('user established local and rejection controls remain usable', {
        cacheHitAvoidedNetwork: true,
        localVariants: 3,
        malformed: null,
        nonImage: null
      })
    })
    await test('user saved proxy survives facade queue persistence and real executor spawn', async () => {
      // Given persisted settings from the real renderer/IPC and metadata already available in a list row.
      await run('window.probe.show(null)')
      await run(`window.probe.save(${JSON.stringify(proxy)})`)
      source.settingsManager.setAll({
        downloadPath: path.join(profile, 'Downloads'),
        browserForCookies: 'none',
        cookiesPath: '',
        configPath: '',
        downloadSubtitles: false,
        embedThumbnail: false
      })
      const input = await source.prepareDownloadTaskInput('fixture-474', {
        url: 'https://www.youtube.com/watch?v=fixture474',
        type: 'video',
        title: 'Synthetic issue 474 fixture',
        thumbnail: url,
        duration: 1
      })
      assert.equal(input.options.settings.proxy, proxy)
      assert.equal(input.thumbnail, url)
      const Database = req('better-sqlite3')
      const dbPath = path.join(profile, 'queue.db')
      const db = new Database(dbPath)
      db.exec(source.TASK_QUEUE_DDL_V1)
      const persist = new source.SqlitePersistAdapter({ db, ownsConnection: false })
      const executable = path.join(root, 'fixture-ytdlp.mjs')
      await fsp.chmod(executable, 0o755)
      process.env.PROBE_COVER_URL = url
      const executor = new source.YtDlpExecutor({
        resolveYtDlpPath: () => executable,
        resolveFfmpegLocation: () => profile,
        defaultDownloadDir: path.join(profile, 'Downloads')
      })
      const queue = new source.TaskQueueAPI({ persist, executor, maxConcurrency: 1 })
      try {
        // When the real SQLite-backed queue dispatches through the real yt-dlp wrapper to an owned executable.
        await queue.start()
        const { id } = await queue.add({ input, maxAttempts: 1 })
        await eventually(
          () => ['completed', 'failed'].includes(queue.get(id)?.status),
          'fixture queue completion',
          6000
        )
        const task = queue.get(id)
        assert.equal(task.status, 'completed', JSON.stringify(task.lastError))
        const spawned = JSON.parse(await fsp.readFile(path.join(profile, 'argv.json'), 'utf8'))
        const i = spawned.args.indexOf('--proxy')
        assert.equal(spawned.args[i + 1], proxy)
        assert.equal(spawned.hash, hash)
        assert.equal(spawned.node, 'v22.22.3')
        const saved = db.prepare('SELECT status,input_json FROM tasks WHERE id = ?').get(id)
        assert.equal(saved.status, 'completed')
        assert.equal(JSON.parse(saved.input_json).options.settings.proxy, proxy)
        assert.equal(JSON.parse(saved.input_json).thumbnail, url)
        // Then both the persisted task and process/network boundary carry the same configured proxy and cover.
        record('user saved proxy survives facade queue persistence and real executor spawn', {
          status: task.status,
          proxy,
          thumbnail: url,
          hash: spawned.hash,
          node: spawned.node,
          db: dbPath,
          processFixtureOnly: true
        })
      } finally {
        await queue.stop()
        db.close()
      }
    })
    await test('user invalid old cache recovers and failed responses stay retryable', async () => {
      // Given an old empty image cache, as well as an image saved under the wrong extension.
      await run('window.probe.show(null)')
      await run(`window.probe.save(${JSON.stringify(proxy)})`)
      assert.equal(await run('window.probe.raw(null)'), null)
      for (const [suffix, bytes] of [
        ['empty.png', Buffer.alloc(0)],
        [
          'mismatch.jpg',
          Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>')
        ]
      ]) {
        const repairUrl = url.replace('cover.png', suffix)
        const base = path.join(
          app.getPath('userData'),
          'thumbnails',
          crypto.createHash('sha1').update(repairUrl).digest('hex')
        )
        const old = base + path.extname(suffix)
        await fsp.writeFile(old, bytes)
        // When requested through real IPC, invalid old entries must be replaced by a valid image.
        const repaired = await run(`window.probe.raw(${JSON.stringify(repairUrl)})`)
        assert.deepEqual(
          await fsp.readFile(
            path.join(app.getPath('userData'), 'thumbnails', path.basename(repaired))
          ),
          png
        )
      }
      const missing = url.replace('cover.png', 'missing')
      // Then HTTP errors are never cached, and another attempt remains possible.
      assert.equal(await run(`window.probe.raw(${JSON.stringify(missing)})`), null)
      assert.equal(await run(`window.probe.raw(${JSON.stringify(missing)})`), null)
      record('user invalid old cache recovers and failed responses stay retryable', {
        emptyRepaired: true,
        extensionMismatchRepaired: true,
        http404RejectedTwice: true,
        nullInput: null
      })
    })

    await test('user HTTPS cover follows the saved HTTP proxy', async () => {
      // Given an owned TLS origin; only its generated certificate is trusted in this isolated app.
      const https = require('node:https')
      const socketNet = require('node:net')
      const key = await fsp.readFile(path.join(root, 'tls/key.pem'))
      const cert = await fsp.readFile(path.join(root, 'tls/cert.pem'))
      const tlsPort = await listen(
        https.createServer({ key, cert }, (_request, response) => {
          response.writeHead(200, { 'content-type': 'image/png' })
          response.end(png)
        })
      )
      const tunnelServer = http.createServer((_request, response) => {
        response.writeHead(403)
        response.end()
      })
      let tunnels = 0
      tunnelServer.on('connect', (request, socket, head) => {
        if (request.url !== `covers.invalid:${tlsPort}`) {
          socket.end('HTTP/1.1 403 Forbidden\r\n\r\n')
          return
        }
        tunnels += 1
        const originSocket = socketNet.connect(tlsPort, '127.0.0.1', () => {
          socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          if (head.length) {
            originSocket.write(head)
          }
          socket.pipe(originSocket)
          originSocket.pipe(socket)
        })
        socket.on('error', () => originSocket.destroy())
        originSocket.on('error', () => socket.destroy())
        socket.on('close', () => originSocket.destroy())
      })
      const tunnelPort = await listen(tunnelServer)
      let tlsControl
      try {
        const secureUrl = `https://covers.invalid:${tlsPort}/secure.png`
        const defaultRoute = await session.defaultSession.resolveProxy(secureUrl)
        tlsControl = session.fromPartition(`tls-control-${Date.now()}`, { cache: false })
        createdSessions.delete(tlsControl)
        await tlsControl.setProxy({
          mode: 'fixed_servers',
          proxyRules: `http://127.0.0.1:${tunnelPort}`
        })
        const response = await tlsControl.fetch(secureUrl, { signal: AbortSignal.timeout(3000) })
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), png)
        // When the proxy is saved, actual thumbnail IPC must tunnel HTTPS and persist identical image bytes.
        await run(`window.probe.save(${JSON.stringify(`http://127.0.0.1:${tunnelPort}`)})`)
        await run(`window.probe.show(${JSON.stringify(secureUrl)})`)
        await eventually(async () => (await state()).decoded === 1, 'HTTPS cover decoded')
        const local = (await state()).resolved
        assert.match(local ?? '', /^vidbee:\/\/thumbnails\//)
        assert.deepEqual(
          await fsp.readFile(
            path.join(app.getPath('userData'), 'thumbnails', path.basename(local))
          ),
          png
        )
        assert.equal(tunnels, 2)
        // Then the application's default networking session remains unchanged.
        assert.equal(await session.defaultSession.resolveProxy(secureUrl), defaultRoute)
        record('user HTTPS cover follows the saved HTTP proxy', {
          tunnels,
          hash,
          defaultRoute,
          isolatedCertificate: true
        })
      } finally {
        await tlsControl?.closeAllConnections()
      }
    })

    await test('user old proxy work cannot overwrite a newer cover', async () => {
      // Given an old response held at the real HTTP boundary, and a new proxy with distinct valid bytes.
      const blue = nativeImage
        .createFromBitmap(Buffer.from([255, 0, 0, 255]), { width: 1, height: 1 })
        .toPNG()
      assert.notDeepEqual(blue, png)
      let releaseOld
      let oldStartedResolve
      let oldClosedResolve
      const oldStarted = new Promise((resolve) => {
        oldStartedResolve = resolve
      })
      const oldClosed = new Promise((resolve) => {
        oldClosedResolve = resolve
      })
      const oldPort = await listen(
        http.createServer((_request, response) => {
          response.on('close', oldClosedResolve)
          releaseOld = () => {
            response.writeHead(200, { 'content-type': 'image/png' })
            response.end(png)
          }
          oldStartedResolve()
        })
      )
      const newResponses = []
      let newStartedResolve
      const newStarted = new Promise((resolve) => {
        newStartedResolve = resolve
      })
      const newPort = await listen(
        http.createServer((_request, response) => {
          newResponses.push(response)
          newStartedResolve()
        })
      )
      const raceUrl = url.replace('cover.png', 'race.png')
      await run('window.probe.show(null)')
      await run(`window.probe.save(${JSON.stringify(`http://127.0.0.1:${oldPort}`)})`)
      await run(`window.probe.show(${JSON.stringify(raceUrl)})`)
      await Promise.race([
        oldStarted,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('old proxy not reached')), 3000)
        )
      ])
      const obsolete = run(`window.probe.raw(${JSON.stringify(raceUrl)})`)
      // When saved settings change before the old body is released, the mounted renderer must recover.
      await run(`window.probe.save(${JSON.stringify(`http://127.0.0.1:${newPort}`)})`)
      await newStarted
      assert.equal(await obsolete, null)
      await oldClosed
      // The obsolete task has settled while the newer same-URL body is still pending.
      const overlapping = run(`window.probe.raw(${JSON.stringify(raceUrl)})`)
      // A cached IPC round trip drains the same filesystem lookup boundary before releasing the body.
      await run(`window.probe.raw(${JSON.stringify(url)})`)
      for (const response of newResponses) {
        response.writeHead(200, { 'content-type': 'image/png' })
        response.end(blue)
      }
      await eventually(async () => (await state()).decoded === 1, 'new cover decoded')
      const freshUrl = (await state()).resolved
      assert.deepEqual(
        await fsp.readFile(
          path.join(app.getPath('userData'), 'thumbnails', path.basename(freshUrl))
        ),
        blue
      )
      assert.equal(await overlapping, freshUrl)
      assert.equal(newResponses.length, 1)
      releaseOld()
      // Then a same-URL request and the mounted image must retain the newer bytes.
      assert.equal(await run(`window.probe.raw(${JSON.stringify(raceUrl)})`), freshUrl)
      assert.deepEqual(
        await fsp.readFile(
          path.join(app.getPath('userData'), 'thumbnails', path.basename(freshUrl))
        ),
        blue
      )
      assert.equal((await state()).mounts, 1)
      record('user old proxy work cannot overwrite a newer cover', {
        oldAborted: true,
        newPendingShared: true,
        newHash: crypto.createHash('sha256').update(blue).digest('hex'),
        mounts: 1,
        cachedBytes: blue.length
      })
    })

    await test('user stalled response terminates and same URL can retry', async () => {
      // Given a proxy that sends image headers but never finishes its body.
      let finishBody = false
      let timedOutConnectionClosed = false
      const stallPort = await listen(
        http.createServer((_request, response) => {
          response.on('close', () => {
            if (!finishBody) {
              timedOutConnectionClosed = true
            }
          })
          response.writeHead(200, { 'content-type': 'image/png' })
          response.flushHeaders()
          if (finishBody) {
            response.end(png)
          }
        })
      )
      const stalledUrl = url.replace('cover.png', 'stalled.png')
      await run('window.probe.show(null)')
      await run(`window.probe.save(${JSON.stringify(`http://127.0.0.1:${stallPort}`)})`)
      const start = Date.now()
      // When the full body stalls, the production timeout must settle the request.
      assert.equal(await run(`window.probe.raw(${JSON.stringify(stalledUrl)})`), null)
      const elapsed = Date.now() - start
      assert.ok(elapsed >= 14_000 && elapsed < 18_000, `timeout elapsed ${elapsed}`)
      await eventually(() => timedOutConnectionClosed, 'aborted network connection')
      assert.equal(
        (await fsp.readdir(path.join(app.getPath('userData'), 'thumbnails'))).some((name) =>
          name.endsWith('.tmp')
        ),
        false
      )
      finishBody = true
      const recovered = await run(`window.probe.raw(${JSON.stringify(stalledUrl)})`)
      // Then pending work is cleared and this exact URL can succeed without changing settings.
      assert.match(recovered ?? '', /^vidbee:\/\/thumbnails\//)
      assert.deepEqual(
        await fsp.readFile(
          path.join(app.getPath('userData'), 'thumbnails', path.basename(recovered))
        ),
        png
      )
      record('user stalled response terminates and same URL can retry', {
        elapsed,
        connectionClosed: timedOutConnectionClosed,
        noTemporaryFiles: true,
        recovered
      })
    })
    await test('user local covers bypass remote networking in the mounted renderer', async () => {
      // Given a mounted cover and an inline PNG.
      const inline = `data:image/png;base64,${png.toString('base64')}`
      const before = proxyHits
      // When local data is displayed, then a blob URL and an empty URL are supplied.
      await run(`window.probe.show(${JSON.stringify(inline)})`)
      await eventually(async () => (await state()).decoded === 1, 'inline image decoded')
      assert.equal((await state()).resolved, inline)
      await run('window.probe.show("blob:unsupported-thumbnail")')
      await eventually(async () => (await state()).resolved === 'missing', 'blob bypass')
      await run('window.probe.show(null)')
      assert.equal(await source.thumbnailCache.getThumbnailUrl(''), null)
      assert.equal(await run('window.probe.raw("ftp://covers.invalid/cover.png")'), null)
      // Then no proxy request is made and the same component remains mounted.
      assert.equal(proxyHits, before)
      assert.equal((await state()).mounts, 1)
      record('user local covers bypass remote networking in the mounted renderer', {
        inlineDecoded: true,
        blobRejected: true,
        noNetwork: true,
        mounts: 1
      })
    })
    await test('user cover requests never forward browser cookies', async () => {
      // Given a synthetic cookie in this isolated profile's default browser session.
      await run('window.probe.show(null)')
      await run(`window.probe.save(${JSON.stringify(proxy)})`)
      await session.defaultSession.cookies.set({
        url,
        name: 'fixture-browser',
        value: 'isolated-test-data'
      })
      const before = proxyCookies.length
      // When two fresh covers are fetched, including a response carrying Set-Cookie.
      for (const suffix of ['cookie-first.png', 'cookie-second.png']) {
        const local = await run(
          `window.probe.raw(${JSON.stringify(url.replace('cover.png', suffix))})`
        )
        assert.match(local, /^vidbee:\/\/thumbnails\//)
      }
      // Then neither request carries Cookie, and the browser's own cookie remains intact.
      assert.deepEqual(proxyCookies.slice(before), [null, null])
      const browserCookies = await session.defaultSession.cookies.get({
        url,
        name: 'fixture-browser'
      })
      assert.equal(browserCookies.length, 1)
      record('user cover requests never forward browser cookies', {
        cookieHeaders: [null, null],
        browserCookieRetained: true
      })
    })
    await test('user repeated proxy edits retain one private thumbnail transport', async () => {
      // Given many saved proxy values and a renderer using the default session.
      createdSessions.delete(controlSession)
      createdSessions.delete(session.defaultSession)
      // When all HTTP, HTTPS, retry and cancellation scenarios have completed.
      // Then only one additional session is retained, and the browser route remains direct.
      assert.equal(createdSessions.size, 1)
      assert.equal(await session.defaultSession.resolveProxy(url), 'DIRECT')
      record('user repeated proxy edits retain one private thumbnail transport', {
        thumbnailSessions: createdSessions.size,
        defaultRoute: 'DIRECT'
      })
    })
    await fsp.writeFile(
      path.join(root, `receipts/${mode}-main-coverage.json`),
      JSON.stringify(await coverageCommand('Profiler.takePreciseCoverage'))
    )
    await fsp.writeFile(
      path.join(root, `receipts/${mode}-renderer-coverage.json`),
      JSON.stringify(await win.webContents.debugger.sendCommand('Profiler.takePreciseCoverage'))
    )
    await fsp.writeFile(
      path.join(root, `receipts/${mode}-runtime.json`),
      JSON.stringify(
        { revision: process.env.PROBE_REVISION, receipts, failures, hash, proxyHits, originHits },
        null,
        2
      )
    )
  })
  .catch((error) => {
    console.error(error.stack)
    exit = 2
  })
  .finally(async () => {
    if (win && !win.isDestroyed()) {
      assert.equal(win.isVisible(), false)
      assert.equal(win.isFocused(), false)
      win.destroy()
    }
    for (const server of servers) {
      server.closeAllConnections()
      server.close()
    }
    coverageSession.disconnect()
    app.exit(exit)
  })
