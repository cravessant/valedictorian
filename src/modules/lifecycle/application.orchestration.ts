/**
 * Application write orchestration (issue #304).
 *
 * The write half of the Application HTTP surface' create verb. The sparxie contract's
 * `applications.create` carries `initialLinks` that MUST be atomic with the create — so
 * a create is a COMPOSITION of the Application aggregate's `createOn` core plus its
 * `addLinkOn` conversation, materializing every initial link as a durable `pursuit_links`
 * row in the SAME transaction as the head insert. This mirrors the #302
 * Opportunity→Application promotion's atomic create+links machinery (it reuses the exact
 * aggregate cores); a non-atomic post-create add is rejected by construction because
 * there is no post-create path here.
 *
 * The initial links are ALSO frozen into the snapshot blob as `initialLinks` (the
 * Application service stamps them from `createOn`'s `initialLinks` field), so the
 * read-model presents the creation-time links truthfully even after the mutable link set
 * is edited.
 *
 * Ownership: every write is issued through an Application-module conversation
 * (`createOn` / `addLinkOn`). This file issues no direct `.insert(table)`, so the
 * state-ownership scanner attributes each write to the applications module; the
 * orchestration holds no ownership itself.
 *
 * Failure surface: lineage/duplicate/bounds failures are POLICY BLOCKS the facade maps
 * to a 200 blocked body; existence/concurrency remain typed errors — the facade's shared
 * mutation classifier draws that line. A keyed re-create (or an attach duplicateResolution)
 * converges to the existing Application (`created:false`) and skips the link adds, which
 * already ran on the first create.
 */
import type { PgliteDatabase } from '../../db/pglite'
import { type Clock } from '../../db/uuidv7'
import type {
  AddLinkInput,
  ApplicationActor,
  ApplicationAggregateService,
  ApplicationDuplicateResolutionInput,
  ApplicationWarningOverrideInput,
} from '../applications/application.aggregate.service'
import { isUniqueViolation } from '../applications/application.aggregate.validation'

type Tx = Parameters<Parameters<PgliteDatabase['transaction']>[0]>[0]

/** A creation-time link (contract `initialLinks` entry — no primary designation on create). */
export interface ApplicationInitialLinkInput {
  readonly kind: string
  readonly label: string
  readonly url: string
}

export interface CreateApplicationOrchestrationInput {
  readonly workspaceId: string
  readonly actor: ApplicationActor
  readonly opportunityId: string
  /** Contract `jobId` — the Job the caller expects the Opportunity to still point at. */
  readonly expectedJobId: string
  readonly expectedJobFactsRevision: number
  readonly idempotencyKey: string
  readonly initialLinks: readonly ApplicationInitialLinkInput[]
  readonly override?: ApplicationWarningOverrideInput | null
  readonly duplicateResolution?: ApplicationDuplicateResolutionInput
}

/** A transport-neutral write failure the facade maps into the strict `ApplicationMutationResult`. */
export interface ApplicationWriteFailure {
  readonly code: string
  readonly message: string
}

export type ApplicationWriteOutcome =
  | { readonly ok: true; readonly applicationId: string; readonly created: boolean; readonly timestamp: string }
  | { readonly ok: false; readonly failure: ApplicationWriteFailure }

export interface ApplicationOrchestration {
  createApplication(input: CreateApplicationOrchestrationInput): Promise<ApplicationWriteOutcome>
}

export interface ApplicationOrchestrationDeps {
  readonly applicationService: ApplicationAggregateService
}

export interface ApplicationOrchestrationOptions {
  readonly now?: Clock
}

/** Thrown inside the create transaction to roll it back and surface a typed failure. */
class ApplicationWriteAbort extends Error {
  constructor(readonly failure: ApplicationWriteFailure) {
    super(failure.message)
    this.name = 'ApplicationWriteAbort'
  }
}

export function createLifecycleApplicationOrchestration(
  database: PgliteDatabase,
  deps: ApplicationOrchestrationDeps,
  options: ApplicationOrchestrationOptions = {},
): ApplicationOrchestration {
  const clock = options.now ?? (() => new Date())
  const nowIso = () => clock().toISOString()
  const { applicationService } = deps

  return {
    async createApplication(input) {
      const timestamp = nowIso()
      try {
        return await database.transaction(async (tx: Tx) => {
          const created = await applicationService.createOn(tx, {
            workspaceId: input.workspaceId,
            opportunityId: input.opportunityId,
            actor: input.actor,
            idempotencyKey: input.idempotencyKey,
            expectedJobId: input.expectedJobId,
            expectedJobFactsRevision: input.expectedJobFactsRevision,
            override: input.override,
            duplicateResolution: input.duplicateResolution,
            initialLinks: input.initialLinks,
          })
          if (!created.ok) throw new ApplicationWriteAbort({ code: created.code, message: created.message })
          // A converged create (keyed re-create or attach) already carries its links.
          if (created.created) {
            for (const link of input.initialLinks) {
              const addInput: AddLinkInput = {
                workspaceId: input.workspaceId,
                applicationId: created.application.id,
                link: { kind: link.kind, label: link.label, url: link.url, isPrimary: false },
                actor: input.actor,
              }
              const added = await applicationService.addLinkOn(tx, addInput)
              if (!added.ok) throw new ApplicationWriteAbort({ code: added.code, message: added.message })
            }
          }
          return { ok: true as const, applicationId: created.application.id, created: created.created, timestamp }
        })
      } catch (error) {
        if (error instanceof ApplicationWriteAbort) return { ok: false, failure: error.failure }
        if (isUniqueViolation(error)) {
          return { ok: false, failure: { code: 'deterministic_duplicate', message: 'an active application already exists for this opportunity' } }
        }
        throw error
      }
    },
  }
}
