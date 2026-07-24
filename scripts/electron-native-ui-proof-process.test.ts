import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { installElectronNativeUiProofSignalForwarding } from './electron-native-ui-proof-process'

describe.skipIf(process.platform === 'win32')('Electron native UI proof process ownership', () => {
  it('forwards directed cancellation to the proof group and lets it remove temporary state', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'electron-proof-signal-test-'))
    const marker = path.join(root, 'ready')
    const child = spawn(process.execPath, ['-e', cleanupChildSource(), root, marker], {
      detached: true,
      stdio: 'ignore',
    })
    const signals = signalSource((processId, signal) => process.kill(processId, signal))
    const forwarding = installElectronNativeUiProofSignalForwarding(child, signals)
    try {
      await waitFor(() => fs.existsSync(marker))
      signals.emit('SIGTERM')
      await once(child, 'close')
      expect(forwarding.error()).toBeUndefined()
      expect(fs.existsSync(root)).toBe(false)
    } finally {
      forwarding.stop()
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
        } catch {
          // The expected cleanup path already reaped the group.
        }
      }
      fs.rmSync(root, { force: true, recursive: true })
    }
  })

  it('keeps forwarding repeated signals until the proof group closes', () => {
    const forwarded: { processId: number, signal: string }[] = []
    const signals = signalSource((processId, signal) => {
      forwarded.push({ processId, signal })
      return true
    })
    const forwarding = installElectronNativeUiProofSignalForwarding({
      kill: () => true,
      pid: 42,
    }, signals)
    try {
      signals.emit('SIGTERM')
      signals.emit('SIGTERM')
      expect(forwarded).toEqual([
        { processId: -42, signal: 'SIGTERM' },
        { processId: -42, signal: 'SIGTERM' },
      ])
    } finally {
      forwarding.stop()
    }
  })
})

describe('Electron native UI proof Windows signal ownership', () => {
  it('signals the direct lifecycle-owner process without relying on group semantics', () => {
    const forwarded: string[] = []
    const signals = signalSource(() => {
      throw new Error('Windows forwarding must not use POSIX process groups.')
    }, 'win32')
    const forwarding = installElectronNativeUiProofSignalForwarding({
      kill(signal) {
        forwarded.push(String(signal))
        return true
      },
      pid: 42,
    }, signals)
    try {
      signals.emit('SIGTERM')
      expect(forwarded).toEqual(['SIGTERM'])
      expect(forwarding.error()).toBeUndefined()
    } finally {
      forwarding.stop()
    }
  })
})

function signalSource(
  kill: (processId: number, signal: 'SIGINT' | 'SIGTERM') => boolean,
  platform: NodeJS.Platform = process.platform,
) {
  const signals = new EventEmitter() as EventEmitter & {
    readonly platform: NodeJS.Platform
    kill(processId: number, signal: 'SIGINT' | 'SIGTERM'): boolean
  }
  Object.defineProperty(signals, 'platform', { value: platform })
  signals.kill = kill
  return signals
}

function cleanupChildSource() {
  return `
    const fs = require('node:fs');
    const [root, marker] = process.argv.slice(1);
    fs.writeFileSync(marker, 'ready');
    const cleanup = () => {
      fs.rmSync(root, { force: true, recursive: true });
      process.exit(1);
    };
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
    setInterval(() => {}, 1000);
  `
}

async function waitFor(predicate: () => boolean) {
  const deadline = Date.now() + 5_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the cancellation fixture.')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}
