/** Optional Pi 1.5+ virtual model. Load explicitly; never reads Pi/OpenRouter credentials. */
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
interface Model { provider: string; id: string }
interface Physical { model: Model; thinkingLevel?: string }
interface RouteRequest { reason: string; state?: { model: string; effort: string }; previous?: Physical; failed?: Physical; messages: { role: string; content: unknown }[]; signal: AbortSignal }
interface Context { modelRegistry: { find(provider: string, id: string): Model | undefined } }
interface PiApi { registerCommand(name: string, options: { description: string; handler(args: string): Promise<void> }): void; registerVirtualModel(definition: { provider: string; id: string; name: string; thinkingLevels: string[]; input: string[]; route(request: RouteRequest, ctx: Context): Promise<Physical & { state?: { model: string; effort: string } }> }): void }
const connectionPath = () => process.env.FAIRWAY_CONNECTION_FILE || join(homedir(), '.config', 'fairway-for-orca', 'connection.json')
export async function askFairway(task: string, signal: AbortSignal, path = connectionPath()): Promise<{ model: string; effort: string }> {
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK)
  const connection = await (async () => {
    try {
      const info = await file.stat()
      if (!info.isFile() || info.nlink !== 1 || info.size > 4096 || (process.platform !== 'win32' && (info.mode & 0o077) !== 0)) throw new Error('Fairway connection file must be private')
      const buffer = Buffer.alloc(4097)
      const { bytesRead } = await file.read(buffer)
      if (bytesRead !== info.size) throw new Error('Fairway connection unavailable')
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)))
    } finally { await file.close() }
  })()
  const url = new URL(connection.endpoint)
  if (connection.version !== 1 || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.pathname !== '/v1/decisions' || url.search || url.hash || url.username || url.password || !/^[a-f0-9]{64}$/.test(connection.token) || !Number.isFinite(connection.expiresAt) || connection.expiresAt <= Date.now()) throw new Error('Fairway connection unavailable')
  const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]), headers: { Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ task, session: 'pi-auto' }) })
  if (!response.ok) { await response.body?.cancel(); throw new Error('Fairway decision unavailable') }
  const reader = response.body!.getReader(); let size = 0; const chunks: Uint8Array[] = []
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 8192) throw new Error('Fairway response too large'); chunks.push(value) } }
  finally { await reader.cancel().catch(() => {}) }
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!data.profile || typeof data.profile.model !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\/[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(data.profile.model) || !['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(data.profile.effort)) throw new Error('Fairway returned an invalid pair')
  return data.profile
}
export function createPiExtension(ask = askFairway) {
  return function activate(pi: PiApi): void {
    let brief: string | null = null
    pi.registerCommand('fairway-brief', {
      description: 'Set an explicit short, sanitized routing brief; task files and history are never sent to JEV.',
      async handler(args) {
        if (!args.trim() || Buffer.byteLength(args) > 4096 || args.includes('\0')) throw new Error('Provide a sanitized brief of 1–4096 bytes')
        brief = args
      }
    })
    pi.registerVirtualModel({
      provider: 'fairway', id: 'auto', name: 'Fairway Auto', thinkingLevels: ['low', 'medium', 'high'], input: ['text'],
      async route(request, ctx) {
        // All continuations, retries, compaction and resumed branches keep the pinned pair.
        if (request.state) {
          const [provider, ...parts] = request.state.model.split('/')
          const model = ctx.modelRegistry.find(provider!, parts.join('/'))
          if (!model) throw new Error('Pinned Fairway model unavailable')
          return { model, thinkingLevel: request.state.effort }
        }
        if (request.reason !== 'user') {
          const prior = request.failed ?? request.previous
          if (prior) return prior
          throw new Error('Select a native model before a direct request')
        }
        // Only an explicit command brief goes to JEV. Expanded @files and history remain in Pi.
        if (!brief) throw new Error('Set /fairway-brief <short sanitized description> before using Fairway Auto')
        const task = brief
        brief = null
        const chosen = await ask(task, request.signal)
        request.signal.throwIfAborted()
        const [provider, ...parts] = chosen.model.split('/')
        const model = ctx.modelRegistry.find(provider!, parts.join('/'))
        if (!model) throw new Error('Chosen Fairway model is not in the Pi catalog')
        return { model, thinkingLevel: chosen.effort, state: chosen }
      }
    })
  }
}
export default createPiExtension()
