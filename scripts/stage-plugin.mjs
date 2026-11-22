import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Copy only the audited public surface, never dependencies or local research.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
execFileSync(process.execPath, ['scripts/audit-public.mjs'], { cwd: root, stdio: 'inherit' })
const files = [...new Set(execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean))]
const target = resolve(root, '.orca/plugin')
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
for (const file of files) {
  const destination = resolve(target, file)
  mkdirSync(dirname(destination), { recursive: true })
  cpSync(resolve(root, file), destination)
}
console.log(`Staged ${files.length} audited files in .orca/plugin.`)
