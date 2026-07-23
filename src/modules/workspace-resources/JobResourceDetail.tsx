import { useEffect, useState } from 'react'
import { jobIdSchema, type Job, type ValedictorianWorkspaceClient } from '@sparxie/sdk'
import { Spinner } from '@/components/ui/spinner'
import { useMediaQuery } from '@/app/useMediaQuery'
import { ResourceDetailFrame } from './ResourceDetailFrame'

interface JobResourceDetailProps {
  readonly client: Pick<ValedictorianWorkspaceClient, 'jobs'> | null
  readonly jobId: string
  readonly onBack: () => void
}

export function JobResourceDetail({
  client,
  jobId,
  onBack,
}: JobResourceDetailProps) {
  const [selectedJob, setSelectedJob] = useState<{
    readonly jobId: string
    readonly job: Job
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
    void client.jobs.get(parsedJobId.data).then((result) => {
      if (!current) return
      if (!result) setFailure('The requested Job was not found.')
      else setSelectedJob({ jobId, job: result })
    }, (error: unknown) => {
      if (current) setFailure(error instanceof Error ? error.message : 'Job detail could not be loaded.')
    })
    return () => { current = false }
  }, [client, jobId])

  const job = selectedJob?.jobId === jobId ? selectedJob.job : null
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
      {job ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Company</dt>
          <dd>{job.facts.companyName}</dd>
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
