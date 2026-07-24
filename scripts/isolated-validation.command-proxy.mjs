import { spawn } from 'node:child_process'

const command = spawn('pnpm', ['run', 'validate:isolated', '--', ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

command.stdout.pipe(process.stdout)
command.stderr.pipe(process.stderr)
command.once('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})
