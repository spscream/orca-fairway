import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, symlink, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { NativeRuntime } from '../src/core/runtime.ts'
import { PrivateArtifacts } from '../src/core/artifacts.ts'
import { DEFAULT_CONFIG } from '../src/core/config.ts'
import type { Plan } from '../src/core/types.ts'
const workspace = { id: 'synthetic', path: '/synthetic-project', host: 'local' as const }
const plan = { profile: DEFAULT_CONFIG.profiles[0], dispatch: { kind: 'structured', handle: 'orca_session_id:synthetic-session' } } as Plan
test('structured monitoring matches the exact local session, agent and workspace using safe argv', async () => {
  let state = 'done', hostId = 'local'
  const runtime = new NativeRuntime({ OPENROUTER_TOKEN: 'synthetic-private' }, async (_file, args, options) => {
    assert.deepEqual(args, ['agent', 'show', 'orca_session_id:synthetic-session', '--environment', 'local', '--json'])
    assert.equal(options.cwd, workspace.path); assert.equal(options.timeout, 5000); assert.equal(options.env.OPENROUTER_TOKEN, undefined)
    return { code: 0, stdout: JSON.stringify({ ok: true, result: { orcaSessionId: 'synthetic-session', places: [{ agent: 'codex', hostId, worktreeId: workspace.id, state, lastAssistantMessage: 'private-output-marker' }] } }) }
  })
  assert.equal(await runtime.observe(plan, workspace), 'done')
  state = 'working'; assert.equal(await runtime.observe(plan, workspace), 'working')
  state = 'waiting'; assert.equal(await runtime.observe(plan, workspace), 'blocked')
  hostId = 'other'; assert.equal(await runtime.observe(plan, workspace), 'unknown')
})
test('terminal monitoring accepts only a matching idle wait without a blocked reason', async () => {
  let blockedReason: string | null = null, satisfied = true
  const runtime = new NativeRuntime({}, async (_file, args) => {
    assert.ok(args.includes('tui-idle')); assert.ok(args.includes('1')); assert.ok(!args.includes('read'))
    return { code: 0, stdout: JSON.stringify({ ok: true, result: { wait: { handle: 'term_synthetic', condition: 'tui-idle', satisfied, blockedReason } } }) }
  })
  const terminal = { ...plan, dispatch: { kind: 'terminal', handle: 'term_synthetic' } } as Plan
  assert.equal(await runtime.observe(terminal, workspace), 'done')
  blockedReason = 'permission'; assert.equal(await runtime.observe(terminal, workspace), 'blocked')
  blockedReason = null; satisfied = false; assert.equal(await runtime.observe(terminal, workspace), 'working')
})
test('result artifacts reject traversal, symlinks and oversized files', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'fairway-result-'))), artifacts = new PrivateArtifacts(join(directory, 'private')), id = randomUUID(), token = randomUUID()
  try {
    await artifacts.create(id); const file = await artifacts.createResult(id, 'synthetic', token)
    assert.equal(await artifacts.readResult(id, 'synthetic', token), null)
    await assert.rejects(artifacts.createResult(id, '../outside', token), /invalid_step_result/)
    await writeFile(file, 'x'.repeat(8193)); await assert.rejects(artifacts.readResult(id, 'synthetic', token), /invalid_step_result/)
    await rm(file); await symlink(join(directory, 'outside'), file)
    await assert.rejects(artifacts.readResult(id, 'synthetic', token), /artifact_path_refused/)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
