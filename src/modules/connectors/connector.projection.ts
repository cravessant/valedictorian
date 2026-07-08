import { createHash } from 'node:crypto'
import type { SourcingFinding } from 'sparxie'
import {
  canonicalizeApplicationUrl,
  normalizeApplicationUrlPreservingQuery,
} from '../applications/application.types'
import type { createSqliteSourcingRepository } from '../sourcing/sourcing.repository'
import type { createSqliteWorkflowRunRepository } from '../workflow-runs/workflow-run.repository'
import type {
  ConnectorObservationRecord,
  createSqliteConnectorRepository,
} from './connector.repository'

export interface CreateSqliteConnectorProjectionServiceOptions {
  connectorRepository: ReturnType<typeof createSqliteConnectorRepository>
  sourcingRepository: ReturnType<typeof createSqliteSourcingRepository>
  workflowRunRepository: ReturnType<typeof createSqliteWorkflowRunRepository>
}

export interface ProjectObservationInput {
  connectorObservationId: string
}

export interface ProjectObservationResult {
  finding: SourcingFinding
}

export function createSqliteConnectorProjectionService({
  connectorRepository,
  sourcingRepository,
  workflowRunRepository,
}: CreateSqliteConnectorProjectionServiceOptions) {
  return {
    async projectObservation(
      input: ProjectObservationInput,
    ): Promise<ProjectObservationResult> {
      const observation = await connectorRepository.getObservation(input.connectorObservationId)

      if (!observation) {
        throw new Error(`Connector observation not found: ${input.connectorObservationId}`)
      }

      const projectionKeys = buildProjectionDedupeKeys(observation)
      const existingProjection =
        await connectorRepository.findProjectionByDedupeKeys(projectionKeys)

      if (existingProjection) {
        const existingFinding = await sourcingRepository.getFinding(
          existingProjection.sourcingFindingId,
        )

        if (officialUrlsConflict(observation, existingFinding)) {
          return projectNewObservation({
            connectorRepository,
            observation,
            projectionKeys,
            sourcingRepository,
            workflowRunRepository,
          })
        }

        const finding = await sourcingRepository.updateFinding({
          findingId: existingProjection.sourcingFindingId,
          ...sourcingFindingUpdatePatchForObservation(observation),
        })
        await connectorRepository.linkObservationToSourcingFinding({
          connectorObservationId: observation.id,
          sourcingFindingId: finding.id,
        })
        await connectorRepository.recordProjectionKeys({
          sourcingFindingId: finding.id,
          dedupeKeys: projectionKeys,
        })

        return { finding }
      }

      return projectNewObservation({
        connectorRepository,
        observation,
        projectionKeys,
        sourcingRepository,
        workflowRunRepository,
      })
    },
  }
}

async function projectNewObservation({
  connectorRepository,
  observation,
  projectionKeys,
  sourcingRepository,
  workflowRunRepository,
}: CreateSqliteConnectorProjectionServiceOptions & {
  observation: ConnectorObservationRecord
  projectionKeys: string[]
}): Promise<ProjectObservationResult> {
  const sourceName = observation.connectorId
  const run = await workflowRunRepository.startRun({
    runType: 'sourcing',
    actorType: 'agent',
    actorName: 'connector-projection',
    sourceName,
    summary: `Projected connector observation ${observation.id}`,
    input: {
      connectorObservationId: observation.id,
      connectorId: observation.connectorId,
      sourceRecordKey: observation.sourceRecordKey,
    },
    metadata: {
      connectorInstanceId: observation.connectorInstanceId,
      connectorRunId: observation.connectorRunId,
    },
  })

  const finding = await sourcingRepository.createFinding({
    workflowRunId: run.id,
    sourceName,
    ...sourcingFindingCreateInputForObservation(observation),
    mergeStatus: 'new',
  })

  await connectorRepository.linkObservationToSourcingFinding({
    connectorObservationId: observation.id,
    sourcingFindingId: finding.id,
  })
  await connectorRepository.recordProjectionKeys({
    sourcingFindingId: finding.id,
    dedupeKeys: projectionKeys,
  })
  await workflowRunRepository.completeRun({
    workflowRunId: run.id,
    status: 'completed',
    outcome: 'projected',
    summary: `Projected connector observation ${observation.id}`,
    metadata: {
      connectorInstanceId: observation.connectorInstanceId,
      connectorObservationId: observation.id,
      connectorRunId: observation.connectorRunId,
      sourcingFindingId: finding.id,
    },
  })

  return { finding }
}

function buildProjectionDedupeKeys(observation: ConnectorObservationRecord): string[] {
  const keys: string[] = []

  if (observation.links.official) {
    keys.push(`official_url:${canonicalizeApplicationUrl(observation.links.official)}`)
  }

  const providerKeys: string[] = []
  for (const key of observation.dedupeKeys) {
    const providerKey = canonicalizeProviderDedupeKey(key)

    if (providerKey) {
      providerKeys.push(providerKey)
    }
  }
  keys.push(...providerKeys)

  const sourceUrl = observation.links.source ?? observation.links.intermediary

  if (sourceUrl) {
    keys.push(`source_url:${canonicalizeApplicationUrl(sourceUrl)}`)
  }

  keys.push(`source_record_key:${observation.connectorId}:${observation.sourceRecordKey}`)

  if (!observation.links.official && providerKeys.length === 0 && !sourceUrl) {
    keys.push(`content_hash:${contentHashForObservation(observation)}`)
  }

  return [...new Set(keys)]
}

function canonicalizeProviderDedupeKey(key: string): string | null {
  const trimmed = key.trim()
  const lower = trimmed.toLowerCase()
  const providerPrefix = /^(?:provider|provider_id|intermediary|intermediary_id):/

  if (providerPrefix.test(lower)) {
    return `provider_id:${lower.replace(providerPrefix, '')}`
  }

  return null
}

function officialUrlsConflict(
  observation: ConnectorObservationRecord,
  finding: SourcingFinding,
): boolean {
  if (!observation.links.official || !finding.officialUrl) {
    return false
  }

  return canonicalizeApplicationUrl(observation.links.official) !== finding.officialUrl
}

function sourcingFindingCreateInputForObservation(observation: ConnectorObservationRecord) {
  const sourceUrl = observation.links.source ?? observation.links.intermediary

  return {
    companyName: observation.companyName,
    roleTitle: observation.roleTitle,
    roleKind: inferRoleKind(observation.roleTitle),
    workMode: inferWorkMode(observation.locationRaw),
    country: 'US',
    locationRaw: observation.locationRaw,
    officialUrl: observation.links.official
      ? canonicalizeApplicationUrl(observation.links.official)
      : null,
    sourceUrl: sourceUrl ? normalizeApplicationUrlPreservingQuery(sourceUrl) : null,
    discoveredAt: observation.observedAt,
  }
}

function sourcingFindingUpdatePatchForObservation(observation: ConnectorObservationRecord) {
  const sourceUrl = observation.links.source ?? observation.links.intermediary

  return {
    companyName: observation.companyName,
    roleTitle: observation.roleTitle,
    roleKind: inferRoleKind(observation.roleTitle),
    workMode: inferWorkMode(observation.locationRaw),
    country: 'US',
    locationRaw: observation.locationRaw,
    ...(observation.links.official
      ? { officialUrl: canonicalizeApplicationUrl(observation.links.official) }
      : {}),
    ...(sourceUrl ? { sourceUrl: normalizeApplicationUrlPreservingQuery(sourceUrl) } : {}),
  }
}

function contentHashForObservation(observation: ConnectorObservationRecord): string {
  const normalizedParts = [
    observation.companyName,
    observation.roleTitle,
    observation.locationRaw ?? '',
    observation.observedAt.slice(0, 10),
  ].map((part) => part.trim().toLowerCase().replace(/\s+/g, ' '))

  return createHash('sha256').update(normalizedParts.join('\n')).digest('hex')
}

function inferRoleKind(roleTitle: string): SourcingFinding['roleKind'] {
  return /\bintern(?:ship)?\b/i.test(roleTitle) ? 'internship' : 'full_time'
}

function inferWorkMode(locationRaw: string | null | undefined): SourcingFinding['workMode'] {
  if (locationRaw && /\bremote\b/i.test(locationRaw)) {
    return 'remote'
  }

  return 'unclear'
}
