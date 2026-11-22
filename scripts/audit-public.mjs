import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const roots = new Set(['.gitignore', '.gitattributes', 'orca-plugin.json', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.core.json', 'README.md', 'REPORT.md', 'LICENSE', 'SECURITY.md', 'CHANGELOG.md'])
const folders = ['src/', 'test/', 'adapters/', 'scripts/', 'docs/', '.github/', 'assets/']
const patterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bsk-(?:or-v1-)?[A-Za-z0-9_-]{24,}\b/,
  /\bgh[opusr]_[A-Za-z0-9]{24,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{24,}\b/,
  /\/Users\/[A-Za-z0-9_.-]+\//,
  /\/home\/[A-Za-z0-9_.-]+\//
]
let errors = 0
for (const path of [...new Set(files)]) {
  if (!roots.has(path) && !folders.some(prefix => path.startsWith(prefix))) { console.error(`Unexpected public file: ${path}`); errors++; continue }
  if (/\.env(?:\.|$)|connection\.json$|\.jsonl$|(?:^|\/)node_modules\//.test(path)) { console.error(`Private/runtime file: ${path}`); errors++; continue }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.size > 1024 * 1024) { console.error(`Unsupported public entry: ${path}`); errors++; continue }
  if (/\.(?:png|jpg|webp)$/.test(path)) continue
  const text = readFileSync(path, 'utf8')
  if (patterns.some(pattern => pattern.test(text))) { console.error(`Potential private content: ${path}`); errors++ }
}
if (errors) process.exit(1)
console.log(`Public surface checked: ${new Set(files).size} files; no forbidden paths or key patterns.`)
