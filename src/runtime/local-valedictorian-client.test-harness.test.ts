import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  closeTestLocalValedictorianClient,
  createOwnedTestPgliteDataPath,
  createTestLocalValedictorianClient,
  useResettablePgliteTestLocalValedictorianClient,
} from './local-valedictorian-client.test-harness'

const createResettableLocalClient = useResettablePgliteTestLocalValedictorianClient()
let pgliteDataPathFromPreviousTest: string | undefined

describe.sequential('local Valedictorian client test harness', () => {
  it('gives clients isolated profile stores while they share one resettable database', async () => {
    const first = await createResettableLocalClient()
    const second = await createResettableLocalClient()

    await first.profile.update({
      email: 'first@example.test',
      fullName: 'First Profile',
    })

    await expect(first.profile.get()).resolves.toMatchObject({
      email: 'first@example.test',
      fullName: 'First Profile',
    })
    await expect(second.profile.get()).resolves.toMatchObject({
      email: null,
      fullName: null,
    })
  })

  it('keeps an owned temporary path alive across a caller-controlled restart', async () => {
    const pgliteDataPath = createOwnedTestPgliteDataPath('valedictorian-harness-restart-')
    pgliteDataPathFromPreviousTest = pgliteDataPath
    const before = await createTestLocalValedictorianClient({ pgliteDataPath })

    await before.profile.update({ email: 'restart@example.test', fullName: 'Restart Profile' })
    await closeTestLocalValedictorianClient(before)
    const after = await createTestLocalValedictorianClient({ pgliteDataPath })

    await expect(after.profile.get()).resolves.toMatchObject({
      email: 'restart@example.test',
      fullName: 'Restart Profile',
    })
  })

  it('removes the owned temporary path from the previous test without the test doing so', () => {
    expect(pgliteDataPathFromPreviousTest).toBeDefined()
    expect(fs.existsSync(pgliteDataPathFromPreviousTest as string)).toBe(false)
  })
})
