import {
  deleteConnectorScheduleInputSchema,
  dispatchConnectorScheduleDueInputSchema,
  isIanaTimeZone,
  MAX_CONNECTOR_SCHEDULE_HISTORY_LIMIT,
  pauseConnectorScheduleInputSchema,
  resumeConnectorScheduleInputSchema,
  upsertConnectorScheduleInputSchema,
  type DeleteConnectorScheduleInput,
  type DispatchConnectorScheduleDueInput,
  type PauseConnectorScheduleInput,
  type ResumeConnectorScheduleInput,
  type UpsertConnectorScheduleInput,
} from 'sparxie'
import { ZodError } from 'zod'
import { createConnectorScheduleError } from '../modules/connectors/connector-schedule.errors'
import { readRecord } from './local-server.http'

function readScheduleBody(body: unknown): Record<string, unknown> {
  return readRecord(body)
}

function mapUpsertParseError(error: unknown, body: Record<string, unknown>): never {
  if (typeof body.timezone === 'string' && !isIanaTimeZone(body.timezone)) {
    throw createConnectorScheduleError(
      'invalid_timezone',
      'timezone must be a valid IANA time zone',
    )
  }

  if (error instanceof ZodError) {
    if (error.issues.some((issue) => issue.path[0] === 'cadence')) {
      throw createConnectorScheduleError(
        'invalid_cadence',
        'cadence must be a supported schedule cadence',
      )
    }

    throw Object.assign(new Error(error.issues[0]?.message ?? 'Invalid connector schedule input'), {
      statusCode: 400,
    })
  }

  throw error
}

export function parseUpsertConnectorScheduleInput(
  connectorInstanceId: string,
  body: unknown,
): UpsertConnectorScheduleInput {
  const record = {
    ...readScheduleBody(body),
    connectorInstanceId,
  }

  try {
    return upsertConnectorScheduleInputSchema.parse(record)
  } catch (error) {
    mapUpsertParseError(error, record)
  }
}

export function parsePauseConnectorScheduleInput(
  connectorInstanceId: string,
  body: unknown,
): PauseConnectorScheduleInput {
  return pauseConnectorScheduleInputSchema.parse({
    ...readScheduleBody(body),
    connectorInstanceId,
  })
}

export function parseResumeConnectorScheduleInput(
  connectorInstanceId: string,
  body: unknown,
): ResumeConnectorScheduleInput {
  return resumeConnectorScheduleInputSchema.parse({
    ...readScheduleBody(body),
    connectorInstanceId,
  })
}

export function parseDeleteConnectorScheduleInput(
  connectorInstanceId: string,
  body: unknown,
): DeleteConnectorScheduleInput {
  return deleteConnectorScheduleInputSchema.parse({
    ...readScheduleBody(body),
    connectorInstanceId,
  })
}

export function parseDispatchConnectorScheduleDueInput(
  connectorInstanceId: string,
  body: unknown,
): DispatchConnectorScheduleDueInput {
  return dispatchConnectorScheduleDueInputSchema.parse({
    ...readScheduleBody(body),
    connectorInstanceId,
  })
}

export function parseConnectorScheduleHistoryQuery(
  connectorInstanceId: string,
  requestUrl: URL,
): { connectorInstanceId: string; limit: number; offset: number } {
  const limitParam = requestUrl.searchParams.get('limit')
  const offsetParam = requestUrl.searchParams.get('offset')
  const limit = limitParam === null ? 50 : Number(limitParam)
  const offset = offsetParam === null ? 0 : Number(offsetParam)

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CONNECTOR_SCHEDULE_HISTORY_LIMIT) {
    throw new Error(`Invalid limit: ${limitParam}`)
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`Invalid offset: ${offsetParam}`)
  }

  return { connectorInstanceId, limit, offset }
}
