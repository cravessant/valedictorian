import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const productionExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs'])

describe('Jobright API-only source guards', () => {
  it('removes Electron connector-port wiring and browser-session host paths', () => {
    const mainSource = read('electron/main.ts')
    const runtimePortsSource = read('src/modules/connectors/connector.runtime-ports.ts')
    const runnerSource = read('src/modules/connectors/connector.runner.ts')
    const localClientSource = read('src/runtime/local-valedictorian-client.ts')
    const runtimeSource = read('src/runtime/valedictorian-runtime.ts')
    const workspaceSource = read('src/server/local-workspaces.ts')

    expect(fs.existsSync(path.resolve('electron/jobright-link-resolver.ts'))).toBe(false)
    expect(fs.existsSync(path.resolve('electron/connector-ports.ts'))).toBe(false)
    expect(fs.existsSync(path.resolve('electron/connector-ports.test.ts'))).toBe(false)
    expect(mainSource).not.toContain('createElectronConnectorPorts')
    expect(mainSource).not.toContain('createConnectorPorts')
    expect(mainSource).not.toContain('connector-ports')
    expect(mainSource).not.toContain('jobright-link-resolver')
    expect(mainSource).not.toContain('resolveJobrightLink')
    expect(runtimePortsSource).not.toContain('connectorAuth')
    expect(runtimePortsSource).not.toContain(['browser', 'Session'].join(''))
    expect(runtimePortsSource).not.toContain(['createUnavailable', 'BrowserSessionRuntime'].join(''))
    expect(runnerSource).not.toContain(['createRun', 'BrowserSessionRuntime'].join(''))
    expect(runnerSource).not.toContain(['preflight', 'BrowserSessionAuth'].join(''))
    expect(runnerSource).not.toContain(['browser', 'Sessions'].join(''))
    expect(localClientSource).not.toContain(['browser', 'Sessions'].join(''))
    expect(localClientSource).not.toContain('connectorAuth?:')
    expect(localClientSource).not.toContain(['legacy', 'BrowserSessionReferences'].join(''))
    expect(runtimeSource).not.toContain('connectorAuth:')
    expect(workspaceSource).not.toContain('connectorAuth:')
  })

  it('keeps native BrowserWindow usage only for app/workspace chrome, not Jobright connector windows', () => {
    const mainSource = read('electron/main.ts')
    const productionSources = collectProductionSources()
    const isolatedNativeUiProofPath = path.resolve('electron/native-ui-proof.ts')

    expect(mainSource).toContain('new BrowserWindow({')
    expect(mainSource).toContain('createMainWindow')
    expect(mainSource).toContain('createWorkspaceLauncherWindow')
    expect(mainSource).toContain('shell.openExternal')

    for (const filePath of productionSources) {
      const source = fs.readFileSync(filePath, 'utf8')
      expect(source).not.toContain('Jobright link resolver')
      expect(source).not.toContain('jobright_apply_redirect')
      expect(source).not.toContain('employer-site apply')
      expect(source).not.toContain('hidden Jobright')
      expect(source).not.toMatch(/partition:\s*['"`]persist:valedictorian-connector/)
      if (filePath !== isolatedNativeUiProofPath) {
        expect(source).not.toContain('executeJavaScript')
      }
      expect(source).not.toContain('Playwright')
      expect(source).not.toContain('Puppeteer')
      expect(source).not.toContain('WebView')
    }
  })

  it('does not embed sensitive Jobright credential or session values in production source', () => {
    const productionSources = collectProductionSources()

    for (const filePath of productionSources) {
      const source = fs.readFileSync(filePath, 'utf8')
      expect(source).not.toMatch(/SESSION_ID=[A-Za-z0-9._-]{8,}/)
      expect(source).not.toContain('demo@example.com')
      expect(source).not.toContain('synthetic-password')
      expect(source).not.toContain('synthetic-session-cookie')
    }
  })
})

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(relativePath), 'utf8')
}

function collectProductionSources() {
  const files: string[] = []
  for (const root of ['electron', 'src']) {
    walk(path.resolve(root), files)
  }
  return files
}

function walk(directory: string, files: string[]) {
  if (!fs.existsSync(directory)) {
    return
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory()) {
      if (
        entry.name === 'node_modules'
        || entry.name === 'dist'
        || entry.name === 'dist-electron'
        || entry.name === 'release'
      ) {
        continue
      }
      walk(fullPath, files)
      continue
    }

    if (!productionExtensions.has(path.extname(entry.name))) {
      continue
    }

    if (entry.name.includes('.test.')) {
      continue
    }

    files.push(fullPath)
  }
}
