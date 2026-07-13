import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDefaultLocalConnectorRegistry } from './connector.registry'

describe('connector registry', () => {
  it('does not register Jobright until the native synchronization contract is released', () => {
    const registry = createDefaultLocalConnectorRegistry()

    const connector = registry.get('jobright.resolver')

    expect(connector).toBeNull()
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

    expect(appPackage.dependencies.sparxie).toBe('0.18.0')
    expect(appPackage.dependencies['@sparxie/valedictorian-connectors-jobright']).toBe('0.11.0')
    expect(appPackage.devDependencies['@sparxie/valedictorian-connectors-core']).toBe('0.11.0')
    expect(sparxiePackage.version).toBe('0.18.0')
    expect(jobrightPackage.version).toBe('0.11.0')
    expect(corePackage.version).toBe('0.11.0')
  })
})
