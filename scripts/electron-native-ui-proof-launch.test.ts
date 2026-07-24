import { describe, expect, it } from 'vitest'
import { electronNativeUiProofLaunch } from './electron-native-ui-proof-launch'

describe('Electron native UI proof launch', () => {
  it('uses an isolated virtual display only for headless Linux proof sessions', () => {
    expect(electronNativeUiProofLaunch({ nodeExecutable: '/runtime/node', platform: 'linux' })).toEqual({
      args: [
        '--auto-servernum',
        '--server-args=-screen 0 1280x1024x24',
        '/runtime/node',
        '--import',
        'tsx',
        'scripts/run-isolated-validation.ts',
        '--proof-electron',
        '--timeout-ms',
        '120000',
      ],
      command: 'xvfb-run',
    })
  })

  it('runs the lifecycle owner directly when a display already exists', () => {
    expect(electronNativeUiProofLaunch({
      display: ':99',
      nodeExecutable: 'C:\\runtime\\node.exe',
      platform: 'win32',
    })).toEqual({
      args: [
        '--import',
        'tsx',
        'scripts/run-isolated-validation.ts',
        '--proof-electron',
        '--timeout-ms',
        '120000',
      ],
      command: 'C:\\runtime\\node.exe',
    })
  })
})
