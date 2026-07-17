import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import { defaultSecretsRunSpawn } from './valedictorian-cli.secrets-run-spawn.js'

function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

describe('defaultSecretsRunSpawn real adapter', () => {
  it('delivers env, stdin, and fd 3 without putting canaries in argv', async () => {
    const envCanary = 'default-spawn-env-canary'
    const stdinCanary = 'default-spawn-stdin-canary'
    const fdCanary = 'default-spawn-fd-canary'
    const envHash = sha256Hex(envCanary)
    const stdinHash = sha256Hex(stdinCanary)
    const fdHash = sha256Hex(fdCanary)

    const childSource = [
      "const { createHash } = require('node:crypto');",
      "const fs = require('node:fs');",
      "const sha = (value) => createHash('sha256').update(value, 'utf8').digest('hex');",
      `const expected = { env: '${envHash}', stdin: '${stdinHash}', fd: '${fdHash}' };`,
      "let stdin = '';",
      "process.stdin.setEncoding('utf8');",
      "process.stdin.on('data', (chunk) => { stdin += chunk; });",
      'process.stdin.on("end", () => {',
      '  let fdValue = "";',
      '  try { fdValue = fs.readFileSync(3, "utf8"); } catch {}',
      '  const ok =',
      '    sha(process.env.SECRET_TOKEN || "") === expected.env &&',
      '    sha(stdin) === expected.stdin &&',
      '    sha(fdValue) === expected.fd;',
      '  process.exit(ok ? 0 : 2);',
      '});',
    ].join('')

    const result = await defaultSecretsRunSpawn({
      executable: process.execPath,
      argv: ['-e', childSource],
      env: { ...process.env, SECRET_TOKEN: envCanary },
      shell: false,
      stdin: { value: stdinCanary },
      fdValues: new Map([[3, fdCanary]]),
    })

    expect(result.exitCode).toBe(0)
    expect(childSource).not.toContain(envCanary)
    expect(childSource).not.toContain(stdinCanary)
    expect(childSource).not.toContain(fdCanary)
  })

  it('propagates a nonzero child exit code', async () => {
    const result = await defaultSecretsRunSpawn({
      executable: process.execPath,
      argv: ['-e', 'process.exit(7)'],
      env: { ...process.env },
      shell: false,
      stdin: 'ignore',
      fdValues: new Map(),
    })

    expect(result.exitCode).toBe(7)
  })

  it('fails when the executable is definitely missing', async () => {
    await expect(
      defaultSecretsRunSpawn({
        executable: '/definitely/missing/valedictorian-secrets-run-bin',
        argv: [],
        env: { ...process.env },
        shell: false,
        stdin: 'ignore',
        fdValues: new Map(),
      }),
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
