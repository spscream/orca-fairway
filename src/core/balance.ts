import { record, requireThat, RouterError } from './config.ts'
import { requestJson, type JsonRequest } from './http.ts'
export const CREDITS_URL = 'https://openrouter.ai/api/v1/credits'
export const KEY_URL = 'https://openrouter.ai/api/v1/key'
export type BalanceState = 'available' | 'unlimited' | 'restricted' | 'unavailable' | 'missing_key' | 'invalid_key' | 'timeout'
export interface BalanceItem { state: BalanceState; remainingUsd: number | null }
export interface BalanceSnapshot { account: BalanceItem; key: BalanceItem; checkedAt: number; stale?: boolean }
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
export function createBalanceTransport(http: JsonRequest = requestJson): BalanceTransport {
  return async (url, key, signal) => {
    requireThat(url === CREDITS_URL || url === KEY_URL, 'endpoint_refused')
    return http(url, { key, signal, maxBytes: 16384 })
  }
}
export const balanceTransport = createBalanceTransport()
export class Balances {
  private snapshot: BalanceSnapshot | null = null
  private lastAttemptAt: number | null = null
  private pending: Promise<BalanceSnapshot> | null = null
  private controller: AbortController | null = null
  private revision = 0
  constructor(private getKey: () => Promise<string | null>, private transport: BalanceTransport = balanceTransport, private timeoutMs = 8000, private now = Date.now) {}
  cached(): BalanceSnapshot | null { return this.snapshot }
  invalidate(): void { this.revision++; this.snapshot = null; this.lastAttemptAt = null; this.pending = null; this.controller?.abort(); this.controller = null }
  private record(account: BalanceItem, key: BalanceItem): BalanceSnapshot {
    const previous = this.snapshot
    const transient = (item: BalanceItem) => item.state === 'unavailable' || item.state === 'timeout'
    const keepAccount = transient(account) && previous?.account.state === 'available'
    const keepKey = transient(key) && (previous?.key.state === 'available' || previous?.key.state === 'unlimited')
    this.lastAttemptAt = this.now()
    this.snapshot = {
      account: keepAccount ? previous!.account : account,
      key: keepKey ? previous!.key : key,
      checkedAt: (keepAccount || keepKey) && previous ? previous.checkedAt : this.lastAttemptAt,
      ...(keepAccount || keepKey ? { stale: true } : {}),
    }
    return this.snapshot
  }
  refresh(): Promise<BalanceSnapshot> {
    if (this.pending) return this.pending
    if (this.snapshot && this.lastAttemptAt !== null) {
      const age = this.now() - this.lastAttemptAt
      if (age >= 0 && age < 30000) return Promise.resolve(this.snapshot)
    }
    const revision = this.revision, controller = new AbortController(); this.controller = controller
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(this.timeoutMs)])
    const request = (async () => {
      let key: string | null
      try { key = await abortable(() => this.getKey(), signal) }
      catch {
        if (revision !== this.revision) throw new RouterError('balance_cancelled')
        const state = signal.reason?.name === 'TimeoutError' ? 'timeout' : 'unavailable'
        return this.record(empty(state), empty(state))
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
          return empty((signal.aborted && signal.reason?.name === 'TimeoutError') || cause === 'ETIMEDOUT' || cause === 'UND_ERR_CONNECT_TIMEOUT' || (error instanceof RouterError && error.code === 'request_timeout') ? 'timeout' : 'unavailable')
        }
      }
      const [account, keyLimit] = key ? await Promise.all([read(CREDITS_URL, accountBalance), read(KEY_URL, keyBalance)]) : [empty('missing_key'), empty('missing_key')]
      if (revision !== this.revision) throw new RouterError('balance_cancelled')
      return this.record(account, keyLimit)
    })().finally(() => { if (this.pending === request) { this.pending = null; this.controller = null } })
    this.pending = request; return request
  }
}
