import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDefaultLocalConnectorRegistry } from './connector.registry'

describe('connector registry', () => {
  it('registers the published Jobright connector by persisted connector id', () => {
    const registry = createDefaultLocalConnectorRegistry()

    const connector = registry.get('jobright.resolver')

    expect(connector?.definition).toMatchObject({
      displayName: 'Jobright internslist',
      id: 'jobright.resolver',
      version: '0.4.1',
    })
    expect(connector?.definition.auth).toMatchObject({
      modes: ['username_password'],
    })
    expect(typeof connector?.validateAuth).toBe('function')
    expect(registry.get('jobright.public')).toBeNull()
  })

  it('matches published sparxie and connector package versions for Jobright API auth', () => {
    const appPackage = JSON.parse(
      fs.readFileSync(path.resolve('package.json'), 'utf8'),
    ) as {
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    const sparxiePackage = JSON.parse(
      fs.readFileSync(path.resolve('node_modules/sparxie/package.json'), 'utf8'),
    ) as { version: string }
    const jobrightPackage = JSON.parse(
      fs.readFileSync(
        path.resolve('node_modules/@sparxie/valedictorian-connectors-jobright/package.json'),
        'utf8',
      ),
    ) as { version: string }
    const corePackage = JSON.parse(
      fs.readFileSync(
        path.resolve('node_modules/@sparxie/valedictorian-connectors-core/package.json'),
        'utf8',
      ),
    ) as { version: string }

    expect(appPackage.dependencies.sparxie).toBe('0.7.4')
    expect(appPackage.dependencies['@sparxie/valedictorian-connectors-jobright']).toBe('0.4.1')
    expect(appPackage.devDependencies['@sparxie/valedictorian-connectors-core']).toBe('0.4.1')
    expect(sparxiePackage.version).toBe('0.7.4')
    expect(jobrightPackage.version).toBe('0.4.1')
    expect(corePackage.version).toBe('0.4.1')
  })
})
