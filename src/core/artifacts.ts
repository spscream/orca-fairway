import { constants } from 'node:fs'
import { mkdir, open, realpath, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { requireThat } from './config.ts'
import type { Artifacts } from './workflow.ts'
export class PrivateArtifacts implements Artifacts {
  constructor(private root: string) {}
  private directory(id: string): string { requireThat(/^[0-9a-f-]{36}$/.test(id), 'invalid_workflow'); return join(this.root, id) }
  async create(id: string): Promise<string> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    requireThat((await realpath(this.root)) === resolve(this.root), 'artifact_path_refused')
    const info = await lstat(this.root)
    requireThat(info.isDirectory() && (process.platform === 'win32' || (info.mode & 0o077) === 0), 'artifact_path_refused')
    const directory = this.directory(id)
    await mkdir(directory, { mode: 0o700 })
    return join(directory, 'analysis.json')
  }
  private resultName(stepId: string, token: string): string {
    requireThat(/^[a-z][a-z0-9_-]{0,39}$/.test(stepId) && /^[0-9a-f-]{36}$/.test(token), 'invalid_step_result')
    return `result-${stepId}-${token}.json`
  }
  async createResult(id: string, stepId: string, token: string): Promise<string> {
    const directory = this.directory(id)
    requireThat((await realpath(directory)) === resolve(directory), 'artifact_path_refused')
    const path = join(directory, this.resultName(stepId, token))
    try { await lstat(path); throw new Error('result_exists') }
    catch (error) { requireThat((error as NodeJS.ErrnoException).code === 'ENOENT', 'artifact_path_refused') }
    return path
  }
  readResult(id: string, stepId: string, token: string): Promise<string | null> {
    return this.readBounded(id, this.resultName(stepId, token), 8192, 'invalid_step_result')
  }
  read(id: string): Promise<string | null> { return this.readBounded(id, 'analysis.json', 32768, 'invalid_analysis') }
  private async readBounded(id: string, name: string, limit: number, error: string): Promise<string | null> {
    const directory = this.directory(id)
    requireThat((await realpath(directory)) === resolve(directory), 'artifact_path_refused')
    const path = join(directory, name)
    try {
      const stat = await lstat(path); requireThat(stat.isFile() && !stat.isSymbolicLink(), 'artifact_path_refused')
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const info = await file.stat(); requireThat(info.isFile() && info.size <= limit, error)
        const buffer = Buffer.alloc(limit + 1), { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        requireThat(bytesRead <= limit, error); return buffer.subarray(0, bytesRead).toString('utf8')
      } finally { await file.close() }
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  }
}
