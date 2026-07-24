import { spawn } from 'node:child_process'

const role = process.argv[2]

if (role === 'startup-failure') {
  process.exitCode = 1
} else if (role === 'electron') {
  process.stdout.write(`electron:${process.pid}\n`)
  setInterval(() => undefined, 1_000)
} else if (role === 'vite') {
  const electron = spawn(process.execPath, [process.argv[1], 'electron'], { stdio: 'inherit' })
  process.stdout.write(`vite:${process.pid}:electron:${electron.pid}\n`)
  if (process.argv[3] === 'child-failure') setTimeout(() => process.exit(1), 100)
  setInterval(() => undefined, 1_000)
} else {
  throw new Error(`Unknown isolated validation fixture role: ${String(role)}`)
}
