import type { CaptureListPresentation } from '@sparxie/sdk'

type JobId = NonNullable<CaptureListPresentation['linkedJob']>['jobId']

/** The reported failure case, shared by the component coverage and the geometry probe. */
export const captureContainmentRoleTitle = 'Software Engineering Intern I, Summer 2027'
export const captureContainmentCompanyName = 'BAE Systems, Inc.'
export const captureContainmentLinkedJobLabel =
  `${captureContainmentRoleTitle} · ${captureContainmentCompanyName}`
export const captureContainmentDestinationHost =
  'careers-eu-west-1.internal-applicant-tracking.baesystems-example.com'

export const captureContainmentRows: readonly CaptureListPresentation[] = [
  {
    captureId: 'capture-long-linked-job',
    captureRevision: 1,
    observedAt: '2026-07-24T15:42:00.000Z',
    lead: {
      roleTitle: captureContainmentRoleTitle,
      companyName: captureContainmentCompanyName,
      fallbackLabel: captureContainmentLinkedJobLabel,
    },
    source: { displayName: 'Jobright', provider: 'jobright' },
    destination: { state: 'resolved', displayHost: captureContainmentDestinationHost },
    readiness: 'ready',
    processingSummary: 'promoted',
    activeProcessing: false,
    linkedJob: {
      jobId: 'job-long-linked' as JobId,
      roleTitle: captureContainmentRoleTitle,
      companyName: captureContainmentCompanyName,
    },
    primaryIntent: { kind: 'view_job', jobId: 'job-long-linked' as JobId },
  },
  {
    captureId: 'capture-needs-information',
    captureRevision: 1,
    observedAt: '2026-07-24T15:41:00.000Z',
    lead: {
      roleTitle: 'Software Engineering Intern II, Summer 2027 (Autonomy and Controls)',
      companyName: 'Northrop Grumman Space Systems',
      fallbackLabel: 'Northrop Grumman lead',
    },
    source: { displayName: 'Jobright', provider: 'jobright' },
    destination: { state: 'blocked', displayHost: null },
    readiness: 'ready',
    processingSummary: 'awaiting_information',
    activeProcessing: false,
    linkedJob: null,
    primaryIntent: { kind: 'complete_job_information' },
  },
  {
    captureId: 'capture-unexplained-destination',
    captureRevision: 1,
    observedAt: '2026-07-24T15:40:00.000Z',
    lead: {
      roleTitle: 'Embedded Software Engineering Intern, Mission Systems',
      companyName: 'L3Harris Technologies',
      fallbackLabel: 'L3Harris lead',
    },
    source: { displayName: 'Jobright', provider: 'jobright' },
    destination: { state: 'blocked', displayHost: null },
    readiness: 'ready',
    processingSummary: 'blocked',
    activeProcessing: false,
    linkedJob: null,
    primaryIntent: null,
  },
]
