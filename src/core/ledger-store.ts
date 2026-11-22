import { constants } from 'node:fs'
import { mkdir, lstat, open, realpath, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { requireThat } from './config.ts'
import { parseJson } from './json.ts'
import type { Store } from './types.ts'

/** A ledger shared by local plugin workers, independent of host storage caching. */
export function withDiskLedger(store: Store, directory: string): Store {
  const path = join(directory, 'ledger.json')
  const lock = join(directory, 'ledger.lock')
  const initialized = join(directory, 'ledger.initialized')
  async function prepare(): Promise<void> {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const info = await lstat(directory)
    requireThat(info.isDirectory() && await realpath(directory) === resolve(directory) &&
      (process.platform === 'win32' || (info.mode & 0o077) === 0), 'ledger_path_refused')
  }
  async function write(value: unknown): Promise<void> {
    const temporary = join(dirname(path), 'ledger-' + randomUUID())
    try {
      await writeFile(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600 })
      const file = await open(temporary, 'r+')
      try { await file.sync() } finally { await file.close() }
      await rename(temporary, path)
    } finally { await unlink(temporary).catch(() => {}) }
  }
  return {
    async get(key) {
      if (key !== 'ledger') return store.get(key)
      let file
      try { file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | constants.O_NONBLOCK) }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          const marker = await lstat(initialized).catch((error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') return null
            throw error
          })
          requireThat(!marker && await store.get('diskLedgerInitialized') == null, 'invalid_ledger')
          return store.get(key)
        }
        throw error
      }
      try {
        const info = await file.stat()
        requireThat(info.isFile() && info.nlink === 1 && info.size <= 1024, 'invalid_ledger')
        const buffer = Buffer.alloc(1025)
        const { bytesRead } = await file.read(buffer)
        requireThat(bytesRead <= 1024, 'invalid_ledger')
        return parseJson(buffer.subarray(0, bytesRead).toString('utf8'))
      } finally { await file.close() }
    },
    async set(key, value) {
      if (key !== 'ledger') return store.set(key, value)
      await write(value)
      await writeFile(initialized, '', { flag: 'wx', mode: 0o600 }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error
      })
      if (await store.get('diskLedgerInitialized') !== true) await store.set('diskLedgerInitialized', true)
    },
    async exclusive(action) {
      await prepare()
      const deadline = Date.now() + 2000
      while (true) {
        try { await mkdir(lock, { mode: 0o700 }); break }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
          requireThat(Date.now() < deadline, 'ledger_locked')
          await delay(25)
        }
      }
      try { return await action() }
      finally { await rmdir(lock) }
    },
  }
}
