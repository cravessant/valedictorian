import type { ConnectorOverviewListQuery } from '@sparxie/sdk'

interface ConnectorOverviewCursorPayload {
  v: 1
  id: string
  enabled: boolean | null
  severity: string | null
  status: string | null
}

export function createConnectorOverviewCursor(
  id: string,
  query: ConnectorOverviewListQuery,
): string {
  return Buffer.from(JSON.stringify(cursorPayload(id, query))).toString('base64url')
}

export function readConnectorOverviewCursor(
  cursor: string,
  query: ConnectorOverviewListQuery,
): string {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error()
    const bytes = Buffer.from(cursor, 'base64url')
    if (bytes.toString('base64url') !== cursor) throw new Error()
    const parsed = JSON.parse(bytes.toString('utf8')) as unknown
    const expected = cursorPayload('', query)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    const value = parsed as Record<string, unknown>
    if (Object.keys(value).sort().join(',') !== 'enabled,id,severity,status,v'
      || value.v !== 1
      || typeof value.id !== 'string'
      || value.id.length === 0
      || value.enabled !== expected.enabled
      || value.severity !== expected.severity
      || value.status !== expected.status) throw new Error()
    return value.id
  } catch {
    throw Object.assign(new Error('Invalid connector overview cursor.'), {
      code: 'invalid_connector_overview_cursor',
      statusCode: 400,
    })
  }
}

function cursorPayload(
  id: string,
  query: ConnectorOverviewListQuery,
): ConnectorOverviewCursorPayload {
  return {
    v: 1,
    id,
    enabled: query.enabled ?? null,
    severity: query.severity ?? null,
    status: query.status ?? null,
  }
}
