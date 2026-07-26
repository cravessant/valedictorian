import { useEffect, useState } from 'react'
import {
  jobIdSchema,
  type Job,
  type JobCompanyAssignmentPresentation,
  type ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import { scopedLoadFailure } from '@/app/app-load-failure'
import { Spinner } from '@/components/ui/spinner'
import { useMediaQuery } from '@/app/useMediaQuery'
import { ResourceDetailFrame } from './ResourceDetailFrame'
import { JobCompanyCell } from './JobCompanyCell'

const jobDetailFailure = 'Job detail could not be loaded.'

interface JobResourceDetailProps {
  readonly client: Pick<ValedictorianWorkspaceClient, 'jobs' | 'companyAssignments'> | null
  readonly jobId: string
  readonly onBack: () => void
  readonly onOpenCompany?: (companyId: string) => void
}

export function JobResourceDetail({
  client,
  jobId,
  onBack,
  onOpenCompany,
}: JobResourceDetailProps) {
  const [selectedJob, setSelectedJob] = useState<{
    readonly jobId: string
    readonly job: Job
    readonly assignment: JobCompanyAssignmentPresentation
  } | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const isNarrow = useMediaQuery('(max-width: 767px)')

  useEffect(() => {
    let current = true
    setSelectedJob(null)
    setFailure(null)
    if (!client) {
      setFailure('Workspace Job data is unavailable.')
      return
    }
    const parsedJobId = jobIdSchema.safeParse(jobId)
    if (!parsedJobId.success) {
      setFailure('The requested Job address is invalid.')
      return
    }
    void Promise.all([
      client.jobs.get(parsedJobId.data),
      client.companyAssignments.get(parsedJobId.data),
    ]).then(([result, assignment]) => {
      if (!current) return
      if (!result) setFailure('The requested Job was not found.')
      else setSelectedJob({ jobId, job: result, assignment })
    }, (error: unknown) => {
      if (current) setFailure(scopedLoadFailure(error, jobDetailFailure, false)?.message ?? jobDetailFailure)
    })
    return () => { current = false }
  }, [client, jobId])

  const job = selectedJob?.jobId === jobId ? selectedJob.job : null
  const assignment = selectedJob?.jobId === jobId ? selectedJob.assignment : null
  return (
    <ResourceDetailFrame
      backLabel="Back to Jobs"
      heading={job?.facts.roleTitle ?? 'Job'}
      headingId="job-detail-heading"
      isNarrow={isNarrow}
      onBack={onBack}
    >
      {!job && !failure ? <Spinner aria-label="Loading Job detail" /> : null}
      {failure ? <p role="alert" className="text-sm text-destructive">{failure}</p> : null}
      {job && assignment ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Company</dt>
          <dd>
            <JobCompanyCell
              assignment={assignment}
              onOpenCompany={onOpenCompany}
            />
          </dd>
          <dt className="text-muted-foreground">Source</dt>
          <dd>{job.facts.sourceName}</dd>
          <dt className="text-muted-foreground">Availability</dt>
          <dd>{job.availability.state}</dd>
          <dt className="text-muted-foreground">Job ID</dt>
          <dd className="break-all font-mono text-xs">{job.id}</dd>
        </dl>
      ) : null}
    </ResourceDetailFrame>
  )
}
