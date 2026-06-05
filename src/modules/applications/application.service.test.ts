import { describe, expect, it } from 'vitest'
import { createApplicationService } from './application.service'
import type { ApplicationRepository } from './application.types'

describe('application service', () => {
  it('lists applications through the configured repository', async () => {
    const repository: ApplicationRepository = {
      async listApplications() {
        return [
          {
            id: 'application-1',
            companyName: 'Astranis Space Technologies',
            roleTitle: 'Software Engineer- Backend Intern (Fall 2026)',
            sourceName: 'LinkedIn',
            status: 'needs_user_info',
            term: 'Fall 2026 internship',
            location: 'San Francisco, CA / Onsite',
            workMode: 'onsite',
            hasApplied: false,
            currentPriorityScore: 8,
            currentPriorityBand: 'high',
            primaryLink: null,
            notes: null,
          },
        ]
      },
    }

    const service = createApplicationService(repository)

    await expect(service.listApplications()).resolves.toHaveLength(1)
  })
})
