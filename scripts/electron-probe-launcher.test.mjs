import { describe, expect, it } from 'vitest'
import { electronProbeCommand } from './electron-probe-launcher.mjs'

describe('Electron layout probe command', () => {
  it('wraps a headless Linux probe in a virtual display wide enough to measure 1440px', () => {
    expect(electronProbeCommand('/runtime/electron', 'scripts/probe.mjs', {
      display: undefined,
      platform: 'linux',
    })).toEqual({
      args: [
        '--auto-servernum',
        '--server-args=-screen 0 1920x1080x24',
        '/runtime/electron',
        'scripts/probe.mjs',
      ],
      command: 'xvfb-run',
    })
  })

  it('runs the probe directly when a display server already exists', () => {
    for (const environment of [
      { display: ':99', platform: 'linux' },
      { display: undefined, platform: 'darwin' },
    ]) {
      expect(electronProbeCommand('/runtime/electron', 'scripts/probe.mjs', environment)).toEqual({
        args: ['scripts/probe.mjs'],
        command: '/runtime/electron',
      })
    }
  })
})
