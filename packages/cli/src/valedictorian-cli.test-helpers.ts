import fs from 'node:fs'
import path from 'node:path'
import { runValedictorianCli } from './valedictorian-cli'

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...init,
  })
}

export function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    bin?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    files?: string[]
    name?: string
  }
}

export async function runCli(
  argv: string[],
  env: Record<string, string | undefined> = {},
  options: { cwd?: string } = {},
) {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCode = await runValedictorianCli({
    argv,
    env: {
      VALEDICTORIAN_API_URL: 'https://valedictorian.test',
      ...env,
    },
    cwd: options.cwd,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
  })

  return {
    exitCode,
    stderr: stderr.join(''),
    stdout: stdout.join(''),
  }
}
