export function knownErrorCode(error: unknown, known: ReadonlySet<string>): string | null {
  if (!error || typeof error !== 'object') return null
  const e = error as Record<string, unknown>
  const field = (value: unknown, key: string): unknown => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
  const candidates = [e.requestCode, field(e.data, 'requestCode'), field(e.details, 'requestCode'), e.code, field(e.cause, 'code'), e.message]
  for (const candidate of candidates) if (typeof candidate === 'string' && known.has(candidate)) return candidate
  // Some host versions wrap the fixed worker code in a sentence. Never show that sentence.
  if (typeof e.message === 'string') for (const code of known) {
    if (new RegExp(`(?:^|[^a-zA-Z0-9_])${code}(?:$|[^a-zA-Z0-9_])`).test(e.message)) return code
  }
  return null
}
