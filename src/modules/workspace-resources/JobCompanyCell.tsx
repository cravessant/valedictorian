import type { JobCompanyAssignmentPresentation } from '@sparxie/sdk'
import { Button } from '@/components/ui/button'

export function JobCompanyCell({
  assignment,
  onOpenCompany,
}: {
  readonly assignment: JobCompanyAssignmentPresentation
  readonly onOpenCompany?: (companyId: string) => void
}) {
  const company = assignment.workspaceCompany
  return (
    <div className="min-w-0">
      {onOpenCompany ? (
        <Button
          type="button"
          variant="link"
          className="h-auto max-w-full justify-start p-0 text-left"
          onClick={() => onOpenCompany(company.companyId)}
        >
          {company.displayName}
        </Button>
      ) : <span>{company.displayName}</span>}
      {assignment.namesDiffer ? (
        <span className="block text-xs text-muted-foreground">
          Posting says: {assignment.jobFactsCompanyName}
        </span>
      ) : null}
    </div>
  )
}
