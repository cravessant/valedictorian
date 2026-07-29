import { describe, expect, it } from 'vitest'
import { connectorDescriptorMaxSources } from '@sparxie/sdk'
import type { AppJobConnector } from '../ports/connector.runner-contracts'
import {
  ConnectorAdmissionError,
  admitInstalledConnectorDescriptor,
} from './connector.installed-descriptor'
import { createStaticConnectorRegistry } from './connector.registry'
import { listInstalledConnectorDescriptors } from './connector.capabilities'
import {
  admitConnectorSettings,
  revalidatePersistedConnectorSettings,
} from './connector.settings-validation'
import { sanitizeConnectorRefreshResult } from './connector.refresh-result-sanitizer'

const CONNECTOR_ID = 'fixture.boundaries'

describe('registry admission boundary', () => {
  it('admits each installed definition once and reuses that descriptor for every consumer', () => {
    const registry = createStaticConnectorRegistry([fixtureConnector()])

    const registered = registry.get(CONNECTOR_ID)!

    expect(registered.descriptor).toMatchObject({
      connectorId: CONNECTOR_ID,
      connectorVersion: '1.0.0',
      displayName: CONNECTOR_ID,
    })
    expect(registry.getVersion(CONNECTOR_ID, '1.0.0')!.descriptor).toBe(registered.descriptor)
    expect(registry.list()[0]!.descriptor).toBe(registered.descriptor)
    expect(listInstalledConnectorDescriptors(registry).items[0]).toBe(registered.descriptor)
  })

  it('rejects an invalid definition at construction with connector identity and a safe diagnostic', () => {
    const invalid = fixtureConnector()
    invalid.definition.configSchema = {
      version: 'fixture-boundaries-config@1',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { batchSize: { type: 'integer' } },
      },
    } as AppJobConnector['definition']['configSchema']

    expect(() => createStaticConnectorRegistry([invalid]))
      .toThrow(new RegExp(`Connector ${CONNECTOR_ID}@1\\.0\\.0 failed registry admission`))
    expect(() => createStaticConnectorRegistry([invalid])).toThrow(ConnectorAdmissionError)
  })

  it('reports identity and never leaks values when the definition itself is malformed', () => {
    const malformed = {
      definition: {
        id: CONNECTOR_ID,
        version: '1.0.0',
        displayName: '  provider-session-token-abc123  ',
      },
    } as unknown as AppJobConnector

    let raised: unknown
    try {
      admitInstalledConnectorDescriptor(malformed)
    } catch (error) {
      raised = error
    }

    expect(raised).toBeInstanceOf(ConnectorAdmissionError)
    expect((raised as ConnectorAdmissionError).connectorIdentity).toBe(`${CONNECTOR_ID}@1.0.0`)
    expect((raised as Error).message).toBe(
      `Connector ${CONNECTOR_ID}@1.0.0 failed registry admission: displayName: custom`,
    )
    expect((raised as Error).message).not.toMatch(/session-token-abc123/)
  })

  it('keeps identity reportable when the definition carries no usable identity tokens', () => {
    const anonymous = { definition: { id: 42, version: null } } as unknown as AppJobConnector

    expect(() => admitInstalledConnectorDescriptor(anonymous))
      .toThrow(/Connector unknown@unknown failed registry admission/)
  })

  it('freezes the admitted descriptor through nested schema data', () => {
    const descriptor = createStaticConnectorRegistry([fixtureConnector()]).get(CONNECTOR_ID)!
      .descriptor
    const schema = descriptor.configSchema!.schema
    if (!('type' in schema) || schema.type !== 'object') {
      throw new Error('expected an object renderer schema')
    }
    const properties = schema.properties as Record<string, unknown>

    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(Object.isFrozen(schema)).toBe(true)
    expect(Object.isFrozen(properties)).toBe(true)
    expect(Object.isFrozen(schema.required)).toBe(true)
    expect(() => {
      (properties as { batchSize: unknown }).batchSize = { type: 'string' }
    }).toThrow(TypeError)
  })

  it('detaches the admitted descriptor from the mutable connector definition', () => {
    const connector = fixtureConnector()
    const registry = createStaticConnectorRegistry([connector])

    connector.definition.configSchema!.version = 'mutated-after-admission@9'

    expect(registry.get(CONNECTOR_ID)!.descriptor.configSchema!.version)
      .toBe('fixture-boundaries-config@1')
  })

  it('refuses to install the same connector id twice', () => {
    expect(() => createStaticConnectorRegistry([fixtureConnector(), fixtureConnector()]))
      .toThrow(/connector id is already installed/)
  })

  it('keeps the SDK aggregate descriptor-list maximum at the admission boundary', () => {
    const atMaximum = distinctConnectors(connectorDescriptorMaxSources)

    const registry = createStaticConnectorRegistry(atMaximum)

    expect(listInstalledConnectorDescriptors(registry).items).toHaveLength(
      connectorDescriptorMaxSources,
    )
    expect(() => createStaticConnectorRegistry(distinctConnectors(connectorDescriptorMaxSources + 1)))
      .toThrow(new RegExp(
        `installed connector count ${connectorDescriptorMaxSources + 1} `
        + `exceeds the supported maximum of ${connectorDescriptorMaxSources}`,
      ))
    expect(() => createStaticConnectorRegistry(distinctConnectors(connectorDescriptorMaxSources + 1)))
      .toThrow(ConnectorAdmissionError)
  })
})

describe('settings admission boundary', () => {
  const descriptor = createStaticConnectorRegistry([fixtureConnector()]).get(CONNECTOR_ID)!
    .descriptor

  it('lets a draft omit required values that enabled admission demands in one pass', () => {
    expect(() => admitConnectorSettings(descriptor, { config: {}, filters: {} }, 'draft'))
      .not.toThrow()
    expect(() => admitConnectorSettings(descriptor, { config: {}, filters: {} }, 'enabled'))
      .toThrow(/batchSize.*required/i)
    expect(() => admitConnectorSettings(
      descriptor,
      { config: { batchSize: 20 }, filters: { category: 'engineering' } },
      'enabled',
    )).not.toThrow()
  })

  it('rejects unsupported and malformed values in draft mode as well', () => {
    expect(() => admitConnectorSettings(
      descriptor,
      { config: { privateProviderConfig: 'leak' }, filters: {} },
      'draft',
    )).toThrow(/not declared/i)
    expect(() => admitConnectorSettings(
      descriptor,
      { config: { batchSize: 7 }, filters: {} },
      'draft',
    )).toThrow(/batchSize/i)
    expect(() => admitConnectorSettings(descriptor, { config: [], filters: {} }, 'draft'))
      .toThrow(/Invalid connector config/)
  })
})

describe('persisted settings revalidation boundary', () => {
  const descriptor = createStaticConnectorRegistry([fixtureConnector()]).get(CONNECTOR_ID)!
    .descriptor
  const incomplete = { config: {}, filters: {} }
  const unsupported = {
    config: { batchSize: 20, undeclaredSetting: true },
    filters: { category: 'engineering' },
  }

  it('demands complete and declared persisted settings before execution', () => {
    expect(() => revalidatePersistedConnectorSettings(descriptor, incomplete))
      .toThrow(/batchSize.*required/i)
    expect(() => revalidatePersistedConnectorSettings(descriptor, unsupported))
      .toThrow(/undeclaredSetting|not declared/i)
    expect(() => revalidatePersistedConnectorSettings(descriptor, {
      config: { batchSize: 20 },
      filters: { category: 'engineering' },
    })).not.toThrow()
  })
})

describe('plugin output validation boundary', () => {
  it('sanitizes connector-returned run output independently of any descriptor admission', () => {
    const sanitized = sanitizeConnectorRefreshResult({
      status: 'completed',
      coverage: { start: '2026-07-01T00:00:00.000Z', end: '2026-07-02T00:00:00.000Z' },
      observations: [],
      nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
      operationOutcome: null,
      stats: { observations: -5 },
      warnings: 'not-a-warning-list',
      synchronization: {
        newestFrontier: { state: 'caught_up' },
        historicalBackfill: {
          state: 'caught_up',
          boundary: { earliestDate: '2026-99-99' },
        },
        pendingResolutionCount: -1,
        outcome: { kind: 'caught_up' },
      },
    })

    expect(sanitized.warnings).toEqual([
      { code: 'connector.execution_failed', message: 'Connector execution failed before completion.' },
    ])
    expect(sanitized.synchronization).toMatchObject({
      pendingResolutionCount: 0,
      historicalBackfill: { boundary: { earliestDate: '1970-01-01' } },
    })
  })
})

function distinctConnectors(count: number): AppJobConnector[] {
  return Array.from({ length: count }, (_unused, index) => {
    const connector = fixtureConnector()
    connector.definition.id = `${CONNECTOR_ID}-${index}`
    return connector
  })
}

function fixtureConnector(): AppJobConnector {
  return {
    definition: {
      id: CONNECTOR_ID,
      version: '1.0.0',
      configSchema: {
        version: 'fixture-boundaries-config@1',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { batchSize: { type: 'integer', enum: [10, 20] } },
          required: ['batchSize'],
        },
      },
      filterSchema: {
        version: 'fixture-boundaries-filters@1',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { category: { type: 'string', enum: ['engineering', 'design'] } },
        },
      },
    },
    async refresh(input) {
      return {
        coverage: input.coverage,
        nextCheckpoint: { checkpoint: {}, schemaVersion: 'fixture-checkpoint@1' },
        observations: [],
        operationOutcome: null,
        status: 'completed',
        stats: { observations: 0 },
        synchronization: {
          newestFrontier: { state: 'caught_up' },
          historicalBackfill: {
            state: 'caught_up',
            boundary: { earliestDate: input.coverage.start.slice(0, 10) },
          },
          pendingResolutionCount: 0,
          outcome: { kind: 'caught_up' },
        },
        warnings: [],
      }
    },
  }
}
