import { fireEvent, screen } from '@testing-library/react'
import { vi } from 'vitest'
import type { SettingsPreloadApi } from './ipc/settings.preload'
import type { ProfilePreloadApi } from './ipc/profile.preload'
import type {
  ApplicationAttempt,
  ApplicationAttemptsListResult,
  ApplicationDetail,
  ApplicationEvent,
  ApplicationEventsListResult,
  ApplicationLinkRecord,
  ApplicationLinksListResult,
  ApplicationListItem,
  ApplicationListResult,
} from './modules/applications/application.types'
import type { QueueListItem, QueueListResult } from './modules/queue/queue.repository'
import type { ProfileSensitiveDetails } from './modules/profile/profile.repository'
import type { SourcingFinding, SourcingFindingsListResult } from 'sparxie'
import { defaultUserProfile } from 'sparxie'
import {
  defaultAppSettings,
  type AppSettings,
  type AppSettingsPatch,
} from './settings/app-settings'

export function createApplication(
  overrides: Partial<ApplicationListItem> = {},
): ApplicationListItem {
  return {
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
    primaryLink: {
      label: 'official',
      url: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
    },
    notes: 'Needs availability answers.',
    createdAt: '2026-06-04T16:00:00.000Z',
    updatedAt: '2026-06-04T16:00:00.000Z',
    ...overrides,
  }
}

export function createApplicationDetail(
  overrides: Partial<ApplicationDetail> = {},
): ApplicationDetail {
  return {
    ...createApplication(),
    ...overrides,
  }
}

export function createListResult(items: ApplicationListItem[]): ApplicationListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

export function createLinksResult(
  items: ApplicationLinkRecord[] = [
    {
      id: 'link-official',
      applicationId: 'application-1',
      kind: 'official',
      label: 'official',
      url: 'https://jobs.example.test/remediated/f60a3102c158cd7c',
      externalId: null,
      isPrimary: true,
      discoveredAt: '2026-06-04T16:00:00.000Z',
      createdAt: '2026-06-04T16:00:00.000Z',
      updatedAt: '2026-06-04T16:00:00.000Z',
      deletedAt: null,
    },
    {
      id: 'link-source',
      applicationId: 'application-1',
      kind: 'source',
      label: 'source',
      url: 'https://linkedin.com/jobs/astranis',
      externalId: null,
      isPrimary: false,
      discoveredAt: '2026-06-04T16:00:00.000Z',
      createdAt: '2026-06-04T16:00:00.000Z',
      updatedAt: '2026-06-04T16:00:00.000Z',
      deletedAt: null,
    },
  ],
): ApplicationLinksListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

export function createEventsResult(
  items: ApplicationEvent[] = [
    {
      id: 'event-1',
      applicationId: 'application-1',
      type: 'application_created',
      message: 'Application created from sourcing.',
      payloadJson: '{}',
      actor: 'agent:codex',
      createdAt: '2026-06-04T16:00:00.000Z',
    },
  ],
): ApplicationEventsListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

export function createAttemptResult(
  items: ApplicationAttempt[] = [
    {
      id: 'attempt-1',
      applicationId: 'application-1',
      status: 'completed',
      outcome: 'needs_user_info',
      actorType: 'agent',
      actorName: 'codex',
      entryUrl: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
      resumeVariant: 'bachelor_dec_2027',
      resumeArtifactPath: 'tailored_resumes/versant/resume.pdf',
      summary: 'Needs exact availability dates.',
      stopReason: null,
      confirmationUrl: null,
      confirmationText: null,
      startedAt: '2026-06-04T16:00:00.000Z',
      completedAt: '2026-06-04T16:05:00.000Z',
      createdAt: '2026-06-04T16:00:00.000Z',
      updatedAt: '2026-06-04T16:05:00.000Z',
      steps: [
        {
          id: 'step-1',
          attemptId: 'attempt-1',
          applicationId: 'application-1',
          sequence: 1,
          type: 'attempt_started',
          message: 'Started SmartRecruiters application.',
          payloadJson: '{}',
          actor: 'agent:codex',
          createdAt: '2026-06-04T16:00:00.000Z',
        },
        {
          id: 'step-2',
          attemptId: 'attempt-1',
          applicationId: 'application-1',
          sequence: 2,
          type: 'resume_uploaded',
          message: 'Uploaded tailored resume.',
          payloadJson: '{}',
          actor: 'agent:codex',
          createdAt: '2026-06-04T16:02:00.000Z',
        },
      ],
    },
  ],
): ApplicationAttemptsListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

export function createQueueItem(overrides: Partial<QueueListItem> = {}): QueueListItem {
  return {
    id: 'application-versant-platform',
    companyName: 'Versant Media',
    roleTitle: 'Academic Year Internships: Platform Engineering',
    sourceName: 'LinkedIn',
    status: 'queued',
    location: 'Universal City, CA / Remote',
    workMode: 'remote',
    hasApplied: false,
    currentPriorityScore: 6,
    currentPriorityBand: 'medium',
    primaryLink: {
      label: 'official',
      url: 'https://jobs.example.test/remediated/41581ba03bdcb93e',
    },
    createdAt: '2026-06-04T16:00:00.000Z',
    updatedAt: '2026-06-04T16:00:00.000Z',
    bucket: 'apply_now',
    nextAction: 'apply_now',
    reason: 'Queued score 6 meets policy cutoff 6.',
    policyReasons: [{ code: 'meets_policy_cutoff', message: 'Queued score 6 meets policy cutoff 6.' }],
    ...overrides,
  }
}

export function createQueueResult(items: QueueListItem[]): QueueListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
    bucketCounts: {
      apply_now: items.filter((item) => item.bucket === 'apply_now').length,
      manual_review_pickup: items.filter((item) => item.bucket === 'manual_review_pickup').length,
      needs_user_info: items.filter((item) => item.bucket === 'needs_user_info').length,
      stale_lock_recovery: items.filter((item) => item.bucket === 'stale_lock_recovery').length,
      user_review_required: items.filter((item) => item.bucket === 'user_review_required').length,
      blocked: items.filter((item) => item.bucket === 'blocked').length,
      skip_below_cutoff: items.filter((item) => item.bucket === 'skip_below_cutoff').length,
    },
  }
}

export function createSourcingFinding(overrides: Partial<SourcingFinding> = {}): SourcingFinding {
  return {
    id: 'finding-1',
    workflowRunId: 'run-1',
    sourceId: 'source-linkedin',
    sourceName: 'LinkedIn',
    companyName: 'Delta Labs',
    roleTitle: 'Software Engineering Intern',
    roleKind: 'internship',
    term: 'Fall 2026',
    city: null,
    region: null,
    country: 'US',
    workMode: 'remote',
    locationRaw: 'Remote',
    officialUrl: 'https://jobs.example.com/delta',
    sourceUrl: 'https://linkedin.com/jobs/delta',
    postedAge: '2d',
    priorityScore: 7,
    priorityBand: 'high',
    fitNotes: 'Good backend internship fit.',
    duplicateNotes: null,
    blocker: null,
    mergeStatus: 'new',
    mergedApplicationId: null,
    mergedApplicationCompanyName: null,
    mergedApplicationRoleTitle: null,
    mergeNotes: null,
    discoveredAt: '2026-06-04T16:00:00.000Z',
    createdAt: '2026-06-04T16:00:00.000Z',
    updatedAt: '2026-06-04T16:00:00.000Z',
    ...overrides,
  }
}

export function createSourcingResult(items: SourcingFinding[]): SourcingFindingsListResult {
  return {
    items,
    total: items.length,
    limit: 50,
    offset: 0,
    hasMore: false,
  }
}

export async function openSettingsPage() {
  await screen.findByRole('table', { name: 'Applications' })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
}

export function createSettingsApi(overrides: Partial<AppSettings> = {}): SettingsPreloadApi {
  let currentSettings: AppSettings = {
    ...defaultAppSettings,
    ...overrides,
  }

  return {
    get: vi.fn(async () => currentSettings),
    reset: vi.fn(async () => {
      currentSettings = { ...defaultAppSettings }
      return currentSettings
    }),
    update: vi.fn(async (patch: AppSettingsPatch) => {
      currentSettings = {
        ...currentSettings,
        ...patch,
      }

      return currentSettings
    }),
  }
}

export function createProfileApi(): ProfilePreloadApi {
  let currentProfile = { ...defaultUserProfile }
  let currentSensitiveDetails: ProfileSensitiveDetails = {
    birthDay: null,
    birthMonth: null,
    birthYear: null,
    disabilityStatus: null,
    gender: null,
    hispanicLatino: null,
    raceEthnicity: null,
    ssnLast4: null,
    veteranStatus: null,
  }
  let secrets: Array<{
    key: string
    kind: 'password' | 'token' | 'identity' | 'other'
    label: string
    updatedAt: string
    value: string
  }> = []

  return {
    agentContext: {
      get: vi.fn(async () => ({ answers: [], basics: {}, education: [] })),
    },
    get: vi.fn(async () => currentProfile),
    sensitive: {
      get: vi.fn(async () => currentSensitiveDetails),
      update: vi.fn(async (input) => {
        currentSensitiveDetails = {
          ...currentSensitiveDetails,
          ...input,
        }

        return currentSensitiveDetails
      }),
    },
    secrets: {
      delete: vi.fn(async (key: string) => {
        secrets = secrets.filter((secret) => secret.key !== key)
      }),
      list: vi.fn(async () =>
        secrets.map((secret) => ({
          key: secret.key,
          kind: secret.kind,
          label: secret.label,
          updatedAt: secret.updatedAt,
        })),
      ),
      reveal: vi.fn(async (key: string) => {
        const secret = secrets.find((item) => item.key === key)
        return secret ?? null
      }),
      upsert: vi.fn(async (input) => {
        const nextSecret = {
          ...input,
          updatedAt: '2026-06-06T12:00:00.000Z',
        }
        secrets = [...secrets.filter((secret) => secret.key !== input.key), nextSecret]
        return {
          key: nextSecret.key,
          kind: nextSecret.kind,
          label: nextSecret.label,
          updatedAt: nextSecret.updatedAt,
        }
      }),
    },
    update: vi.fn(async (patch) => {
      currentProfile = {
        ...currentProfile,
        ...patch,
        answers: patch.answers ?? currentProfile.answers,
        education: patch.education ?? currentProfile.education,
      }
      return currentProfile
    }),
  }
}
