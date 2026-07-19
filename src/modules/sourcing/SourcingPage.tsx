import { useEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Pagination,
  PaginationNext,
  PaginationPrevious,
} from '@/components/ui/pagination'
import { ExternalLinkButton } from '@/components/ExternalLinkButton'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { LoadFailureView } from '@/components/ui/load-failure-view'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Combobox } from '@/components/ui/combobox'
import { Field, FieldLabel } from '@/components/ui/field'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { typography, typographyClass } from '@/components/ui/typography'
import { fieldControlId } from '@/lib/field-control-id'
import { Ban, Pencil, Search } from 'lucide-react'
import {
  sourcingMergeStatuses,
  sourcingDestinationClasses,
  sourcingUsabilities,
  type CreateSourcingFindingInput,
  type SetSourcingFindingDecisionInput,
  type SourcingFinding,
  type SourcingFindingsListResult,
  type SourcingMergeStatus,
  type SourcingDestinationClass,
  type SourcingUsability,
  type UpdateSourcingFindingInput
} from 'sparxie'
import { formatSourcingLocation } from '../../app/format'
import { formatEnumLabel } from '../../app/labels'
import type { ErrorPresentation } from '../../app/error-presentation'
import type { ApplicationDetailSeed } from '../../app/types'

import { SourcingFindingDispositionModal } from './SourcingFindingDispositionModal'
import { SourcingFindingEditorModal } from './SourcingFindingEditorModal'
import {
  destinationClassLabel,
  usabilityLabel,
  formatSourcingTiming,
  getSourcingDecision,
  formatMergedApplicationLabel,
} from './SourcingFindingPresentation'
import { sourcingFindingToApplication } from './SourcingFindingPromotion'

interface SourcingPageProps {
  contentColumnClass: string
  error: ErrorPresentation | null
  focusedFindingId: string | null
  isLoading: boolean
  mergeStatus: SourcingMergeStatus | undefined
  destinationClass: SourcingDestinationClass | undefined
  promotingFindingIds: ReadonlySet<string>
  result: SourcingFindingsListResult
  showDebugData: boolean
  sourceId: string
  usability: SourcingUsability | undefined
  onCreateFinding: (input: CreateSourcingFindingInput) => Promise<SourcingFinding>
  onDecideFinding: (input: SetSourcingFindingDecisionInput) => Promise<SourcingFinding>
  onMergeStatusChange: (mergeStatus: SourcingMergeStatus | undefined) => void
  onDestinationClassChange: (destinationClass: SourcingDestinationClass | undefined) => void
  onOpenApplication: (application: ApplicationDetailSeed) => void
  onPreviousPage: () => void
  onNextPage: () => void
  onPromoteFinding: (findingId: string) => void
  onSourceChange: (sourceId: string) => void
  onUsabilityChange: (usability: SourcingUsability | undefined) => void
  onUpdateFinding: (input: UpdateSourcingFindingInput) => Promise<SourcingFinding>
  onRetry?: () => void
}

function SourcingPage({
  contentColumnClass,
  error,
  focusedFindingId,
  isLoading,
  mergeStatus,
  destinationClass,
  promotingFindingIds,
  result,
  showDebugData,
  sourceId,
  usability,
  onCreateFinding,
  onDecideFinding,
  onMergeStatusChange,
  onDestinationClassChange,
  onOpenApplication,
  onPreviousPage,
  onNextPage,
  onPromoteFinding,
  onSourceChange,
  onUsabilityChange,
  onUpdateFinding,
  onRetry,
}: SourcingPageProps) {
  const [addingFinding, setAddingFinding] = useState(false)
  const [editingFinding, setEditingFinding] = useState<SourcingFinding | null>(null)
  const [decidingFinding, setDecidingFinding] = useState<SourcingFinding | null>(null)
  const pageStart = result.total === 0 ? 0 : result.offset + 1
  const pageEnd = Math.min(result.offset + result.items.length, result.total)
  const showResultTable = result.items.length > 0
  const sourceOptions = Array.from(
    new Map(result.items.map((item) => [item.sourceId, item.sourceName])).entries(),
  ).map(([sourceId, sourceName]) => ({ sourceId, sourceName }))

  return (
    <main className={`flex h-full min-w-0 flex-col overflow-hidden px-4 py-5 text-foreground md:h-[calc(100vh-3rem)] sm:px-6 lg:px-8 ${contentColumnClass}`}>
      <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-4">
        <header className="flex flex-col gap-4 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className={typography.pageEyebrow}>
              Job automation
            </p>
            <h1 className={typographyClass('pageTitle', 'mt-1')}>
              Opportunities
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="w-fit border border-border bg-card">
              {result.total} opportunities
            </Badge>
            <Button type="button" onClick={() => setAddingFinding(true)}>
              Add opportunity
            </Button>
          </div>
        </header>

        <section aria-label="Opportunity filters" className="rounded-md border border-border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div className="grid gap-1 text-xs font-medium text-muted-foreground">
              Review
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mergeStatus === 'new' ? 'default' : 'outline'}
                  onClick={() => onMergeStatusChange('new')}
                >
                  Review new
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mergeStatus === 'blocked' ? 'default' : 'outline'}
                  onClick={() => onMergeStatusChange('blocked')}
                >
                  Review blocked
                </Button>
              </div>
            </div>
            <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
              <FieldLabel
                className="text-xs font-medium text-muted-foreground"
                htmlFor={fieldControlId('sourcing-filter', 'Source')}
              >
                Source
              </FieldLabel>
              <Combobox
                emptyText="No source found."
                id={fieldControlId('sourcing-filter', 'Source')}
                options={[
                  { label: 'Any source', value: '' },
                  ...sourceOptions.map((sourceOption) => ({
                    label: sourceOption.sourceName,
                    value: sourceOption.sourceId,
                  })),
                ]}
                placeholder="Any source"
                searchPlaceholder="Search source..."
                value={sourceId}
                onValueChange={onSourceChange}
              />
            </Field>
            <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
              <FieldLabel
                className="text-xs font-medium text-muted-foreground"
                htmlFor={fieldControlId('sourcing-filter', 'Destination class')}
              >
                Destination class
              </FieldLabel>
              <NativeSelect
                id={fieldControlId('sourcing-filter', 'Destination class')}
                value={destinationClass ?? ''}
                onChange={(event) => onDestinationClassChange(
                  event.target.value
                    ? event.target.value as SourcingDestinationClass
                    : undefined,
                )}
              >
                <NativeSelectOption value="">Any destination</NativeSelectOption>
                {sourcingDestinationClasses.map((value) => (
                  <NativeSelectOption key={value} value={value}>{destinationClassLabel(value)}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
              <FieldLabel
                className="text-xs font-medium text-muted-foreground"
                htmlFor={fieldControlId('sourcing-filter', 'Usability')}
              >
                Usability
              </FieldLabel>
              <NativeSelect
                id={fieldControlId('sourcing-filter', 'Usability')}
                value={usability ?? ''}
                onChange={(event) => onUsabilityChange(
                  event.target.value ? event.target.value as SourcingUsability : undefined,
                )}
              >
                <NativeSelectOption value="">Any usability</NativeSelectOption>
                {sourcingUsabilities.map((value) => (
                  <NativeSelectOption key={value} value={value}>{usabilityLabel(value)}</NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field className="grid gap-1 text-xs font-medium text-muted-foreground">
              <FieldLabel
                className="text-xs font-medium text-muted-foreground"
                htmlFor={fieldControlId('sourcing-filter', 'Merge status')}
              >
                Merge status
              </FieldLabel>
              <NativeSelect
                id={fieldControlId('sourcing-filter', 'Merge status')}
                value={mergeStatus ?? ''}
                onChange={(event) =>
                  onMergeStatusChange(
                    event.target.value ? (event.target.value as SourcingMergeStatus) : undefined,
                  )
                }
              >
                <NativeSelectOption value="">Any status</NativeSelectOption>
                {sourcingMergeStatuses.map((status) => (
                  <NativeSelectOption key={status} value={status}>
                    {formatEnumLabel(status)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </section>

        {isLoading ? (
          <div
            role="status"
            aria-label="Opportunities loading"
            className="rounded-md border border-border bg-card p-4"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-foreground">Loading opportunities...</p>
              <Skeleton className="h-2 w-24" />
            </div>
            <Skeleton className="h-9 w-full" />
          </div>
        ) : null}

        {error ? (
          <LoadFailureView failure={error} onRetry={onRetry} />
        ) : null}

        {showResultTable ? (
          <section className="flex min-h-0 flex-1 flex-col rounded-md border border-border bg-card">
            <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
              <p className="text-sm font-medium text-foreground">
                {pageStart}-{pageEnd} of {result.total}
              </p>
              <Pagination aria-label="Opportunity pagination" className="mx-0 w-auto">
                <ButtonGroup>
                  <PaginationPrevious
                    aria-label="Previous Opportunity page"
                    disabled={result.offset === 0}
                    onClick={onPreviousPage}
                  >
                    Previous
                  </PaginationPrevious>
                  <PaginationNext
                    aria-label="Next Opportunity page"
                    disabled={!result.hasMore}
                    onClick={onNextPage}
                  >
                    Next
                  </PaginationNext>
                </ButtonGroup>
              </Pagination>
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              <Table aria-label="Opportunities" className="min-w-[1100px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Company</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Run</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Score</TableHead>
                    <TableHead>Merge</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Links</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.items.map((item) => (
                    <SourcingFindingRow
                      focused={focusedFindingId === item.id}
                      key={item.id}
                      item={item}
                      isPromoting={promotingFindingIds.has(item.id)}
                      showDebugData={showDebugData}
                      onDecideFinding={setDecidingFinding}
                      onEditFinding={setEditingFinding}
                      onOpenApplication={onOpenApplication}
                      onPromoteFinding={onPromoteFinding}
                    />
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        ) : !isLoading && !error ? (
          <Empty
            aria-label="Empty Opportunities"
            className="min-h-[11.25rem] flex-none gap-4 rounded-md border border-solid border-border bg-card p-6 md:min-h-[13.5rem] md:max-h-60 md:p-8"
          >
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Search aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>
                <h2>No opportunities</h2>
              </EmptyTitle>
              <EmptyDescription>No opportunities match the current filters.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {addingFinding ? (
          <SourcingFindingEditorModal
            mode="add"
            onClose={() => setAddingFinding(false)}
            onCreate={onCreateFinding}
          />
        ) : null}
        {editingFinding ? (
          <SourcingFindingEditorModal
            finding={editingFinding}
            mode="edit"
            onClose={() => setEditingFinding(null)}
            onUpdate={onUpdateFinding}
          />
        ) : null}
        {decidingFinding ? (
          <SourcingFindingDispositionModal
            finding={decidingFinding}
            onClose={() => setDecidingFinding(null)}
            onDecide={onDecideFinding}
          />
        ) : null}
      </section>
    </main>
  )
}

function SourcingFindingRow({
  focused,
  item,
  isPromoting,
  showDebugData,
  onDecideFinding,
  onEditFinding,
  onOpenApplication,
  onPromoteFinding,
}: {
  focused: boolean
  item: SourcingFinding
  isPromoting: boolean
  showDebugData: boolean
  onDecideFinding: (finding: SourcingFinding) => void
  onEditFinding: (finding: SourcingFinding) => void
  onOpenApplication: (application: ApplicationDetailSeed) => void
  onPromoteFinding: (findingId: string) => void
}) {
  const rowRef = useRef<HTMLTableRowElement>(null)
  useEffect(() => {
    if (focused) rowRef.current?.focus()
  }, [focused])
  const hasConcreteThirdPartyQuestion = Boolean(item.blocker?.trim())
  const hasDispositionReason = Boolean(item.dispositionReason?.trim())
  const canPromote =
    (item.mergeStatus === 'new' && item.usability !== 'review_only') ||
    (item.mergeStatus === 'blocked' &&
      item.policyBlocker === 'third_party_destination' &&
      hasConcreteThirdPartyQuestion &&
      !hasDispositionReason)
  const decision = getSourcingDecision(item)
  const mergedApplicationLabel = formatMergedApplicationLabel(item)
  const showMergedApplicationLink = Boolean(item.mergedApplicationId) && !canPromote
  const showRawMergedApplicationId = Boolean(item.mergedApplicationId) && (
    showDebugData || (!mergedApplicationLabel && !showMergedApplicationLink)
  )

  return (
    <TableRow
      ref={rowRef}
      aria-label={focused ? `Focused Opportunity ${item.id}` : undefined}
      aria-current={focused ? 'true' : undefined}
      data-state={focused ? 'selected' : undefined}
      tabIndex={focused ? 0 : -1}
    >
      <TableCell>
        <span className="font-medium text-foreground">{item.companyName}</span>
      </TableCell>
      <TableCell>
        <span className="block min-w-64 text-muted-foreground">{item.roleTitle}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{formatSourcingTiming(item)}</span>
        {item.employmentType ? (
          <span className="mt-1 block text-xs text-muted-foreground">
            {formatEnumLabel(item.employmentType)}
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <div className="grid gap-1">
          <Badge className="w-fit" variant="secondary">{item.sourceName}</Badge>
          {item.usability ? (
            <Badge className="w-fit" variant="outline">
              {destinationClassLabel(item.destinationClass)}
            </Badge>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        {showDebugData ? (
          <span className="font-mono text-xs text-muted-foreground">{item.workflowRunId}</span>
        ) : null}
      </TableCell>
      <TableCell>
        <span className="block min-w-44 text-muted-foreground">
          {formatSourcingLocation(item)}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={item.priorityScore === null ? 'outline' : 'default'}>
          {item.priorityScore === null ? 'No score' : `${item.priorityScore}/10`}
        </Badge>
      </TableCell>
      <TableCell>
        <div className="grid min-w-40 gap-1">
          <Badge className="w-fit" variant={decision.variant}>
            {item.mergeStatus}
          </Badge>
          <span className="text-xs font-medium text-foreground">{decision.label}</span>
          <span className="text-xs text-muted-foreground">{decision.description}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="grid min-w-56 gap-1 text-muted-foreground">
          <span>
            {item.dispositionReason ??
              item.blocker ??
              item.mergeNotes ??
              item.fitNotes ??
              item.duplicateNotes ??
              item.policyBlocker ??
              'None'}
          </span>
          {showRawMergedApplicationId ? (
            <span className="font-mono text-xs">{item.mergedApplicationId}</span>
          ) : null}
          {mergedApplicationLabel ? (
            <span className="text-xs">{mergedApplicationLabel}</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          {item.destinationUrl ? (
            <ExternalLinkButton className="px-2" href={item.destinationUrl}>
              {item.destinationClass === 'third_party_job_posting' ? 'third-party' : 'employer / ATS'}
            </ExternalLinkButton>
          ) : item.officialUrl ? (
            <ExternalLinkButton className="px-2" href={item.officialUrl}>official</ExternalLinkButton>
          ) : null}
          {item.intermediaryUrl ? (
            <ExternalLinkButton className="px-2" href={item.intermediaryUrl}>intermediary</ExternalLinkButton>
          ) : !item.destinationUrl && item.sourceUrl ? (
            <ExternalLinkButton className="px-2" href={item.sourceUrl}>source</ExternalLinkButton>
          ) : null}
          {!item.destinationUrl && !item.intermediaryUrl && !item.officialUrl && !item.sourceUrl ? (
            <span className="text-muted-foreground">None</span>
          ) : null}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex min-w-48 flex-wrap items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Edit opportunity ${item.companyName}`}
            onClick={() => onEditFinding(item)}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Set disposition ${item.companyName}`}
            onClick={() => onDecideFinding(item)}
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
          </Button>
          {canPromote ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Promote ${item.companyName}`}
              disabled={isPromoting}
              onClick={() => onPromoteFinding(item.id)}
            >
              {isPromoting
                ? 'Promoting'
                : item.policyBlocker === 'third_party_destination'
                  ? 'Approve & promote'
                  : 'Promote'}
            </Button>
          ) : item.mergedApplicationId ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Open app ${item.mergedApplicationCompanyName ?? item.companyName}`}
              onClick={() => onOpenApplication(sourcingFindingToApplication(item))}
            >
              Open app
            </Button>
          ) : (
            <span className="text-xs font-medium text-muted-foreground">
              {decision.actionLabel}
            </span>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

export { SourcingPage }
