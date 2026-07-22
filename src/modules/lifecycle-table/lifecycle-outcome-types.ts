import type {
  DuplicateResolution,
  LifecycleBlocker,
  LifecycleWarning,
  RemovalChoice,
  WarningOverride,
} from 'sparxie'
import type { ReactNode } from 'react'

export interface DuplicateChoice {
  readonly action: DuplicateResolution
  readonly targetResourceId: string
}

export interface DependentRemovalChoice {
  readonly choice: RemovalChoice
  readonly dependentIds: ReadonlyArray<string>
  readonly supportedChoices: ReadonlyArray<RemovalChoice>
}

export interface RestoreDependentSummary {
  readonly dependentId: string
  readonly state: 'restored' | 'remained_tombstoned' | 'remained_unlinked'
}

/**
 * Outcome of a lifecycle mutation. The `kind` discriminates between errors
 * (deterministic blockers) and policy warnings; warnings retain the draft and
 * allow resubmission with selected warning codes plus required attributable
 * rationale. Duplicate blockers expose only their allowed attach/merge
 * choices and target id. Removals expose supported dependent choices and
 * dependent ids; successful removal/restore shows affected dependent
 * summaries.
 */
export type LifecycleOutcome =
  | { kind: 'error'; blocker: LifecycleBlocker; message: string }
  | { kind: 'warnings'; warnings: ReadonlyArray<LifecycleWarning>; override: WarningOverride | null }
  | { kind: 'duplicate'; blocker: LifecycleBlocker; choices: ReadonlyArray<DuplicateChoice>; message: string }
  | { kind: 'removal-blocked'; blocker: LifecycleBlocker; choice: DependentRemovalChoice; message: string }
  | { kind: 'removed'; affectedDependentIds: ReadonlyArray<string> }
  | { kind: 'restored'; dependentLinks: ReadonlyArray<RestoreDependentSummary> }
  | { kind: 'succeeded' }
  | { kind: 'history'; entries: ReadonlyArray<HistoryEntrySummary> }

export interface HistoryEntrySummary {
  readonly revision: number
  readonly kind: string
  readonly actor: { id: string; type: string; displayName?: string }
  readonly timestamp: string
  readonly summary: string
}

export interface LifecycleOutcomeProps {
  readonly outcome: LifecycleOutcome
  readonly onResolveDuplicate?: (choice: DuplicateChoice) => void
  readonly onResolveRemoval?: (choice: RemovalChoice, rationale: string) => void
  readonly onOverrideWarnings?: (warningCodes: ReadonlyArray<LifecycleWarning['code']>, rationale: string) => void
  readonly children?: ReactNode
}

export type LifecycleOutcomeActions = Omit<LifecycleOutcomeProps, 'outcome' | 'children'>
