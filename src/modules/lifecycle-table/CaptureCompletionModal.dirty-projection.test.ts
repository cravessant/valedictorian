import { describe, expect, it } from 'vitest'
import {
  persistedCaptureCompletionDraftProjection,
  samePersistedCaptureCompletionDraft,
  type CaptureCompletionCompanySelection,
  type CaptureCompletionPersistedDraft,
} from './CaptureCompletionModal'

function createLocalDraft(
  overrides: Partial<CaptureCompletionPersistedDraft> = {},
): CaptureCompletionPersistedDraft {
  return {
    companyName: 'Example',
    companyDisplayName: 'Example',
    companyMode: 'create_local',
    selectedCompany: null,
    roleTitle: 'Engineer',
    destinationUrl: 'https://jobs.example.com/role',
    ...overrides,
  }
}

function selectedCompanyDraft(): CaptureCompletionPersistedDraft {
  return {
    ...createLocalDraft(),
    companyMode: 'use_local',
    selectedCompany: {
      companyId: 'company-1' as CaptureCompletionCompanySelection['companyId'],
      displayName: 'Example Incorporated',
      revision: 3,
      status: 'active',
    },
  }
}

describe('persistedCaptureCompletionDraftProjection', () => {
  it('uses the exact completion payload normalization for text and create-local Company state', () => {
    const projection = persistedCaptureCompletionDraftProjection(createLocalDraft({
      companyName: ' Example ',
      roleTitle: ' Engineer ',
      companyDisplayName: ' Example Incorporated ',
      destinationUrl: 'https://jobs.example.com/role ',
    }))

    expect(projection).toEqual({
      jobFacts: {
        companyName: 'Example',
        roleTitle: 'Engineer',
        destinationUrl: 'https://jobs.example.com/role ',
      },
      companyAction: { action: 'create_local', companyDisplayName: 'Example Incorporated' },
    })
    expect(samePersistedCaptureCompletionDraft(
      createLocalDraft(),
      createLocalDraft({
        companyName: ' Example ',
        roleTitle: ' Engineer ',
        companyDisplayName: ' Example ',
      }),
    )).toBe(true)
    expect(samePersistedCaptureCompletionDraft(
      createLocalDraft(),
      createLocalDraft({ destinationUrl: 'https://jobs.example.com/role ' }),
    )).toBe(false)
  })

  it('treats selected Company identity, revision, and status as independent persisted changes', () => {
    const initial = selectedCompanyDraft()
    const selectedCompany = initial.selectedCompany!

    expect(samePersistedCaptureCompletionDraft(initial, {
      ...initial,
      selectedCompany: { ...selectedCompany, companyId: 'company-2' as typeof selectedCompany.companyId },
    })).toBe(false)
    expect(samePersistedCaptureCompletionDraft(initial, {
      ...initial,
      selectedCompany: { ...selectedCompany, revision: selectedCompany.revision + 1 },
    })).toBe(false)
    expect(samePersistedCaptureCompletionDraft(initial, {
      ...initial,
      selectedCompany: { ...selectedCompany, status: 'archived' },
    })).toBe(false)
  })

  it('keeps incomplete create-local and use-local actions distinct', () => {
    const incompleteCreateLocal = createLocalDraft({
      companyName: '',
      companyDisplayName: '',
      roleTitle: '',
      destinationUrl: '',
    })
    const incompleteUseLocal: CaptureCompletionPersistedDraft = {
      ...incompleteCreateLocal,
      companyMode: 'use_local',
      selectedCompany: null,
    }

    expect(persistedCaptureCompletionDraftProjection(incompleteCreateLocal)).toEqual({
      jobFacts: { companyName: '', roleTitle: '', destinationUrl: '' },
      companyAction: { action: 'create_local', companyDisplayName: '' },
    })
    expect(persistedCaptureCompletionDraftProjection(incompleteUseLocal)).toEqual({
      jobFacts: { companyName: '', roleTitle: '', destinationUrl: '' },
      companyAction: { action: 'use_local', selectedCompany: null },
    })
    expect(samePersistedCaptureCompletionDraft(incompleteCreateLocal, incompleteUseLocal)).toBe(false)
  })
})
