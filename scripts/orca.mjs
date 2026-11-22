import { spawnSync } from 'node:child_process'
const executable = process.env.ORCA_CLI_COMMAND || (process.env.ORCA_DEV_REPO_ROOT ? 'orca-dev' : process.platform === 'linux' ? 'orca-ide' : 'orca')
const result = spawnSync(executable, process.argv.slice(2), { stdio: 'inherit', shell: false })
if (result.error) { process.stderr.write('Orca CLI unavailable. Set ORCA_CLI_COMMAND to its executable path.\n') }
process.exit(result.status ?? 1)
