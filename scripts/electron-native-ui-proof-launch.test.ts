import { describe, expect, it } from 'vitest'
import { electronNativeUiProofLaunch } from './electron-native-ui-proof-launch'

describe('Electron native UI proof launch', () => {
  it('uses an isolated virtual display only for headless Linux proof sessions', () => {
    expect(electronNativeUiProofLaunch({ nodeExecutable: '/runtime/node', platform: 'linux' })).toEqual({
      args: [
        '--auto-servernum',
        '--server-args=-screen 0 1920x1080x24',
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

  it('launches the Capture completion layout proof through the same isolated lifecycle', () => {
    expect(electronNativeUiProofLaunch({
      nodeExecutable: '/runtime/node',
      platform: 'darwin',
      proof: 'capture-completion-layout',
    })).toEqual({
      args: [
        '--import',
        'tsx',
        'scripts/run-isolated-validation.ts',
        '--proof-electron-layout',
        '--timeout-ms',
        '120000',
      ],
      command: '/runtime/node',
    })
  })

  it('launches the shared dialog close-target proof through the isolated lifecycle', () => {
    expect(electronNativeUiProofLaunch({
      nodeExecutable: '/runtime/node',
      platform: 'darwin',
      proof: 'dialog-close-target',
    })).toEqual({
      args: [
        '--import',
        'tsx',
        'scripts/run-isolated-validation.ts',
        '--proof-electron-close-target',
        '--timeout-ms',
        '120000',
      ],
      command: '/runtime/node',
    })
  })
})
