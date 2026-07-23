import { Archive, Building2, Pencil, Plus, RotateCcw, StickyNote, Trash2 } from 'lucide-react'
import type { CompanyAssignedJobPage, CompanyDetail } from '@sparxie/sdk'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

export function CompanyDetailView({
  assignedJobs,
  detail,
  onAddAlias,
  onArchive,
  onEditAlias,
  onEditIdentity,
  onEditNotes,
  onOpenCompany,
  onOpenJob,
  onRemoveAlias,
  onRestore,
}: {
  readonly assignedJobs: CompanyAssignedJobPage
  readonly detail: CompanyDetail
  readonly onAddAlias: () => void
  readonly onArchive: () => void
  readonly onEditAlias: (alias: CompanyDetail['lookup']['requested']['aliases'][number]) => void
  readonly onEditIdentity: () => void
  readonly onEditNotes: () => void
  readonly onOpenCompany: (companyId: string) => void
  readonly onOpenJob: (jobId: string) => void
  readonly onRemoveAlias: (alias: CompanyDetail['lookup']['requested']['aliases'][number]) => void
  readonly onRestore: () => void
}) {
  const company = detail.lookup.requested
  const identityReadOnly = company.status === 'merged'
  return (
    <div className="space-y-6 text-sm">
      <section
        className="rounded-md border border-border border-l-4 border-l-primary/70 bg-card/70 p-4"
        aria-label="Company identity status"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <Badge variant="outline" className="capitalize">{company.status}</Badge>
            {company.websiteUrl ? (
              <a
                className="mt-2 block text-sm text-primary underline-offset-4 hover:underline"
                href={company.websiteUrl}
                target="_blank"
                rel="noreferrer"
              >
                {company.websiteUrl}
              </a>
            ) : <p className="mt-2 text-muted-foreground">No website recorded</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {!identityReadOnly ? (
              <Button type="button" variant="outline" size="sm" onClick={onEditIdentity}>
                <Pencil className="size-4" aria-hidden="true" />
                Edit identity
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={onEditNotes}>
              <StickyNote className="size-4" aria-hidden="true" />
              Edit notes
            </Button>
            {company.status === 'active' ? (
              <Button type="button" variant="outline" size="sm" onClick={onArchive}>
                <Archive className="size-4" aria-hidden="true" />
                Archive
              </Button>
            ) : company.status === 'archived' ? (
              <Button type="button" variant="outline" size="sm" onClick={onRestore}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Restore
              </Button>
            ) : null}
          </div>
        </div>
        {company.status === 'merged' ? (
          <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
            <Building2 className="size-4 text-muted-foreground" aria-hidden="true" />
            <span className="text-muted-foreground">Canonical Company</span>
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => onOpenCompany(detail.lookup.canonical.id)}
            >
              {detail.lookup.canonical.displayName}
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-3" aria-labelledby="company-notes-heading">
        <h3 id="company-notes-heading" className="font-semibold">Notes</h3>
        {company.notes ? (
          <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3">
            {company.notes}
          </p>
        ) : <p className="text-muted-foreground">No notes yet.</p>}
      </section>

      <section className="space-y-3" aria-labelledby="company-aliases-heading">
        <div className="flex items-center justify-between gap-3">
          <h3 id="company-aliases-heading" className="font-semibold">Aliases</h3>
          {!identityReadOnly ? (
            <Button type="button" variant="outline" size="sm" onClick={onAddAlias}>
              <Plus className="size-4" aria-hidden="true" />
              Add alias
            </Button>
          ) : null}
        </div>
        {company.aliases.length === 0 ? (
          <p className="text-muted-foreground">No aliases recorded.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {company.aliases.map((alias) => (
              <li key={alias.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span>{alias.value}</span>
                {!identityReadOnly ? (
                  <span className="flex gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit alias ${alias.value}`}
                      onClick={() => onEditAlias(alias)}
                    >
                      <Pencil className="size-4" aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove alias ${alias.value}`}
                      onClick={() => onRemoveAlias(alias)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </Button>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="company-jobs-heading">
        <div className="flex items-center justify-between gap-3">
          <h3 id="company-jobs-heading" className="font-semibold">Assigned Jobs</h3>
          <span className="text-xs text-muted-foreground">{detail.assignedJobCount} total</span>
        </div>
        {assignedJobs.items.length === 0 ? (
          <p className="text-muted-foreground">No Jobs are assigned to this Company.</p>
        ) : (
          <ul className="space-y-2">
            {assignedJobs.items.map((job) => (
              <li key={job.jobId}>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto justify-start p-0 text-left"
                  onClick={() => onOpenJob(job.jobId)}
                >
                  {job.roleTitle}
                </Button>
                {job.namesDiffer ? (
                  <span className="ml-2 text-xs text-muted-foreground">
                    Posting: {job.jobFactsCompanyName}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
