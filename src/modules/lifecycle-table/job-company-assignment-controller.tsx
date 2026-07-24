import { useState, type ReactElement } from 'react'
import type {
  Job,
  JobCompanyAssignmentPresentation,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
import type { LifecycleRowAction } from './lifecycle-table'
import { JobCompanyReassignmentModal } from '@/modules/workspace-resources/JobCompanyReassignmentModal'

export function useJobCompanyAssignmentController({
  assignments,
  client,
  refresh,
  workspaceId,
}: {
  readonly assignments: ReadonlyMap<string, JobCompanyAssignmentPresentation>
  readonly client: ValedictorianWorkspaceClient | null
  readonly refresh: () => Promise<void> | void
  readonly workspaceId: string | null
}): {
  readonly action: LifecycleRowAction<Job>
  readonly modalLayer: ReactElement | null
} {
  const [target, setTarget] = useState<JobCompanyAssignmentPresentation | null>(null)
  const action: LifecycleRowAction<Job> = {
    key: 'reassign-company',
    label: 'Reassign Company',
    modal: true,
    disabled: (job) => Boolean(job.removedAt) || !assignments.has(job.id),
    onActivate: (job) => {
      const assignment = assignments.get(job.id)
      if (assignment) setTarget(assignment)
    },
  }
  return {
    action,
    modalLayer: target && client && workspaceId ? (
      <JobCompanyReassignmentModal
        key={`${target.jobId}:${target.assignmentRevision}`}
        assignment={target}
        client={client}
        workspaceId={workspaceId}
        onChanged={refresh}
        onClose={() => setTarget(null)}
      />
    ) : null,
  }
}
