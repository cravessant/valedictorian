import { describe, expect, it } from 'vitest'
import { useResettablePgliteTestLocalValedictorianClient } from './local-valedictorian-client.test-harness'

const createResettableLocalClient = useResettablePgliteTestLocalValedictorianClient()

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
})
