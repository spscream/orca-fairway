import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Readable, Writable } from 'node:stream'
import type { ClientRequest, IncomingMessage } from 'node:http'
import { createJsonRequest, type Requester } from '../src/core/http.ts'
import { createHttpTransport, DECISIONS_URL, METADATA_URL } from '../src/core/jev.ts'
const URL = 'https://openrouter.ai/api/v1/key'
function fixture(chunks: string[] = ['{"data":{}}'], status = 200) {
  const calls: { url: string; options: Parameters<Requester>[1]; body: string }[] = []
  let response: IncomingMessage | undefined
  const send: Requester = (url, options, callback) => {
    const call = { url, options, body: '' }; calls.push(call)
    const req = new Writable({ write(chunk, _encoding, done) { call.body += chunk.toString(); done() } })
    req.on('finish', () => {
      response = Object.assign(Readable.from(chunks.map(c => Buffer.from(c))), { statusCode: status }) as IncomingMessage
      callback(response)
    })
    return req as ClientRequest
  }
  return { http: createJsonRequest(send), calls, response: () => response }
}
test('OpenRouter HTTPS transport fixes IPv4 locally and preserves TLS, fixed endpoints and bounded JSON', async () => {
  const f = fixture()
  assert.equal(JSON.stringify(await f.http(URL, { key: 'synthetic-secret', signal: new AbortController().signal, maxBytes: 16384 })), '{"status":200,"value":{"data":{}}}')
  const c = f.calls[0]!
  assert.equal(c.options.family, 4); assert.equal(c.options.autoSelectFamily, false)
  assert.equal(c.options.agent, false); assert.equal(c.options.rejectUnauthorized, true); assert.equal(c.options.method, 'GET')
  assert.equal((c.options.headers as Record<string, string>).Authorization, 'Bearer synthetic-secret')
  assert.equal(c.body, ''); assert.equal(f.calls.length, 1)
})
test('redirects and failed responses never follow another URL or retain secret-bearing bodies', async () => {
  for (const status of [301, 302, 307, 401, 403, 429, 500]) {
    const f = fixture(['private-response-marker'], status)
    const result = await f.http(URL, { signal: new AbortController().signal, maxBytes: 16384 })
    assert.deepEqual(result, { status }); assert.equal(f.calls.length, 1); assert.equal(f.response()?.destroyed, true)
  }
})
test('unapproved endpoints, method changes, injected headers and oversized bodies never reach HTTPS', async () => {
  const f = fixture(), options = { signal: new AbortController().signal, maxBytes: 16384 }
  for (const url of ['https://example.invalid', 'https://openrouter.ai@evil.invalid/api/v1/key', URL + '?extra=1']) await assert.rejects(f.http(url, options), /endpoint_refused/)
  await assert.rejects(f.http(URL, { ...options, body: '{}' }), /endpoint_refused/)
  await assert.rejects(f.http(URL, { ...options, key: 'synthetic\r\nInjected: yes' }), /invalid_key/)
  await assert.rejects(f.http(DECISIONS_URL, { ...options, body: 'x'.repeat(16385) }), /request_too_large/)
  await assert.rejects(f.http(URL, { ...options, maxBytes: 65537 }), /invalid_response_limit/)
  assert.equal(f.calls.length, 0)
})
test('stream size and malformed or duplicate JSON fail without retaining raw response details', async () => {
  for (const [chunks, error] of [[['x'.repeat(17)], 'response_too_large'], [['bad-json'], 'invalid_response'], [['{"a":1,"a":2}'], 'invalid_response']] as const) {
    const f = fixture([...chunks])
    await assert.rejects(f.http(URL, { signal: new AbortController().signal, maxBytes: 16 }), new RegExp(error))
    assert.equal(f.response()?.destroyed, true); assert.equal(f.calls.length, 1)
  }
})
test('abort destroys a stalled connection and never retries or leaks transport errors', async () => {
  let calls = 0, req: Writable | undefined
  const http = createJsonRequest(() => { calls++; req = new Writable(); return req as ClientRequest })
  const hold = setInterval(() => {}, 1000)
  try {
    await assert.rejects(http(URL, { signal: AbortSignal.timeout(10), maxBytes: 16384 }), /request_timeout/)
    assert.equal(req?.destroyed, true); assert.equal(calls, 1)
  } finally { clearInterval(hold) }
  const failed = createJsonRequest(() => { throw new Error('private-transport-marker') })
  await assert.rejects(failed(URL, { signal: new AbortController().signal, maxBytes: 16384 }), /http_unavailable/)
})
test('abort before send prevents network; premature response termination rejects', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort()
  await assert.rejects(f.http(URL, { signal: controller.signal, maxBytes: 16384 })); assert.equal(f.calls.length, 0)
  const http = createJsonRequest((_url, _options, callback) => {
    const req = new Writable({ write(_chunk, _encoding, done) { done() } })
    req.on('finish', () => {
      const incoming = Object.assign(new Readable({ read() {} }), { statusCode: 200 }) as IncomingMessage
      callback(incoming); incoming.emit('aborted')
    })
    return req as ClientRequest
  })
  await assert.rejects(http(URL, { signal: new AbortController().signal, maxBytes: 16384 }), /http_unavailable/)
})
test('JEV adapter keeps metadata GET and decision POST separate and never retries a paid request', async () => {
  const f = fixture(['{"synthetic":true}']), transport = createHttpTransport(f.http), signal = new AbortController().signal
  await transport(METADATA_URL, { signal }); await transport(DECISIONS_URL, { key: 'synthetic', body: '{"synthetic":true}', signal })
  assert.equal(f.calls.length, 2); assert.equal(f.calls[0]!.options.method, 'GET'); assert.equal(f.calls[1]!.options.method, 'POST')
  assert.equal(f.calls[1]!.body, '{"synthetic":true}')
  const fail = fixture(['private-response-marker'], 500)
  await assert.rejects(createHttpTransport(fail.http)(DECISIONS_URL, { key: 'synthetic', body: '{}', signal }), /http_error/)
  assert.equal(fail.calls.length, 1)
})
