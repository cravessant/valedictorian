import { randomUUID } from 'node:crypto'
import { and, count, desc, eq, isNull, like, type SQL } from 'drizzle-orm'
import type {
  CompleteWorkflowRunInput,
  CreateWorkflowRunStepInput,
  StartWorkflowRunInput,
  WorkflowRun,
  WorkflowRunsListInput,
  WorkflowRunsListResult,
  WorkflowRunStep,
} from 'sparxie'
import { sources, workflowRuns, workflowRunSteps } from '../../db/schema'
import type { DrizzleDatabase } from '../../db/sqlite'

const DEFAULT_RUN_LIST_LIMIT = 50

interface WorkflowRunRow {
  id: string
  runType: string
  status: string
  actorType: string
  actorName: string | null
  sourceId: string | null
  sourceName: string | null
  subjectApplicationId: string | null
  startedAt: string
  completedAt: string | null
  coverageStartedAt: string | null
  coverageEndedAt: string | null
  timezone: string | null
  inputJson: string
  summary: string | null
  outcome: string | null
  blocker: string | null
  metadataJson: string
  createdAt: string
  updatedAt: string
}

const workflowRunSelection = {
  id: workflowRuns.id,
  runType: workflowRuns.runType,
  status: workflowRuns.status,
  actorType: workflowRuns.actorType,
  actorName: workflowRuns.actorName,
  sourceId: workflowRuns.sourceId,
  sourceName: sources.name,
  subjectApplicationId: workflowRuns.subjectApplicationId,
  startedAt: workflowRuns.startedAt,
  completedAt: workflowRuns.completedAt,
  coverageStartedAt: workflowRuns.coverageStartedAt,
  coverageEndedAt: workflowRuns.coverageEndedAt,
  timezone: workflowRuns.timezone,
  inputJson: workflowRuns.inputJson,
  summary: workflowRuns.summary,
  outcome: workflowRuns.outcome,
  blocker: workflowRuns.blocker,
  metadataJson: workflowRuns.metadataJson,
  createdAt: workflowRuns.createdAt,
  updatedAt: workflowRuns.updatedAt,
}

export function createSqliteWorkflowRunRepository(database: DrizzleDatabase) {
  return {
    async startRun(input: StartWorkflowRunInput): Promise<WorkflowRun> {
      const now = new Date().toISOString()
      const workflowRunId = randomUUID()

      return database.transaction((transaction) => {
        const sourceId = resolveWorkflowRunSourceId(transaction, input, now)

        transaction
          .insert(workflowRuns)
          .values({
            id: workflowRunId,
            runType: input.runType,
            status: 'in_progress',
            actorType: input.actorType,
            actorName: input.actorName ?? null,
            sourceId,
            subjectApplicationId: input.subjectApplicationId ?? null,
            startedAt: now,
            completedAt: null,
            coverageStartedAt: input.coverageStartedAt ?? null,
            coverageEndedAt: input.coverageEndedAt ?? null,
            timezone: input.timezone ?? null,
            inputJson: JSON.stringify(input.input ?? {}),
            summary: input.summary ?? null,
            outcome: null,
            blocker: null,
            metadataJson: JSON.stringify(input.metadata ?? {}),
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          })
          .run()

        insertWorkflowRunStep(transaction, {
          actor: runActor(input.actorType, input.actorName),
          message: input.summary ?? 'Workflow run started.',
          now,
          payload: input,
          sequence: 1,
          type: 'run_started',
          workflowRunId,
        })

        return selectWorkflowRunById(transaction, workflowRunId)
      })
    },
    async createRunStep(input: CreateWorkflowRunStepInput): Promise<WorkflowRunStep> {
      const now = new Date().toISOString()

      return database.transaction((transaction) => {
        const existing = transaction
          .select({ id: workflowRuns.id })
          .from(workflowRuns)
          .where(and(eq(workflowRuns.id, input.workflowRunId), isNull(workflowRuns.deletedAt)))
          .get()

        if (!existing) {
          throw new Error(`Workflow run not found: ${input.workflowRunId}`)
        }

        const previousStep = transaction
          .select({ sequence: workflowRunSteps.sequence })
          .from(workflowRunSteps)
          .where(eq(workflowRunSteps.workflowRunId, input.workflowRunId))
          .orderBy(desc(workflowRunSteps.sequence))
          .get()
        const sequence = (previousStep?.sequence ?? 0) + 1

        insertWorkflowRunStep(transaction, {
          actor: input.actor ?? 'agent',
          message: input.message,
          now,
          payload: input.payload ?? {},
          sequence,
          type: input.type,
          workflowRunId: input.workflowRunId,
        })

        const step = transaction
          .select()
          .from(workflowRunSteps)
          .where(
            and(
              eq(workflowRunSteps.workflowRunId, input.workflowRunId),
              eq(workflowRunSteps.sequence, sequence),
            ),
          )
          .get()

        if (!step) {
          throw new Error(`Workflow run step not found: ${input.workflowRunId}`)
        }

        return mapWorkflowRunStep(step)
      })
    },
    async completeRun(input: CompleteWorkflowRunInput): Promise<WorkflowRun> {
      const now = new Date().toISOString()

      return database.transaction((transaction) => {
        const existing = transaction
          .select()
          .from(workflowRuns)
          .where(and(eq(workflowRuns.id, input.workflowRunId), isNull(workflowRuns.deletedAt)))
          .get()

        if (!existing) {
          throw new Error(`Workflow run not found: ${input.workflowRunId}`)
        }

        const previousStep = transaction
          .select({ sequence: workflowRunSteps.sequence })
          .from(workflowRunSteps)
          .where(eq(workflowRunSteps.workflowRunId, input.workflowRunId))
          .orderBy(desc(workflowRunSteps.sequence))
          .get()

        transaction
          .update(workflowRuns)
          .set({
            status: input.status ?? 'completed',
            outcome: input.outcome ?? existing.outcome,
            summary: input.summary ?? existing.summary,
            blocker: input.blocker ?? existing.blocker,
            metadataJson:
              input.metadata === undefined ? existing.metadataJson : JSON.stringify(input.metadata),
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(workflowRuns.id, input.workflowRunId))
          .run()

        insertWorkflowRunStep(transaction, {
          actor: runActor(existing.actorType, existing.actorName),
          message: input.summary ?? 'Workflow run completed.',
          now,
          payload: input,
          sequence: (previousStep?.sequence ?? 0) + 1,
          type: 'run_completed',
          workflowRunId: input.workflowRunId,
        })

        return selectWorkflowRunById(transaction, input.workflowRunId)
      })
    },
    async listRuns(input: WorkflowRunsListInput = {}): Promise<WorkflowRunsListResult> {
      const limit = input.limit ?? DEFAULT_RUN_LIST_LIMIT
      const offset = input.offset ?? 0
      const where = buildWorkflowRunWhere(input)
      const totalRow = database
        .select({ value: count() })
        .from(workflowRuns)
        .leftJoin(sources, eq(workflowRuns.sourceId, sources.id))
        .where(where)
        .get()
      const rows = database
        .select(workflowRunSelection)
        .from(workflowRuns)
        .leftJoin(sources, eq(workflowRuns.sourceId, sources.id))
        .where(where)
        .orderBy(desc(workflowRuns.startedAt))
        .limit(limit)
        .offset(offset)
        .all()
      const items = rows.map((row) => mapWorkflowRun(row, selectWorkflowRunSteps(database, row.id)))
      const total = totalRow?.value ?? 0

      return {
        items,
        total,
        limit,
        offset,
        hasMore: offset + items.length < total,
      }
    },
  }
}

function buildWorkflowRunWhere(input: WorkflowRunsListInput) {
  const filters: SQL[] = [isNull(workflowRuns.deletedAt)]

  if (input.runType) {
    filters.push(eq(workflowRuns.runType, input.runType))
  }

  if (input.status) {
    filters.push(eq(workflowRuns.status, input.status))
  }

  if (input.sourceId) {
    filters.push(eq(workflowRuns.sourceId, input.sourceId))
  } else if (input.source) {
    filters.push(like(sources.name, `%${input.source}%`))
  }

  if (input.subjectApplicationId) {
    filters.push(eq(workflowRuns.subjectApplicationId, input.subjectApplicationId))
  }

  return and(...filters)
}

function findOrCreateSource(
  database: Pick<DrizzleDatabase, 'insert' | 'select'>,
  sourceName: string,
  now: string,
) {
  const normalizedName = sourceName.trim().toLowerCase()
  const existing = database
    .select()
    .from(sources)
    .where(eq(sources.name, sourceName.trim()))
    .get()

  if (existing) {
    return existing
  }

  const source = {
    id: `source-${normalizedName.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`,
    name: sourceName.trim(),
    accountHint: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }

  database.insert(sources).values(source).run()

  return source
}

function resolveWorkflowRunSourceId(
  database: Pick<DrizzleDatabase, 'insert' | 'select'>,
  input: StartWorkflowRunInput,
  now: string,
) {
  if (input.sourceId) {
    const source = database
      .select()
      .from(sources)
      .where(eq(sources.id, input.sourceId))
      .get()

    if (!source) {
      throw new Error(`Source not found: ${input.sourceId}`)
    }

    return source.id
  }

  return input.sourceName ? findOrCreateSource(database, input.sourceName, now).id : null
}

function insertWorkflowRunStep(
  database: Pick<DrizzleDatabase, 'insert'>,
  {
    actor,
    message,
    now,
    payload,
    sequence,
    type,
    workflowRunId,
  }: {
    actor: string
    message: string
    now: string
    payload: unknown
    sequence: number
    type: string
    workflowRunId: string
  },
) {
  database
    .insert(workflowRunSteps)
    .values({
      id: randomUUID(),
      workflowRunId,
      sequence,
      type,
      message,
      payloadJson: JSON.stringify(payload),
      actor,
      createdAt: now,
    })
    .run()
}

function selectWorkflowRunById(
  database: Pick<DrizzleDatabase, 'select'>,
  workflowRunId: string,
) {
  const row = database
    .select(workflowRunSelection)
    .from(workflowRuns)
    .leftJoin(sources, eq(workflowRuns.sourceId, sources.id))
    .where(eq(workflowRuns.id, workflowRunId))
    .get()

  if (!row) {
    throw new Error(`Workflow run not found: ${workflowRunId}`)
  }

  return mapWorkflowRun(row, selectWorkflowRunSteps(database, workflowRunId))
}

function selectWorkflowRunSteps(
  database: Pick<DrizzleDatabase, 'select'>,
  workflowRunId: string,
) {
  return database
    .select()
    .from(workflowRunSteps)
    .where(eq(workflowRunSteps.workflowRunId, workflowRunId))
    .orderBy(workflowRunSteps.sequence)
    .all()
}

function mapWorkflowRun(row: WorkflowRunRow, steps: Array<typeof workflowRunSteps.$inferSelect>) {
  return {
    id: row.id,
    runType: row.runType,
    status: row.status,
    actorType: row.actorType,
    actorName: row.actorName,
    sourceId: row.sourceId,
    sourceName: row.sourceName,
    subjectApplicationId: row.subjectApplicationId,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    coverageStartedAt: row.coverageStartedAt,
    coverageEndedAt: row.coverageEndedAt,
    timezone: row.timezone,
    inputJson: row.inputJson,
    summary: row.summary,
    outcome: row.outcome,
    blocker: row.blocker,
    metadataJson: row.metadataJson,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    steps: steps.map(mapWorkflowRunStep),
  } as WorkflowRun
}

function mapWorkflowRunStep(row: typeof workflowRunSteps.$inferSelect): WorkflowRunStep {
  return {
    id: row.id,
    workflowRunId: row.workflowRunId,
    sequence: row.sequence,
    type: row.type,
    message: row.message,
    payloadJson: row.payloadJson,
    actor: row.actor,
    createdAt: row.createdAt,
  }
}

function runActor(actorType: string, actorName?: string | null) {
  return actorName ? `${actorType}:${actorName}` : actorType
}
