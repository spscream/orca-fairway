import { createServer, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { record, requireThat } from './config.ts'
export interface BridgeConnection { version: 1; endpoint: string; token: string; expiresAt: number }
export async function startBridge(directory: string, decide: (task: string, session: string) => Promise<unknown>): Promise<{ path: string; close(): Promise<void> }> {
  const token = randomBytes(32).toString('hex')
  const expiresAt = Date.now() + 24 * 60 * 60_000
  let inFlight = false, count = 0, windowAt = Date.now()
  const server: Server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'application/json')
    const reject = (status: number) => { res.writeHead(status); res.end('{"error":"request_refused"}') }
    const received = String(req.headers.authorization ?? '')
    const expected = 'Bearer ' + token
    if (Date.now() >= expiresAt || req.headers.origin || req.method !== 'POST' || req.url !== '/v1/decisions' || req.headers['content-type'] !== 'application/json' || Buffer.byteLength(received) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(received), Buffer.from(expected))) { reject(403); return }
    if (inFlight) { reject(429); return }
    if (Date.now() - windowAt >= 60_000) { count = 0; windowAt = Date.now() }
    if (++count > 10) { reject(429); return }
    inFlight = true
    try {
      const chunks: Buffer[] = []; let length = 0
      for await (const chunk of req) { length += chunk.length; requireThat(length <= 8192, 'request_too_large'); chunks.push(Buffer.from(chunk)) }
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      requireThat(record(input) && Object.keys(input).sort().join(',') === 'session,task' && typeof input.task === 'string' && typeof input.session === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(input.session), 'invalid_request')
      const result = await decide(input.task, input.session)
      if (!res.destroyed) res.end(JSON.stringify(result))
    } catch { if (!res.destroyed) reject(400) } finally { inFlight = false }
  })
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 8
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() }) })
  const address = server.address(); requireThat(address && typeof address !== 'string', 'bridge_unavailable')
  const connection: BridgeConnection = { version: 1, endpoint: `http://127.0.0.1:${address.port}/v1/decisions`, token, expiresAt }
  const path = join(directory, 'connection.json')
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    // Never overwrite another worker's live connection file or follow a symlink.
    const file = await open(path, 'wx', 0o600)
    try { await file.writeFile(JSON.stringify(connection)); await file.sync() } finally { await file.close() }
  } catch (error) { server.closeAllConnections(); server.close(); throw error }
  return { path, async close() {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
    try { const current = JSON.parse(await readFile(path, 'utf8')); if (current.token === token) await unlink(path) } catch { /* Never delete an unrelated file. */ }
  } }
}
