import { execFile } from 'node:child_process'
import { open } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { record, requireThat, RouterError, validateProfile } from './config.ts'
import { parseJson } from './json.ts'
import type { CommandResult, Evidence, Profile, Runtime, Workspace, Plan } from './types.ts'
export type Runner = (file: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv; timeout: number; maxBuffer?: number }) => Promise<CommandResult>
export const runFile: Runner = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, args, { ...options, shell: false, windowsHide: true, maxBuffer: options.maxBuffer ?? 512 * 1024 }, (error, stdout) => {
    if (error) reject(new RouterError(error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'command_output_too_large' : 'command_unavailable'))
    else resolve({ code: 0, stdout })
  })
})
export function childEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = /^(PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|APPDATA|LOCALAPPDATA|USERPROFILE|PROGRAMFILES(?:\(X86\))?|XDG_(?:CONFIG|DATA|CACHE|STATE|RUNTIME)_HOME|XDG_RUNTIME_DIR|CODEX_HOME|ORCA_CLI_COMMAND|ORCA_DEV_REPO_ROOT)$/i
  return Object.fromEntries(Object.entries(env).filter(([name]) => allowed.test(name)))
}
export function orcaExecutable(env: NodeJS.ProcessEnv, platform = process.platform): string {
  return env.ORCA_CLI_COMMAND || (env.ORCA_DEV_REPO_ROOT ? 'orca-dev' : platform === 'linux' ? 'orca-ide' : 'orca')
}
export function launchArgs(profile: Profile, task: string, workspace: Workspace): string[] {
  const args = ['agent', 'launch', '--environment', 'local', '--agent', profile.agent, '--worktree', 'path:' + workspace.path, '--model', profile.model]
  if (profile.effort !== null) args.push('--effort', profile.effort)
  args.push('--prompt', 'Task submitted through Fairway for Orca:\n' + task, '--json')
  return args
}
export function codexMetadataHome(metadata: unknown, env: NodeJS.ProcessEnv, platform = process.platform, home = homedir()): string {
  requireThat(record(metadata) && metadata.ok === true && record(metadata.result), 'codex_account_metadata_unavailable')
  const data = metadata.result, byRuntime = data.activeAccountIdsByRuntime
  const active = record(byRuntime) && Object.hasOwn(byRuntime, 'host') ? byRuntime.host : data.activeAccountId
  if (active === null || active === 'system') return env.CODEX_HOME || join(home, '.codex')
  requireThat(typeof active === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(active), 'codex_account_metadata_unavailable')
  const appData = platform === 'darwin' ? join(home, 'Library', 'Application Support') : platform === 'win32' ? env.APPDATA || join(home, 'AppData', 'Roaming') : env.XDG_CONFIG_HOME || join(home, '.config')
  return join(appData, 'orca', 'codex-accounts', active, 'home')
}
function codexPair(catalog: unknown, profile: Profile): boolean {
  requireThat(record(catalog) && Array.isArray(catalog.models) && catalog.models.length <= 512, 'invalid_codex_catalog')
  const matches = catalog.models.filter((x: unknown) => record(x) && x.slug === profile.model)
  requireThat(matches.length <= 1, 'invalid_codex_catalog')
  const model = matches[0]
  return record(model) && model.visibility === 'list' && Array.isArray(model.supported_reasoning_levels) &&
    (profile.effort === null || model.supported_reasoning_levels.some((x: unknown) => record(x) && x.effort === profile.effort))
}
async function readModelCatalog(path: string): Promise<string> {
  const limit = 2 * 1024 * 1024
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK)
  try {
    const stat = await file.stat()
    requireThat(stat.isFile() && stat.size <= limit, 'invalid_codex_catalog')
    const buffer = Buffer.alloc(limit + 1)
    const { bytesRead } = await file.read(buffer)
    requireThat(bytesRead <= limit, 'invalid_codex_catalog')
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
  } finally { await file.close() }
}
export class NativeRuntime implements Runtime {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly run: Runner = runFile,
    private readonly read: (path: string) => Promise<string> = readModelCatalog) {}
  async verify(profile: Profile): Promise<Evidence> {
    if (profile.agent === 'pi') return { verified: profile.operatorConfirmed, source: profile.operatorConfirmed ? 'operator_confirmed_pi_pair' : 'pi_pair_requires_confirmation' }
    if (profile.agent === 'cursor') {
      const result = await this.run('cursor-agent', ['--list-models'], { env: childEnvironment(this.env), timeout: 10_000 })
      const aliases = result.stdout.split('\n').map(l => /^([a-zA-Z0-9._-]+) - /.exec(l.trim())?.[1]).filter(Boolean)
      return { verified: aliases.includes(profile.model), source: 'cursor_native_catalog' }
    }
    // Read only the catalog embedded in this exact binary: no refresh, network or agent session.
    // Older clients may lack this command; only command failure permits the strict cache fallback.
    let bundled: CommandResult | null = null
    try {
      const result = await this.run('codex', ['debug', 'models', '--bundled'], { env: childEnvironment(this.env), timeout: 10_000, maxBuffer: 2 * 1024 * 1024 })
      if (result.code === 0) bundled = result
    } catch (error) {
      if (error instanceof RouterError && error.code === 'command_output_too_large') throw error
      // Compatibility fallback below never relaxes cache verification.
    }
    if (bundled) {
      requireThat(Buffer.byteLength(bundled.stdout, 'utf8') <= 2 * 1024 * 1024, 'invalid_codex_catalog')
      return { verified: codexPair(parseJson(bundled.stdout), profile), source: 'codex_bundled_catalog' }
    }
    // Orca launches its selected managed account, not necessarily the system Codex home.
    const accounts = await this.run(orcaExecutable(this.env), ['account', 'list', '--agent', 'codex', '--json'], { env: childEnvironment(this.env), timeout: 5000 })
    const path = join(codexMetadataHome(JSON.parse(accounts.stdout), this.env), 'models_cache.json')
    const raw = await this.read(path)
    requireThat(Buffer.byteLength(raw) <= 2 * 1024 * 1024, 'invalid_codex_catalog')
    const cache = parseJson(raw)
    requireThat(record(cache) && Array.isArray(cache.models), 'invalid_codex_catalog')
    const fetched = typeof cache.fetched_at === 'string' ? Date.parse(cache.fetched_at) : NaN
    if (!Number.isFinite(fetched) || fetched > Date.now() + 60_000 || Date.now() - fetched > 7 * 86400_000) return { verified: false, source: 'stale_codex_catalog' }
    const version = await this.run('codex', ['--version'], { env: childEnvironment(this.env), timeout: 5000 })
    const actual = /codex-cli\s+([^\s]+)/.exec(version.stdout)?.[1]
    if (!actual || cache.client_version !== actual) return { verified: false, source: 'codex_catalog_version_mismatch' }
    return { verified: codexPair(cache, profile), source: 'codex_version_matched_catalog' }
  }
  async observe(plan: Plan, workspace: Workspace): Promise<'working' | 'done' | 'blocked' | 'unknown'> {
    const dispatch = plan.dispatch
    if (!dispatch || workspace.host !== 'local') return 'unknown'
    requireThat(/^[a-zA-Z0-9_:./-]{1,256}$/.test(dispatch.handle), 'invalid_plan')
    const options = { cwd: workspace.path, env: childEnvironment(this.env), timeout: 5000 }
    try {
      if (dispatch.kind === 'terminal') {
        const response = await this.run(orcaExecutable(this.env), ['terminal', 'wait', '--terminal', dispatch.handle, '--for', 'tui-idle', '--timeout-ms', '1', '--environment', 'local', '--json'], options)
        const value = parseJson(response.stdout)
        if (!record(value) || value.ok !== true || !record(value.result) || !record(value.result.wait)) return 'unknown'
        const wait = value.result.wait
        if (wait.handle !== dispatch.handle || wait.condition !== 'tui-idle') return 'unknown'
        if (wait.blockedReason) return 'blocked'
        return wait.satisfied === true ? 'done' : wait.satisfied === false ? 'working' : 'unknown'
      }
      const id = dispatch.sessionId || dispatch.handle.replace(/^orca_session_id:/, '')
      if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) return 'unknown'
      const response = await this.run(orcaExecutable(this.env), ['agent', 'show', 'orca_session_id:' + id, '--environment', 'local', '--json'], options)
      const value = parseJson(response.stdout)
      if (!record(value) || value.ok !== true || !record(value.result) || value.result.orcaSessionId !== id || !Array.isArray(value.result.places)) return 'unknown'
      const places = value.result.places.filter((p: unknown) => record(p) && p.agent === plan.profile.agent && p.hostId === 'local' && (p.worktreeId === workspace.id || (typeof p.worktreeId === 'string' && p.worktreeId.endsWith('::' + workspace.path))))
      if (places.length !== 1 || !record(places[0])) return 'unknown'
      return places[0].state === 'done' ? 'done' : places[0].state === 'working' ? 'working' : ['blocked', 'waiting'].includes(String(places[0].state)) ? 'blocked' : 'unknown'
    } catch { return 'unknown' }
  }
  async launch(profile: Profile, task: string, workspace: Workspace): Promise<CommandResult> {
    validateProfile(profile)
    requireThat(workspace.host === 'local' && isAbsolute(workspace.path), 'invalid_workspace')
    return this.run(orcaExecutable(this.env), launchArgs(profile, task, workspace), { cwd: workspace.path, env: childEnvironment(this.env), timeout: 30_000 })
  }
}
