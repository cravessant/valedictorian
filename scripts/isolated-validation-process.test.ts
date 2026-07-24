import { spawn } from 'node:child_process'
import { once } from 'node:events'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProcessTreeShutdown, waitForProcessGroupExit } from './supervised-launch'

const fixturePath = path.resolve('scripts/isolated-validation-process.fixture.mjs')

describe.skipIf(process.platform === 'win32')('supervised process helper fixture', () => {
  it.each([
    ['normal close', 'terminate'],
    ['SIGINT', 'SIGINT'],
    ['SIGTERM', 'SIGTERM'],
    ['timeout', 'terminate'],
  ] as const)('removes the fixture process group after %s', async (_name, action) => {
    const vite = await startViteFixture()
    if (action === 'terminate') {
      const shutdown = createProcessTreeShutdown({ forceAfterMs: 100, processId: vite.pid! })
      shutdown.begin()
      await once(vite, 'close')
      shutdown.leaderExited()
      await shutdown.waitForExit()
      await expect(waitForProcessGroupExit(vite.pid!, { attempts: 30, intervalMs: 50 }))
        .resolves.toBeUndefined()
    } else {
      process.kill(-vite.pid!, action)
      await waitForProcessGroupExit(vite.pid!, { attempts: 30, intervalMs: 50 })
    }
  })

  it('removes a fixture child after its fixture leader fails', async () => {
    const vite = await startViteFixture('child-failure')
    await once(vite, 'exit')
    const shutdown = createProcessTreeShutdown({ forceAfterMs: 100, processId: vite.pid! })
    shutdown.begin()
    shutdown.leaderExited()
    await expect(shutdown.waitForExit()).resolves.toBe(true)
  })

  it('leaves no fixture group behind after a startup failure', async () => {
    const vite = spawn(process.execPath, [fixturePath, 'startup-failure'], { detached: true })
    await once(vite, 'exit')
    await expect(waitForProcessGroupExit(vite.pid!, { attempts: 10, intervalMs: 20 })).resolves.toBeUndefined()
  })
})

async function startViteFixture(mode?: 'child-failure') {
  const vite = spawn(process.execPath, [fixturePath, 'vite', ...(mode ? [mode] : [])], {
    detached: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const [output] = await once(vite.stdout!, 'data')
  expect(String(output)).toContain(`vite:${vite.pid}:electron:`)
  return vite
}
