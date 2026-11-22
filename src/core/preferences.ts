import { requireThat } from './config.ts'
import type { Config } from './types.ts'

export function budgetFromText(text: string): number {
  const normalized = text.trim().replace(',', '.')
  requireThat(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(normalized), 'invalid_budget')
  const [whole, fraction = ''] = normalized.split('.')
  const micros = Number(whole) * 1e6 + Number(fraction.padEnd(6, '0'))
  requireThat(Number.isSafeInteger(micros), 'invalid_budget')
  return micros
}
export function preferences(config: Config): Record<string, boolean | number> {
  return { unlimitedJev: config.unlimitedJev, live: config.live, execution: config.execution, budgetUsd: config.budgetMicrousd / 1e6, maxCalls: config.maxCalls }
}
export function withPreferences(config: Config, settings: Record<string, unknown>): Config {
  const value = (key: string, fallback: unknown) => settings[key] === undefined ? fallback : settings[key]
  const usd = value('budgetUsd', config.budgetMicrousd / 1e6)
  requireThat(typeof usd === 'number' && Number.isFinite(usd), 'invalid_budget')
  return {
    ...config,
    live: value('live', config.live) as boolean,
    unlimitedJev: value('unlimitedJev', config.unlimitedJev) as boolean,
    execution: value('execution', config.execution) as boolean,
    budgetMicrousd: budgetFromText(String(usd)),
    maxCalls: value('maxCalls', config.maxCalls) as number
  }
}
