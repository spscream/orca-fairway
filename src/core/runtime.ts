import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { record, requireThat, RouterError, validateProfile } from './config.ts'
import type { CommandResult, Evidence, Profile, Runtime, Workspace } from './types.ts'
export type Runner = (file: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv; timeout: number }) => Promise<CommandResult>
export const runFile: Runner = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, args, { ...options, shell: false, windowsHide: true, maxBuffer: 512 * 1024 }, (error, stdout) => {
    if (error) reject(new RouterError('command_unavailable'))
    else resolve({ code: 0, stdout })
  })
})
export function childEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !['OPENROUTER_API_KEY', 'OPENROUTER_TOKEN', 'FAIRWAY_BRIDGE_TOKEN'].includes(k)))
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
export class NativeRuntime implements Runtime {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env, private readonly run: Runner = runFile,
    private readonly read: (path: string) => Promise<string> = p => readFile(p, 'utf8')) {}
  async verify(profile: Profile): Promise<Evidence> {
    if (profile.agent === 'pi') return { verified: profile.operatorConfirmed, source: profile.operatorConfirmed ? 'operator_confirmed_pi_pair' : 'pi_pair_requires_confirmation' }
    if (profile.agent === 'cursor') {
      const result = await this.run('cursor-agent', ['--list-models'], { env: childEnvironment(this.env), timeout: 10_000 })
      const aliases = result.stdout.split('\n').map(l => /^([a-zA-Z0-9._-]+) - /.exec(l.trim())?.[1]).filter(Boolean)
      return { verified: aliases.includes(profile.model), source: 'cursor_native_catalog' }
    }
    // Orca launches its selected managed account, not necessarily the system Codex home.
    const accounts = await this.run(orcaExecutable(this.env), ['account', 'list', '--agent', 'codex', '--json'], { env: childEnvironment(this.env), timeout: 5000 })
    const path = join(codexMetadataHome(JSON.parse(accounts.stdout), this.env), 'models_cache.json')
    const cache: unknown = JSON.parse(await this.read(path))
    requireThat(record(cache) && Array.isArray(cache.models), 'invalid_codex_catalog')
    const fetched = typeof cache.fetched_at === 'string' ? Date.parse(cache.fetched_at) : NaN
    if (!Number.isFinite(fetched) || fetched > Date.now() + 60_000 || Date.now() - fetched > 7 * 86400_000) return { verified: false, source: 'stale_codex_catalog' }
    const version = await this.run('codex', ['--version'], { env: childEnvironment(this.env), timeout: 5000 })
    const actual = /codex-cli\s+([^\s]+)/.exec(version.stdout)?.[1]
    if (!actual || cache.client_version !== actual) return { verified: false, source: 'codex_catalog_version_mismatch' }
    const model = cache.models.find((x: unknown) => record(x) && x.slug === profile.model && x.visibility === 'list')
    const ok = record(model) && Array.isArray(model.supported_reasoning_levels) && (profile.effort === null || model.supported_reasoning_levels.some((x: unknown) => record(x) && x.effort === profile.effort))
    return { verified: !!ok, source: 'codex_version_matched_catalog' }
  }
  async launch(profile: Profile, task: string, workspace: Workspace): Promise<CommandResult> {
    validateProfile(profile)
    requireThat(workspace.host === 'local' && isAbsolute(workspace.path), 'invalid_workspace')
    return this.run(orcaExecutable(this.env), launchArgs(profile, task, workspace), { cwd: workspace.path, env: childEnvironment(this.env), timeout: 30_000 })
  }
}
