import { requireThat } from './config.ts'
/** JSON with duplicate-key and depth rejection; no eval or prototype assignment. */
export function parseJson(text: string): unknown {
  let i = 0
  const ws = () => { while (/[ \t\r\n]/.test(text[i] ?? '') && i < text.length) i++ }
  function string(): string {
    const start = i++; let escaped = false
    for (; i < text.length; i++) {
      const ch = text[i]
      if (!escaped && ch === '"') { i++; return JSON.parse(text.slice(start, i)) as string }
      if (!escaped && ch === '\\') escaped = true; else escaped = false
    }
    throw new Error('invalid_json')
  }
  function value(depth: number): unknown {
    requireThat(depth < 40, 'json_too_deep'); ws()
    const ch = text[i]
    if (ch === '"') return string()
    if (ch === '{') {
      i++; ws(); const result: Record<string, unknown> = Object.create(null); const keys = new Set<string>()
      if (text[i] === '}') { i++; return result }
      for (;;) {
        ws(); requireThat(text[i] === '"', 'invalid_json'); const key = string(); ws()
        requireThat(!keys.has(key), 'duplicate_json_key'); keys.add(key)
        requireThat(text[i++] === ':', 'invalid_json'); const v = value(depth + 1)
        Object.defineProperty(result, key, { value: v, enumerable: true, writable: true, configurable: true }); ws()
        if (text[i] === '}') { i++; return result }
        requireThat(text[i++] === ',', 'invalid_json')
      }
    }
    if (ch === '[') {
      i++; ws(); const result: unknown[] = []
      if (text[i] === ']') { i++; return result }
      for (;;) { result.push(value(depth + 1)); ws(); if (text[i] === ']') { i++; return result }; requireThat(text[i++] === ',', 'invalid_json') }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i))?.[0]
    requireThat(token, 'invalid_json'); i += token.length; return JSON.parse(token)
  }
  const result = value(0); ws(); requireThat(i === text.length, 'invalid_json'); return result
}
