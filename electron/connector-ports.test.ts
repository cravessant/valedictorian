import { describe, expect, it } from 'vitest'
import { createElectronConnectorPorts, type ElectronConnectorWindowOptions } from './connector-ports'

describe('Electron connector ports', () => {
  it('opens a persistent Jobright login window before marking browser-session auth ready', async () => {
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })

    const pendingGrant = ports.connectorAuth.browserSessions?.resolve({
      id: 'jobright',
      label: 'Jobright browser session',
      mode: 'browser_session',
      sessionKey: 'jobright-browser-session',
    })

    expect(windows).toHaveLength(1)
    expect(windows[0]?.options.show).toBe(true)
    expect(windows[0]?.options.webPreferences.partition).toBe(
      'persist:valedictorian-connector-workspace-1-jobright-browser-session',
    )
    expect(windows[0]?.loadedUrls).toEqual(['https://jobright.ai/login'])

    windows[0]?.emitClosed()

    await expect(pendingGrant).resolves.toEqual({
      id: 'jobright',
      mode: 'browser_session',
      sessionId: 'jobright-browser-session',
      sessionKey: 'jobright-browser-session',
      status: 'ready',
    })
  })

  it('resolves a Jobright intermediary URL through the persistent browser session', async () => {
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options, {
          officialUrl: 'https://example.com/jobs/software-engineering-intern',
          status: 'resolved',
        })
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: 'https://jobright.ai/jobs/info/job-123',
    })).resolves.toEqual({
      method: 'electron_browser_session',
      officialUrl: 'https://example.com/jobs/software-engineering-intern',
      status: 'resolved',
    })

    expect(windows).toHaveLength(1)
    expect(windows[0]?.options.show).toBe(false)
    expect(windows[0]?.options.webPreferences.partition).toBe(
      'persist:valedictorian-connector-workspace-1-jobright-browser-session',
    )
    expect(windows[0]?.loadedUrls).toEqual(['https://jobright.ai/jobs/info/job-123'])
    expect(windows[0]?.closed).toBe(true)
  })
})

class FakeConnectorWindow {
  readonly loadedUrls: string[] = []
  readonly webContents: FakeConnectorWebContents
  closed = false
  private readonly listeners = new Map<string, Array<() => void>>()
  private destroyed = false

  constructor(
    readonly options: ElectronConnectorWindowOptions,
    scriptResult: unknown = null,
  ) {
    this.webContents = new FakeConnectorWebContents(scriptResult)
  }

  async loadURL(url: string) {
    this.loadedUrls.push(url)
    this.webContents.currentUrl = url
  }

  on(event: string, listener: () => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener])
  }

  close() {
    this.closed = true
    this.emitClosed()
  }

  isDestroyed() {
    return this.destroyed
  }

  emitClosed() {
    this.closed = true
    this.destroyed = true
    for (const listener of this.listeners.get('closed') ?? []) {
      listener()
    }
  }
}

class FakeConnectorWebContents {
  currentUrl = 'about:blank'

  constructor(private readonly scriptResult: unknown) {}

  getURL() {
    return this.currentUrl
  }

  async executeJavaScript<T = unknown>() {
    return this.scriptResult as T
  }
}
