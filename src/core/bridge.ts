import { ROUTING_BRIEF_BYTES } from './limits.ts'
import { createServer, type Server } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { link, lstat, mkdir, open, realpath, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseJson } from './json.ts'
import { record, requireThat, validateTask } from './config.ts'
export interface BridgeConnection { version: 1; endpoint: string; token: string; expiresAt: number }
export async function startBridge(directory: string, decide: (task: string, session: string, signal: AbortSignal) => Promise<unknown>): Promise<{ path: string; close(): Promise<void> }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 24 * 60 * 60_000
  const lifetime = new AbortController()
  let inFlight = false, count = 0, windowAt = Date.now()
  const server: Server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json')
    const reject = (status: number) => { res.writeHead(status); res.end('{"error":"request_refused"}') }
    const received = String(req.headers.authorization ?? '')
    const expected = 'Bearer ' + token
    if (lifetime.signal.aborted || Date.now() >= expiresAt || req.headers.origin || req.method !== 'POST' || req.url !== '/v1/decisions' || req.headers['content-type'] !== 'application/json' || Buffer.byteLength(received) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) { reject(403); return }
    if (inFlight) { reject(429); return }
    if (Date.now() - windowAt >= 60_000) { count = 0; windowAt = Date.now() }
    if (++count > 10) { reject(429); return }
    inFlight = true
    const client = new AbortController()
    res.once('close', () => client.abort())
    const signal = AbortSignal.any([lifetime.signal, client.signal])
    try {
      const chunks: Buffer[] = []; let length = 0
      for await (const chunk of req) { length += chunk.length; requireThat(length <= 8192, 'request_too_large'); chunks.push(Buffer.from(chunk)) }
      const input: unknown = parseJson(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)))
      requireThat(record(input) && Object.keys(input).sort().join(',') === 'session,task' && typeof input.task === 'string' && typeof input.session === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(input.session), 'invalid_request')
      validateTask(input.task, ROUTING_BRIEF_BYTES)
      signal.throwIfAborted()
      const result = await decide(input.task, input.session, signal)
      signal.throwIfAborted()
      if (!res.destroyed) res.end(JSON.stringify(result))
    } catch { if (!res.destroyed) reject(400) } finally { inFlight = false }
  })
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 8
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
  const address = server.address(); requireThat(address && typeof address !== 'string', 'bridge_unavailable')
  const connection: BridgeConnection = { version: 1, endpoint: `http://127.0.0.1:${address.port}/v1/decisions`, token, expiresAt }
  const path = join(directory, 'connection.json')
  const temporary = join(directory, 'connection-' + randomUUID())
  let identity: Awaited<ReturnType<typeof lstat>>
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const parent = await lstat(directory)
    requireThat(parent.isDirectory() && await realpath(directory) === resolve(directory) &&
      (process.platform === 'win32' || (parent.mode & 0o077) === 0), 'bridge_path_refused')
    const file = await open(temporary, 'wx', 0o600)
    try {
      await file.writeFile(JSON.stringify(connection))
      await file.sync()
      identity = await file.stat()
    } finally { await file.close() }
    const current = await lstat(directory)
    requireThat(current.dev === parent.dev && current.ino === parent.ino, 'bridge_path_refused')
    // Publishing through a hard link fails if the connection name already exists.
    await link(temporary, path)
  } catch (error) {
    lifetime.abort()
    server.close()
    server.closeAllConnections()
    throw error
  } finally { await unlink(temporary).catch(() => {}) }
  let closing: Promise<void> | undefined
  return { path, close() {
    return closing ??= (async () => {
      lifetime.abort()
      const closed = new Promise<void>(resolve => server.close(() => resolve()))
      server.closeAllConnections()
      await closed
      try {
        const current = await lstat(path)
        if (current.isFile() && current.dev === identity.dev && current.ino === identity.ino) await unlink(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    })()
  } }
}
