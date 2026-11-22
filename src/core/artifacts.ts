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
  async read(id: string): Promise<string | null> {
    const directory = this.directory(id)
    requireThat((await realpath(directory)) === resolve(directory), 'artifact_path_refused')
    const path = join(directory, 'analysis.json')
    try {
      const stat = await lstat(path); requireThat(stat.isFile() && !stat.isSymbolicLink(), 'artifact_path_refused')
      const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      try {
        const info = await file.stat(); requireThat(info.isFile() && info.size <= 32768, 'invalid_analysis')
        const buffer = Buffer.alloc(32769), { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
        requireThat(bytesRead <= 32768, 'invalid_analysis'); return buffer.subarray(0, bytesRead).toString('utf8')
      } finally { await file.close() }
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e }
  }
}
