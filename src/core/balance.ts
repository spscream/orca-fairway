import { record, requireThat, RouterError } from './config.ts'
import { parseJson } from './json.ts'
export const CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
export const KEY_URL = 'https://openrouter.ai/api/v1/key'
export type BalanceState = 'available' | 'unlimited' | 'restricted' | 'unavailable' | 'missing_key' | 'invalid_key' | 'timeout'
export interface BalanceItem { state: BalanceState; remainingUsd: number | null }
export interface BalanceSnapshot { account: BalanceItem; key: BalanceItem; checkedAt: number }
export type BalanceTransport = (url: string, key: string, signal: AbortSignal) => Promise<{ status: number; value?: unknown }>
const empty = (state: BalanceState): BalanceItem => ({ state, remainingUsd: null })
const money = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12
async function abortable<T>(action: () => Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let listener: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    listener = () => reject(new RouterError('balance_cancelled')); signal.addEventListener('abort', listener, { once: true })
  })
  try { return await Promise.race([aborted, Promise.resolve().then(action)]) }
  finally { signal.removeEventListener('abort', listener) }
}
export function accountBalance(value: unknown): BalanceItem {
  requireThat(record(value) && record(value.data), 'invalid_balance')
  const d = value.data
  requireThat(money(d.total_credits) && d.total_credits >= 0 && money(d.total_usage) && d.total_usage >= 0, 'invalid_balance')
  return { state: 'available', remainingUsd: d.total_credits - d.total_usage }
}
export function keyBalance(value: unknown): BalanceItem {
  requireThat(record(value) && record(value.data), 'invalid_balance')
  const d = value.data
  if (d.limit === null && d.limit_remaining === null) return empty('unlimited')
  requireThat(money(d.limit) && d.limit >= 0 && money(d.limit_remaining) && d.limit_remaining <= d.limit, 'invalid_balance')
  return { state: 'available', remainingUsd: d.limit_remaining }
}
export const balanceTransport: BalanceTransport = async (url, key, signal) => {
  requireThat(url === CREDITS_URL || url === KEY_URL, 'endpoint_refused')
  const response = await fetch(url, { method: 'GET', signal, redirect: 'error', cache: 'no-store', headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } })
  if (!response.ok) { await response.body?.cancel(); return { status: response.status } }
  requireThat(response.body, 'empty_response')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; requireThat(size <= 16384, 'response_too_large'); chunks.push(value) }
    return { status: response.status, value: parseJson(Buffer.concat(chunks).toString('utf8')) }
  } catch (error) { await reader.cancel().catch(() => {}); throw error }
}
export class Balances {
  private snapshot: BalanceSnapshot | null = null
  private pending: Promise<BalanceSnapshot> | null = null
  private controller: AbortController | null = null
  private revision = 0
  constructor(private getKey: () => Promise<string | null>, private transport: BalanceTransport = balanceTransport, private timeoutMs = 8000, private now = Date.now) {}
  cached(): BalanceSnapshot | null { return this.snapshot }
  invalidate(): void { this.revision++; this.snapshot = null; this.pending = null; this.controller?.abort(); this.controller = null }
  refresh(): Promise<BalanceSnapshot> {
    if (this.snapshot && this.now() - this.snapshot.checkedAt >= 0 && this.now() - this.snapshot.checkedAt < 30000) return Promise.resolve(this.snapshot)
    if (this.pending) return this.pending
    const revision = this.revision, controller = new AbortController(); this.controller = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)])
    const request = (async () => {
      let key: string | null
      try { key = await abortable(() => this.getKey(), signal) }
      catch {
        if (revision !== this.revision) throw new RouterError('balance_cancelled')
        const state = signal.reason?.name === 'TimeoutError' ? 'timeout' : 'unavailable'
        this.snapshot = { account: empty(state), key: empty(state), checkedAt: this.now() }; return this.snapshot
      }
      if (revision !== this.revision) throw new RouterError('balance_cancelled')
      const read = async (url: string, parse: (value: unknown) => BalanceItem): Promise<BalanceItem> => {
        try {
          const response = await abortable(() => this.transport(url, key!, signal), signal)
          if (response.status === 401) return empty('invalid_key')
          if (response.status === 403) return empty(url === CREDITS_URL ? 'restricted' : 'unavailable')
          if (response.status !== 200) return empty('unavailable')
          return parse(response.value)
        } catch (error) {
          const cause = record(error) && record(error.cause) ? error.cause.code : null
          return empty((signal.aborted && signal.reason?.name === 'TimeoutError') || cause === 'ETIMEDOUT' || cause === 'UND_ERR_CONNECT_TIMEOUT' ? 'timeout' : 'unavailable')
        }
      }
      const [account, keyLimit] = key ? await Promise.all([read(CREDITS_URL, accountBalance), read(KEY_URL, keyBalance)]) : [empty('missing_key'), empty('missing_key')]
      if (revision !== this.revision) throw new RouterError('balance_cancelled')
      this.snapshot = { account, key: keyLimit, checkedAt: this.now() }; return this.snapshot
    })().finally(() => { if (this.pending === request) { this.pending = null; this.controller = null } })
    this.pending = request; return request
  }
}
