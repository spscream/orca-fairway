import { t } from './ui-i18n.ts'
import type { Message } from './core/i18n.ts'
export const bytes = (value: string): number => new TextEncoder().encode(value).length
export function displayState(value: string, automatic = false): string {
  if (automatic && value === 'submitted') return t('Waiting for the executor to finish and report checks.')
  const labels: Record<string, Message> = {
    budget_exhausted: 'The JEV allowance cannot cover the remaining steps. Increase the limits in Settings, then continue.',
    missing_key: 'Save an OpenRouter key in Settings.', timeout: 'Request timed out',
    low_confidence_fallback: 'Fallback profile',
    invalid_choice: 'JEV returned an invalid choice. Automatic execution is paused.',
    pricing_unbounded: 'JEV pricing could not be bounded. No decision request was sent.',
    http_error: 'OpenRouter rejected the request or was unavailable. Check the key and service status.',
    shadow: 'Ready for explicit launch', planned: 'Ready for explicit launch', waiting: 'Awaiting selection',
    submitted: 'Sent to Orca; review required', dispatch_pending: 'Dispatch in progress',
    dispatch_unknown: 'Unknown dispatch outcome', dispatch_failed: 'Dispatch failed', cancelled: 'Cancelled', completed: 'Result accepted',
    selected: 'Profile selected', read: 'Source read', unavailable: 'Unavailable',
    offline: 'Uses the fallback profile. No paid requests.'
  }
  return Object.hasOwn(labels, value) ? t(labels[value]!) : `${t('Details')}: ${value}`
}
