import { describe, expect, it } from 'vitest'

import { workspaces } from '../../db/workspaces.schema'
import { useResettablePgliteTestOwner } from '../../test/pglite-test-owner'
import { createPgliteCaptureReadModel } from '../capture/capture.read-model'
import { createPgliteCaptureService } from '../capture/capture.service'
import { createConnectorCaptureHost } from './connector.capture-host'

const resettableOwner = useResettablePgliteTestOwner()

describe.sequential('connector Capture host revision semantics', () => {
  it('reuses an identical content revision while recording each run occurrence', async () => {
    const { database } = resettableOwner()
    await database.insert(workspaces).values({
      id: 'workspace-capture-host',
      name: 'Capture host',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    })
    let tick = 0
    const captureService = createPgliteCaptureService(database, {
      now: () => new Date(Date.UTC(2026, 6, 22, 0, 0, tick++)),
    })
    const host = createConnectorCaptureHost({ captureService, workspaceId: 'workspace-capture-host' })
    const input = {
      adapter: { id: 'jobright.resolver', version: '0.17.0' },
      connectorInstanceId: 'jobright-default',
      executionScopeId: 'connector.jobright-default',
      input: {
        observedAt: '2026-07-22T01:00:00.000Z',
        providerRecordId: 'jobright-123',
        providerSchema: 'jobright.v1',
        payload: { title: 'Software Engineer' },
        evidence: [{ kind: 'title', label: 'Title', value: 'Software Engineer' }],
        reportedOrigin: { kind: 'job_board' as const, name: 'Jobright' },
      },
    }

    const first = await host.capture({ ...input, connectorRunId: 'run-one' })
    const second = await host.capture({
      ...input,
      connectorRunId: 'run-two',
      input: { ...input.input, observedAt: '2026-07-22T02:00:00.000Z' },
    })

    expect(first.revision).toMatchObject({ revision: 1, reused: false })
    expect(second.revision).toMatchObject({
      id: first.revision.id,
      revision: 1,
      contentHash: first.revision.contentHash,
      reused: true,
    })
    expect(second.occurrence.id).not.toBe(first.occurrence.id)
    expect(second.occurrence.capture?.connectorRunId).toBe('run-two')

    const readModel = createPgliteCaptureReadModel(database)
    expect((await readModel.listCaptures('workspace-capture-host', { connectorRunId: 'run-one' })).items)
      .toHaveLength(1)
    expect((await readModel.listCaptures('workspace-capture-host', { connectorRunId: 'run-two' })).items)
      .toHaveLength(1)
    expect((await readModel.historyCaptures('workspace-capture-host', { id: first.captureId })).items)
      .toHaveLength(1)
  })
})
