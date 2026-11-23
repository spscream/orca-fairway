import { constants } from 'node:fs'
import { mkdir, open, realpath, lstat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { requireThat } from './config.ts'
import type { Artifacts } from './workflow.ts'
export class PrivateArtifacts implements Artifacts {
  constructor(private root: string) {}
  private base(workspace?: string): string {
    if (workspace === undefined) return this.root
    requireThat(isAbsolute(workspace) && !workspace.includes('\0'), 'artifact_path_refused')
    return join(workspace, '.orca', 'fairway-workflows')
  }
  private directory(id: string, workspace?: string): string {
    requireThat(/^[0-9a-f-]{36}$/.test(id), 'invalid_workflow')
    return join(this.base(workspace), id)
  }
  private async checkDirectory(path: string, privateMode = true) {
    const info = await lstat(path)
    requireThat(info.isDirectory() && await realpath(path) === resolve(path) &&
      (!privateMode || process.platform === 'win32' || (info.mode & 0o077) === 0), 'artifact_path_refused')
    return info
  }
  analysisPath(id: string, workspace?: string): string { return join(this.directory(id, workspace), 'analysis.json') }
  resultPath(id: string, stepId: string, token: string, workspace?: string): string { return join(this.directory(id, workspace), this.resultName(stepId, token)) }
  async create(id: string, workspace?: string): Promise<string> {
    const directory = this.directory(id, workspace), base = this.base(workspace)
    if (workspace !== undefined) {
      await this.checkDirectory(workspace, false)
      const orca = join(workspace, '.orca')
      await mkdir(orca, { recursive: true, mode: 0o700 })
      await this.checkDirectory(orca, false)
    }
    await mkdir(base, { recursive: true, mode: 0o700 })
    await this.checkDirectory(base)
    if (workspace !== undefined) {
      try { await writeFile(join(base, '.gitignore'), '*\n', { flag: 'wx', mode: 0o600 }) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    }
    await mkdir(directory, { mode: 0o700 })
    return this.analysisPath(id, workspace)
  }
  private resultName(stepId: string, token: string): string {
    requireThat(/^[a-z][a-z0-9_-]{0,39}$/.test(stepId) && /^[0-9a-f-]{36}$/.test(token), 'invalid_step_result')
    return `result-${stepId}-${token}.json`
  }
  async createResult(id: string, stepId: string, token: string, workspace?: string): Promise<string> {
    const directory = this.directory(id, workspace)
    await this.checkDirectory(this.base(workspace))
    await this.checkDirectory(directory)
    const path = this.resultPath(id, stepId, token, workspace)
    try { await lstat(path); throw new Error('result_exists') }
    catch (error) { requireThat((error as NodeJS.ErrnoException).code === 'ENOENT', 'artifact_path_refused') }
    return path
  }
  readResult(id: string, stepId: string, token: string, workspace?: string): Promise<string | null> {
    return this.readBounded(id, this.resultName(stepId, token), 8192, 'invalid_step_result', workspace)
  }
  read(id: string, workspace?: string): Promise<string | null> { return this.readBounded(id, 'analysis.json', 32768, 'invalid_analysis', workspace) }
  private async readBounded(id: string, name: string, limit: number, error: string, workspace?: string): Promise<string | null> {
    const directory = this.directory(id, workspace)
    await this.checkDirectory(this.base(workspace))
    const parent = await this.checkDirectory(directory)
    const path = join(directory, name)
    try {
      const stat = await lstat(path); requireThat(stat.isFile() && !stat.isSymbolicLink(), 'artifact_path_refused')
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK)
      try {
        const info = await file.stat(); requireThat(info.isFile() && info.nlink === 1 && info.dev === stat.dev && info.ino === stat.ino && info.size <= limit, error)
        const buffer = Buffer.alloc(limit + 1)
        let bytesRead = 0
        while (bytesRead < buffer.length) {
          const chunk = await file.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead)
          if (chunk.bytesRead === 0) break
          bytesRead += chunk.bytesRead
        }
        const after = await file.stat()
        const current = await this.checkDirectory(directory)
        requireThat(bytesRead === info.size && after.size === info.size && after.mtimeMs === info.mtimeMs &&
          after.ctimeMs === info.ctimeMs && after.nlink === 1 && current.dev === parent.dev && current.ino === parent.ino, error)
        try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead)) }
        catch { requireThat(false, error) }
      } finally { await file.close() }
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  }
}
