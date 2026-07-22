import { describe, expect, it } from 'vitest'

import {
  DESKTOP_USER_ACTOR,
  __resetLifecycleActorCounterForTests,
  newIdempotencyKey,
} from './lifecycle-actor'

describe('lifecycle-actor', () => {
  it('exposes a stable desktop user actor with type user and stable id', () => {
    expect(DESKTOP_USER_ACTOR.type).toBe('user')
    expect(DESKTOP_USER_ACTOR.id).toBe('valedictorian-desktop-user')
    expect(DESKTOP_USER_ACTOR.displayName).toBe('Desktop user')
    expect(Object.isFrozen(DESKTOP_USER_ACTOR)).toBe(true)
  })

  it('produces unique idempotency keys that share the desktop prefix', () => {
    __resetLifecycleActorCounterForTests()
    const a = newIdempotencyKey()
    const b = newIdempotencyKey()
    expect(a).not.toBe(b)
    expect(a.startsWith('desktop-1-')).toBe(true)
    expect(b.startsWith('desktop-2-')).toBe(true)
  })

  it('honors an explicit prefix for keyed surface isolation', () => {
    __resetLifecycleActorCounterForTests()
    expect(newIdempotencyKey('capture').startsWith('capture-1-')).toBe(true)
  })
})