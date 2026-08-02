/**
 * Jobright provider-field resolver registration — focused proof (#325, A1).
 *
 * The aligned connector package exposes the pure provider-field resolver through the connector
 * registry with the current declaration identity (`jobright.provider-fields` /
 * `jobright-provider-fields@2`, pure, precedence 100, supported adapter `jobright.resolver`).
 */
import { describe, expect, it } from 'vitest'
import { jobrightProviderFieldResolverDeclaration } from '@sparxie/valedictorian-connectors-jobright'
import { createDefaultLocalConnectorRegistry } from '@sparxie/valedictorian-local-runtime/testing/modules/connectors/adapters/provider/connector.default-registry'
import { JOBRIGHT_CONNECTOR_ID } from '@sparxie/valedictorian-local-runtime/connectors'

describe('Jobright provider-field resolver registration (#325)', () => {
  it('exposes the provider-field resolver through the connector registry', () => {
    const registry = createDefaultLocalConnectorRegistry()
    const registered = registry.get(JOBRIGHT_CONNECTOR_ID)
    expect(registered).not.toBeNull()
    const resolver = registered?.connector.providerFieldResolver
    expect(resolver).toBeDefined()
    expect(resolver?.declaration.id).toBe('jobright.provider-fields')
    expect(resolver?.declaration.version).toBe('jobright-provider-fields@2')
  })

  it('declares a pure, precedence-100 resolver bound to the jobright.resolver adapter', () => {
    const declaration = jobrightProviderFieldResolverDeclaration
    expect(declaration.id).toBe('jobright.provider-fields')
    expect(declaration.version).toBe('jobright-provider-fields@2')
    expect(declaration.capabilities).toEqual(['pure'])
    expect(declaration.costClass).toBe('none')
    expect(declaration.precedence).toBe(100)
    expect(declaration.supportedAdapters?.ids).toContain('jobright.resolver')
    expect(declaration.outputFields).toContain('location')
  })
})
