import { describe, expect, it } from 'vitest'
import type { ProfileStore } from '@sparxie/valedictorian-local-runtime/profile-files'

export function defineProfileStoreContract(createStore: () => { store: ProfileStore }) {
  describe('ProfileStore contract', () => {
    it('reads a versioned document and updates atomically with expected revision', async () => {
      const { store } = createStore()
      const initial = await store.get()
      expect(initial.schemaVersion).toBe(1)
      expect(initial.revision).toEqual(expect.any(String))

      const updated = await store.update({
        expectedRevision: initial.revision,
        profile: {
          ...initial.profile,
          email: 'kenny@example.com',
          fullName: 'Kenny Lin',
        },
      })
      expect(updated.ok).toBe(true)
      if (!updated.ok) return

      expect(updated.document.profile.email).toBe('kenny@example.com')
      expect(updated.document.revision).not.toBe(initial.revision)

      const conflict = await store.update({
        expectedRevision: initial.revision,
        profile: {
          ...initial.profile,
          email: 'other@example.com',
        },
      })
      expect(conflict).toEqual({
        ok: false,
        code: 'profile_revision_conflict',
        document: expect.objectContaining({
          profile: expect.objectContaining({ email: 'kenny@example.com' }),
        }),
      })
    })
  })
}
