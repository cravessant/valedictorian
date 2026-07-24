import { describe, expect, it } from 'vitest'
import { cliUiDevProofLaunch } from './cli-ui-dev-proof-launch'

describe('CLI/UI development proof launch', () => {
  it('uses Xvfb for the direct lifecycle owner on headless Linux', () => {
    expect(cliUiDevProofLaunch({
      nodeExecutable: '/runtime/node',
      platform: 'linux',
    })).toEqual({
      args: [
        '--auto-servernum',
        '--server-args=-screen 0 1280x1024x24',
        '/runtime/node',
        '--import',
        'tsx',
        'scripts/run-isolated-validation.ts',
        '--proof-dev',
        '--timeout-ms',
        '120000',
      ],
      command: 'xvfb-run',
    })
  })

  it('invokes the lifecycle owner without PATH lookup when a display exists', () => {
    expect(cliUiDevProofLaunch({
      display: ':99',
      nodeExecutable: '/runtime/node',
      platform: 'linux',
    })).toEqual({
      args: [
        '--import',
        'tsx',
        'scripts/run-isolated-validation.ts',
        '--proof-dev',
        '--timeout-ms',
        '120000',
      ],
      command: '/runtime/node',
    })
  })
})
