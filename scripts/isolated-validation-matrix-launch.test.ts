import { describe, expect, it } from 'vitest'
import { isolatedValidationMatrixLaunch } from './isolated-validation-matrix-launch'

describe('isolated validation matrix launch', () => {
  it('allocates a virtual display for headless Linux', () => {
    expect(isolatedValidationMatrixLaunch({ platform: 'linux' })).toEqual({
      args: [
        '--auto-servernum',
        '--server-args=-screen 0 1280x1024x24',
        'pnpm',
        'exec',
        'tsx',
        'scripts/isolated-validation.command-matrix.ts',
      ],
      command: 'xvfb-run',
    })
  })

  it('uses the inherited display when Linux already has one', () => {
    expect(isolatedValidationMatrixLaunch({ display: ':99', platform: 'linux' })).toEqual({
      args: ['exec', 'tsx', 'scripts/isolated-validation.command-matrix.ts'],
      command: 'pnpm',
    })
  })
})
