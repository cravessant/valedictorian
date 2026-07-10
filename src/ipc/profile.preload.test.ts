import { describe, expect, it } from 'vitest'
import { createProfilePreloadApi } from './profile.preload'

describe('profile preload API', () => {
  it('invokes profile and secret IPC channels with typed payloads', async () => {
    const invocations: Array<[string, unknown?]> = []
    const api = createProfilePreloadApi({
      async invoke(channel, ...payload) {
        invocations.push(payload.length ? [channel, payload[0]] : [channel])
        return { ok: true }
      },
    } as Parameters<typeof createProfilePreloadApi>[0])

    await api.get()
    await api.update({ fullName: 'Kenny Lin', answers: [] })
    await api.agentContext.get()
    await api.sensitive.get()
    await api.sensitive.update({
      birthDay: '16',
      birthMonth: '03',
      birthYear: '2004',
      ssnLast4: '5125',
    })
    await api.secrets.list()
    await api.secrets.upsert({
      key: 'greenhouse_password',
      kind: 'password',
      label: 'Greenhouse password',
      value: 'secret',
    })
    await api.secrets.delete('greenhouse_password')

    expect(invocations).toEqual([
      ['profile:get'],
      ['profile:update', { fullName: 'Kenny Lin', answers: [] }],
      ['profile:agent-context:get'],
      ['profile:sensitive:get'],
      [
        'profile:sensitive:update',
        {
          birthDay: '16',
          birthMonth: '03',
          birthYear: '2004',
          ssnLast4: '5125',
        },
      ],
      ['profile:secrets:list'],
      [
        'profile:secrets:upsert',
        {
          key: 'greenhouse_password',
          kind: 'password',
          label: 'Greenhouse password',
          value: 'secret',
        },
      ],
      ['profile:secrets:delete', 'greenhouse_password'],
    ])
    expect(Object.keys(api.secrets)).toEqual(['delete', 'list', 'upsert'])
  })
})
