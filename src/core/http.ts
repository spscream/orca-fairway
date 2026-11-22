import { request, type RequestOptions } from 'node:https'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { requireThat, RouterError } from './config.ts'
import { parseJson } from './json.ts'
const ENDPOINTS = new Map([
  ['https://openrouter.ai/api/v1/credits', 'GET'],
  ['https://openrouter.ai/api/v1/key', 'GET'],
  ['https://openrouter.ai/api/v1/model/typesafe/jev-1.14', 'GET'],
  ['https://openrouter.ai/api/alpha/decisions', 'POST']
])
export interface JsonOptions { key?: string; body?: string; signal: AbortSignal; maxBytes: number }
export type JsonRequest = (url: string, options: JsonOptions) => Promise<{ status: number; value?: unknown }>
export type Requester = (url: string, options: RequestOptions & { autoSelectFamily: false }, callback: (response: IncomingMessage) => void) => ClientRequest
export function createJsonRequest(send: Requester = request): JsonRequest {
  return async (url, { key, body, signal: caller, maxBytes }) => {
    const method = body === undefined ? 'GET' : 'POST'
    requireThat(ENDPOINTS.get(url) === method, 'endpoint_refused')
    requireThat(Number.isInteger(maxBytes) && maxBytes > 0 && maxBytes <= 65536, 'invalid_response_limit')
    requireThat(body === undefined || Buffer.byteLength(body) <= 16384, 'request_too_large')
    requireThat(key === undefined || /^[\x21-\x7e]{1,4096}$/.test(key), 'invalid_key')
    const signal = AbortSignal.any([caller, AbortSignal.timeout(10000)])
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      let req: ClientRequest | undefined, response: IncomingMessage | undefined, settled = false
      const cleanup = () => signal.removeEventListener('abort', aborted)
      const fail = (code: string) => {
        if (settled) return
        settled = true; cleanup(); reject(new RouterError(code)); response?.destroy(); req?.destroy()
      }
      const aborted = () => fail(signal.reason?.name === 'TimeoutError' ? 'request_timeout' : 'request_cancelled')
      signal.addEventListener('abort', aborted, { once: true })
      try {
        req = send(url, {
          method, family: 4, autoSelectFamily: false, agent: false, rejectUnauthorized: true,
          headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
            ...(key ? { Authorization: `Bearer ${key}` } : {}), ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }) }
        }, incoming => {
          response = incoming
          incoming.on('error', () => fail('http_unavailable'))
          if (settled) { incoming.destroy(); return }
          const status = incoming.statusCode ?? 0
          // Never follow redirects or retain error bodies (which may contain private data).
          if (status !== 200) { settled = true; cleanup(); incoming.destroy(); resolve({ status }); return }
          const chunks: Buffer[] = []; let length = 0
          incoming.on('data', (chunk: Buffer) => {
            if (settled) return
            length += chunk.length
            if (length > maxBytes) { fail('response_too_large'); return }
            chunks.push(chunk)
          })
          incoming.on('aborted', () => fail('http_unavailable'))
          incoming.on('end', () => {
            if (settled) return
            try { const value = parseJson(Buffer.concat(chunks).toString('utf8')); settled = true; cleanup(); resolve({ status, value }) }
            catch { fail('invalid_response') }
          })
        })
        req.on('error', (error: NodeJS.ErrnoException) => fail(error.code === 'ETIMEDOUT' ? 'request_timeout' : 'http_unavailable'))
        if (signal.aborted) { aborted(); return }
        req.end(body)
      } catch { fail('http_unavailable') }
    })
  }
}
export const requestJson = createJsonRequest()
