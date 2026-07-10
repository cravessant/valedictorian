import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { createDrizzleDatabase, createFileDatabase } from '../src/db/sqlite'
import { createStaticConnectorRegistry } from '../src/modules/connectors/connector.registry'
import type {
  AppConnectorAuthHost,
  AppConnectorRuntimePorts,
} from '../src/modules/connectors/connector.runner'
import { createSqliteProfileRepository } from '../src/modules/profile/profile.repository'
import {
  createLocalValedictorianClient,
  type LocalValedictorianClient,
} from '../src/runtime/local-valedictorian-client'
import { createElectronConnectorPorts, type ElectronConnectorWindowOptions } from './connector-ports'

describe('Electron connector ports', () => {
  it('does not open Jobright login or validation windows for connector auth', async () => {
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })

    expect(ports.connectorAuth).toEqual({})
    expect(ports.connectorAuth.browserSessions).toBeUndefined()
    expect(windows).toHaveLength(0)
    const portsSource = fs.readFileSync(path.resolve('electron/connector-ports.ts'), 'utf8')
    expect(portsSource).not.toContain('jobrightAuthProbeScript')
    expect(portsSource).not.toContain('Jobright session verifier')
    expect(portsSource).not.toContain('Connector login')
    expect(portsSource).not.toContain('createUnavailableConnectorAuthHost')
    expect(portsSource).toContain('resolveJobrightLink')
  })

  it('resolves a Jobright intermediary URL through the persistent browser session', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/job-123?utm_source=test'
    const destinationUrl = 'https://boards.greenhouse.io/example/jobs/12345?gh_jid=12345#apply'
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new RedirectingConnectorWindow(options, destinationUrl)
        windows.push(window)
        return window
      },
      now: () => new Date('2026-07-10T00:58:00.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T00:58:00.000Z',
          sourceUrl: 'https://jobright.ai/jobs/info/job-123',
          type: 'jobright_apply_redirect',
        },
        {
          capturedAt: '2026-07-10T00:58:00.000Z',
          sourceUrl: 'https://boards.greenhouse.io/example/jobs/12345',
          type: 'jobright_apply_destination_accepted',
        },
      ],
      method: 'jobright_apply_redirect',
      officialUrl: destinationUrl,
      status: 'resolved',
    })

    expect(windows).toHaveLength(1)
    expect(windows[0]?.options.show).toBe(false)
    expect(windows[0]?.options.webPreferences.partition).toBe(
      'persist:valedictorian-connector-workspace-1-jobright-browser-session',
    )
    expect(windows[0]?.loadedUrls).toEqual([sourceUrl])
    expect(windows[0]?.closed).toBe(true)
  })

  it('never promotes a social profile as the official application URL', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/job-social-first'
    const destinationUrl = 'https://www.linkedin.com/company/example-robotics'
    const ports = createElectronConnectorPorts({
      createBrowserWindow: (options) => new RedirectingConnectorWindow(options, destinationUrl),
      now: () => new Date('2026-07-10T00:59:00.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T00:59:00.000Z',
          sourceUrl,
          type: 'jobright_apply_redirect',
        },
        {
          capturedAt: '2026-07-10T00:59:00.000Z',
          sourceUrl: destinationUrl,
          type: 'jobright_apply_destination_rejected',
        },
      ],
      method: 'jobright_apply_redirect',
      officialUrl: null,
      reason: 'jobright_apply_destination_unverified',
      status: 'unresolved',
    })
  })

  it('never promotes a company marketing page as the official application URL', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/job-marketing-page'
    const destinationUrl = 'https://example.com/blog/job/interview-tips'
    const ports = createElectronConnectorPorts({
      createBrowserWindow: (options) => new RedirectingConnectorWindow(options, destinationUrl),
      now: () => new Date('2026-07-10T00:59:30.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T00:59:30.000Z',
          sourceUrl,
          type: 'jobright_apply_redirect',
        },
        {
          capturedAt: '2026-07-10T00:59:30.000Z',
          sourceUrl: destinationUrl,
          type: 'jobright_apply_destination_rejected',
        },
      ],
      method: 'jobright_apply_redirect',
      officialUrl: null,
      reason: 'jobright_apply_destination_unverified',
      status: 'unresolved',
    })
  })

  it('resolves only the destination opened by the Jobright employer-site apply action', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/job-apply-action'
    const destinationUrl = 'https://boards.greenhouse.io/example/jobs/12345'
    const dom = new JSDOM(`
      <main>
        <a href="https://www.linkedin.com/company/example-robotics">Company LinkedIn</a>
        <section>
          <span>Apply on Employer Site</span>
          <button type="button">APPLY NOW</button>
        </section>
      </main>
    `, {
      runScripts: 'outside-only',
      url: sourceUrl,
    })
    let resolverWindow: FakeConnectorWindow | undefined
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(
          options,
          (script: string) => dom.window.eval(script),
        )
        dom.window.document.querySelector('button')?.addEventListener('click', () => {
          window.webContents.openWindow(destinationUrl)
        })
        resolverWindow = window
        return window
      },
      now: () => new Date('2026-07-10T01:00:00.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T01:00:00.000Z',
          sourceUrl,
          type: 'jobright_apply_action',
        },
        {
          capturedAt: '2026-07-10T01:00:00.000Z',
          sourceUrl: destinationUrl,
          type: 'jobright_apply_destination_accepted',
        },
      ],
      method: 'jobright_apply_action',
      officialUrl: destinationUrl,
      status: 'resolved',
    })
    expect(resolverWindow?.webContents.executedScriptUserGestures).toEqual([
      undefined,
      true,
    ])
  })

  it('ignores unrelated external navigation captured before the apply action', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/job-pre-activation-navigation'
    const unrelatedUrl = 'https://boards.greenhouse.io/unrelated/jobs/99999'
    const dom = new JSDOM(`
      <main>
        <section><span>Apply on Employer Site</span><button>APPLY NOW</button></section>
      </main>
    `, {
      runScripts: 'outside-only',
      url: sourceUrl,
    })
    const ports = createElectronConnectorPorts({
      createBrowserWindow: (options) => new PreActivationPopupWindow(
        options,
        (script: string) => dom.window.eval(script),
        unrelatedUrl,
      ),
      navigationTimeoutMs: 10,
      now: () => new Date('2026-07-10T01:00:30.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T01:00:30.000Z',
          sourceUrl,
          type: 'jobright_apply_destination_missing',
        },
      ],
      method: 'jobright_apply_action',
      officialUrl: null,
      reason: 'jobright_apply_destination_missing',
      status: 'unresolved',
    })
  })

  it('captures a same-window navigation emitted by the apply action', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/job-same-window-navigation'
    const destinationUrl = 'https://jobs.lever.co/example/12345678-abcd'
    const dom = new JSDOM(`
      <main>
        <section><span>Apply on Employer Site</span><button>APPLY NOW</button></section>
      </main>
    `, {
      runScripts: 'outside-only',
      url: sourceUrl,
    })
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(
          options,
          (script: string) => dom.window.eval(script),
        )
        dom.window.document.querySelector('button')?.addEventListener('click', () => {
          window.webContents.navigate(destinationUrl)
        })
        return window
      },
      now: () => new Date('2026-07-10T01:00:45.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T01:00:45.000Z',
          sourceUrl,
          type: 'jobright_apply_action',
        },
        {
          capturedAt: '2026-07-10T01:00:45.000Z',
          sourceUrl: destinationUrl,
          type: 'jobright_apply_destination_accepted',
        },
      ],
      method: 'jobright_apply_action',
      officialUrl: destinationUrl,
      status: 'resolved',
    })
  })

  it('waits for the client-rendered employer-site apply action before resolving', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/job-delayed-action'
    const destinationUrl = 'https://boards.greenhouse.io/example/jobs/12345'
    const dom = new JSDOM(`
      <main>
        <a href="https://www.linkedin.com/company/example">Company LinkedIn</a>
        <p>Loading job details...</p>
      </main>
    `, {
      runScripts: 'outside-only',
      url: sourceUrl,
    })
    let detailChecks = 0
    let resolverWindow: FakeConnectorWindow | undefined
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options, (script: string) => {
          if (script.includes('jobright_apply_action_not_ready')) {
            detailChecks += 1

            if (detailChecks === 2) {
              dom.window.document.querySelector('main')?.insertAdjacentHTML('beforeend', `
                <section>
                  <span>Apply on Employer Site</span>
                  <button type="button">APPLY NOW</button>
                </section>
              `)
              dom.window.document.querySelector('button')?.addEventListener('click', () => {
                window.webContents.openWindow(destinationUrl)
              })
            }
          }

          return dom.window.eval(script)
        })
        resolverWindow = window
        return window
      },
      navigationTimeoutMs: 500,
      now: () => new Date('2026-07-10T01:01:00.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toMatchObject({
      method: 'jobright_apply_action',
      officialUrl: destinationUrl,
      status: 'resolved',
    })
    expect(detailChecks).toBe(2)
    expect(resolverWindow?.options.show).toBe(false)
  })

  it('reports an auth prompt immediately after the apply action without waiting for timeout', async () => {
    vi.useFakeTimers()
    const sourceUrl = 'https://jobright.ai/jobs/info/job-auth-required'
    const dom = new JSDOM(`
      <main>
        <section>
          <span>Apply on Employer Site</span>
          <button type="button">APPLY NOW</button>
        </section>
      </main>
    `, {
      runScripts: 'outside-only',
      url: sourceUrl,
    })

    try {
      const ports = createElectronConnectorPorts({
        createBrowserWindow(options) {
          const window = new FakeConnectorWindow(
            options,
            (script: string) => dom.window.eval(script),
          )
          dom.window.document.querySelector('button')?.addEventListener('click', () => {
            dom.window.document.body.insertAdjacentHTML(
              'beforeend',
              '<div role="dialog"><h2>Sign Up to Apply</h2></div>',
            )
          })
          return window
        },
        navigationTimeoutMs: 1_000,
        now: () => new Date('2026-07-10T01:02:00.000Z'),
        sessionNamespace: 'workspace-1',
      })
      let resolution: unknown
      void ports.connectorRuntime.browserSession?.resolveLink({
        sessionId: 'jobright-browser-session',
        source: 'jobright',
        url: sourceUrl,
      }).then((value) => {
        resolution = value
      })

      await vi.advanceTimersByTimeAsync(100)

      expect(resolution).toEqual({
        evidence: [
          {
            capturedAt: '2026-07-10T01:02:00.000Z',
            sourceUrl,
            type: 'browser_session_action_required',
          },
        ],
        method: 'jobright_apply_action',
        officialUrl: null,
        reason: 'browser_session_action_required',
        status: 'auth_required',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    {
      name: 'captcha challenge',
      body: '<main><p>Verify you are human to continue</p></main>',
      reason: 'jobright_captcha_required',
      status: 'captcha',
    },
    {
      name: 'unavailable job',
      body: '<main><p>This job is no longer available</p></main>',
      reason: 'jobright_job_closed',
      status: 'closed',
    },
    {
      name: 'current public closed job',
      body: '<main><p>This job has closed.</p></main>',
      reason: 'jobright_job_closed',
      status: 'closed',
    },
    {
      name: 'stylesheet-hidden apply action',
      body: `
        <style>.hidden-apply { display: none; }</style>
        <main>
          <section class="hidden-apply">
            <span>Apply on Employer Site</span>
            <button type="button">APPLY NOW</button>
          </section>
        </main>
      `,
      reason: 'jobright_apply_action_hidden',
      status: 'hidden',
    },
  ] as const)('fails closed for a current-shaped Jobright $name', async ({
    body,
    reason,
    status,
  }) => {
    const sourceUrl = `https://jobright.ai/jobs/info/job-${status}`
    const dom = new JSDOM(body, {
      runScripts: 'outside-only',
      url: sourceUrl,
    })
    const ports = createElectronConnectorPorts({
      createBrowserWindow: (options) => new FakeConnectorWindow(
        options,
        (script: string) => dom.window.eval(script),
      ),
      navigationTimeoutMs: 50,
      now: () => new Date('2026-07-10T01:03:00.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T01:03:00.000Z',
          sourceUrl,
          type: reason,
        },
      ],
      method: 'jobright_apply_action',
      officialUrl: null,
      reason,
      status,
    })
  })

  it('fails closed with a stable reason when employer-site actions are ambiguous', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/job-ambiguous'
    const dom = new JSDOM(`
      <main>
        <section><span>Apply on Employer Site</span><button>APPLY NOW</button></section>
        <section><span>Apply on Employer Site</span><button>APPLY NOW</button></section>
      </main>
    `, {
      runScripts: 'outside-only',
      url: sourceUrl,
    })
    const ports = createElectronConnectorPorts({
      createBrowserWindow: (options) => new FakeConnectorWindow(
        options,
        (script: string) => dom.window.eval(script),
      ),
      now: () => new Date('2026-07-10T01:04:00.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T01:04:00.000Z',
          sourceUrl,
          type: 'jobright_apply_action_ambiguous',
        },
      ],
      method: 'jobright_apply_action',
      officialUrl: null,
      reason: 'jobright_apply_action_ambiguous',
      status: 'unresolved',
    })
  })

  it('bounds a missing employer-site action with a stable unresolved reason', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/job-action-missing'
    const dom = new JSDOM(`
      <main>
        <a href="https://example.com/careers">Company careers</a>
        <p>Job details loaded without an application action.</p>
      </main>
    `, {
      runScripts: 'outside-only',
      url: sourceUrl,
    })
    const ports = createElectronConnectorPorts({
      createBrowserWindow: (options) => new FakeConnectorWindow(
        options,
        (script: string) => dom.window.eval(script),
      ),
      navigationTimeoutMs: 10,
      now: () => new Date('2026-07-10T01:04:30.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T01:04:30.000Z',
          sourceUrl,
          type: 'jobright_apply_action_not_ready',
        },
      ],
      method: 'jobright_apply_action',
      officialUrl: null,
      reason: 'jobright_apply_action_not_ready',
      status: 'unresolved',
    })
  })

  it('records sanitized rejection evidence for an analytics destination', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/job-analytics-redirect?utm_source=test'
    const destinationUrl = 'https://www.google-analytics.com/collect/job?token=secret#result'
    const dom = new JSDOM(`
      <main>
        <section><span>Apply on Employer Site</span><button>APPLY NOW</button></section>
      </main>
    `, {
      runScripts: 'outside-only',
      url: sourceUrl,
    })
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(
          options,
          (script: string) => dom.window.eval(script),
        )
        dom.window.document.querySelector('button')?.addEventListener('click', () => {
          window.webContents.openWindow(destinationUrl)
        })
        return window
      },
      now: () => new Date('2026-07-10T01:05:00.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T01:05:00.000Z',
          sourceUrl: 'https://jobright.ai/jobs/info/job-analytics-redirect',
          type: 'jobright_apply_action',
        },
        {
          capturedAt: '2026-07-10T01:05:00.000Z',
          sourceUrl: 'https://www.google-analytics.com/collect/job',
          type: 'jobright_apply_destination_rejected',
        },
      ],
      method: 'jobright_apply_action',
      officialUrl: null,
      reason: 'jobright_apply_destination_unverified',
      status: 'unresolved',
    })
  })

  it('bounds a stalled hidden Jobright navigation and reports auth required', async () => {
    vi.useFakeTimers()
    const windows: FakeConnectorWindow[] = []

    try {
      const ports = createElectronConnectorPorts({
        createBrowserWindow(options) {
          const window = new StalledConnectorWindow(options)
          windows.push(window)
          return window
        },
        navigationTimeoutMs: 1_000,
        sessionNamespace: 'workspace-1',
      })
      const pendingResolution = ports.connectorRuntime.browserSession?.resolveLink({
        sessionId: 'jobright-browser-session',
        source: 'jobright',
        url: 'https://jobright.ai/jobs/info/stalled-job',
      })

      await vi.advanceTimersByTimeAsync(1_000)

      await expect(pendingResolution).resolves.toEqual({
        method: 'electron_browser_session',
        officialUrl: null,
        reason: 'browser_session_navigation_timed_out',
        status: 'auth_required',
      })
      expect(windows).toHaveLength(1)
      expect(windows[0]?.options.show).toBe(false)
      expect(windows[0]?.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a stalled hidden Jobright script and reports auth required', async () => {
    vi.useFakeTimers()
    const windows: FakeConnectorWindow[] = []

    try {
      const ports = createElectronConnectorPorts({
        createBrowserWindow(options) {
          const window = new FakeConnectorWindow(
            options,
            new Promise<never>(() => undefined),
          )
          windows.push(window)
          return window
        },
        navigationTimeoutMs: 1_000,
        sessionNamespace: 'workspace-1',
      })
      let resolution: unknown
      void ports.connectorRuntime.browserSession?.resolveLink({
        sessionId: 'jobright-browser-session',
        source: 'jobright',
        url: 'https://jobright.ai/jobs/info/stalled-script-job',
      }).then((value) => {
        resolution = value
      })

      await vi.advanceTimersByTimeAsync(1_000)

      expect(resolution).toEqual({
        method: 'electron_browser_session',
        officialUrl: null,
        reason: 'browser_session_script_timed_out',
        status: 'auth_required',
      })
      expect(windows).toHaveLength(1)
      expect(windows[0]?.options.show).toBe(false)
      expect(windows[0]?.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('bounds a stalled page-state script after activating the employer-site action', async () => {
    const sourceUrl = 'https://jobright.ai/jobs/info/stalled-after-apply'
    const dom = new JSDOM(`
      <main>
        <section><span>Apply on Employer Site</span><button>APPLY NOW</button></section>
      </main>
    `, {
      runScripts: 'outside-only',
      url: sourceUrl,
    })
    let scriptCalls = 0
    const ports = createElectronConnectorPorts({
      createBrowserWindow: (options) => new FakeConnectorWindow(options, (script: string) => {
        scriptCalls += 1
        return scriptCalls >= 3
          ? new Promise<never>(() => undefined)
          : dom.window.eval(script)
      }),
      navigationTimeoutMs: 10,
      now: () => new Date('2026-07-10T01:06:00.000Z'),
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: sourceUrl,
    })).resolves.toEqual({
      evidence: [
        {
          capturedAt: '2026-07-10T01:06:00.000Z',
          sourceUrl,
          type: 'browser_session_script_timed_out',
        },
      ],
      method: 'jobright_apply_action',
      officialUrl: null,
      reason: 'browser_session_script_timed_out',
      status: 'auth_required',
    })
  })

  it('reports auth required when the hidden Jobright window cannot be created', async () => {
    const attemptedWindowOptions: ElectronConnectorWindowOptions[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        attemptedWindowOptions.push(options)
        throw new Error('hidden Jobright window construction failed')
      },
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorRuntime.browserSession?.resolveLink({
      sessionId: 'jobright-browser-session',
      source: 'jobright',
      url: 'https://jobright.ai/jobs/info/window-construction-failure',
    })).resolves.toEqual({
      method: 'electron_browser_session',
      officialUrl: null,
      reason: 'browser_session_resolution_failed',
      status: 'auth_required',
    })
    expect(attemptedWindowOptions).toHaveLength(1)
    expect(attemptedWindowOptions[0]?.show).toBe(false)
  })

  it('validates Jobright API credentials without opening browser windows or recording runs', async () => {
    const windows: FakeConnectorWindow[] = []
    const sqlitePath = createTempSqlitePath()
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })
    const secretCodec = {
      decrypt: (value: string) => value.replace(/^enc:/, ''),
      encrypt: (value: string) => `enc:${value}`,
    }
    const client = createLocalValedictorianClient({
      connectorAuth: ports.connectorAuth,
      connectorRegistry: createStaticConnectorRegistry([createJobrightConnector({
        fetch: async (input, init) => {
          const url = typeof input === 'string'
            ? input
            : input instanceof URL
              ? input.href
              : input.url
          const body = typeof init?.body === 'string' ? init.body : ''

          if (url.includes('/swan/auth/login/pwd')) {
            expect(body).toContain('demo@example.com')
            expect(body).toContain(' pass with spaces ')
            return new Response(JSON.stringify({ success: true, result: {} }), {
              headers: {
                'content-type': 'application/json',
                'set-cookie': 'SESSION_ID=session-cookie; Path=/',
              },
              status: 200,
            })
          }

          if (url.includes('/swan/auth/newinfo')) {
            return new Response(JSON.stringify({
              success: true,
              result: { logined: true },
            }), {
              headers: { 'content-type': 'application/json' },
              status: 200,
            })
          }

          throw new Error(`Unexpected fetch: ${url}`)
        },
      })]),
      connectorRuntime: ports.connectorRuntime,
      now: () => new Date('2026-07-09T16:00:00.000Z'),
      secretCodec,
      sqlitePath,
      workspaceId: 'workspace-1',
    })
    const database = createDrizzleDatabase(createFileDatabase(sqlitePath))
    const profileRepository = createSqliteProfileRepository(database, secretCodec)

    await profileRepository.upsertSecret({
      key: 'connector_jobright_credentials_jobright_default',
      kind: 'password',
      label: 'Jobright username and password',
      value: JSON.stringify({
        username: 'demo@example.com',
        password: ' pass with spaces ',
      }),
    })
    await client.connectors.create({
      id: 'jobright-default',
      connectorId: 'jobright.resolver',
      connectorVersion: '0.4.1',
      displayName: 'Jobright internslist',
      enabled: true,
      auth: [{
        id: 'jobright',
        label: 'Jobright username and password',
        mode: 'username_password',
        secretKey: 'connector_jobright_credentials_jobright_default',
      }],
      config: {},
      filters: {
        maxResolutionCount: 3,
        roleTerms: ['intern'],
      },
    })

    const reconnect = await client.connectors.status.reconnect({
      connectorInstanceId: 'jobright-default',
    })
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'jobright-default',
      limit: 10,
    })
    const observations = await client.connectors.observations.list({
      connectorInstanceId: 'jobright-default',
    })
    const checkpoints = await client.connectors.checkpoints.list({
      connectorInstanceId: 'jobright-default',
    })

    expect(windows).toHaveLength(0)
    expect(reconnect).toMatchObject({
      action: 'reconnect',
      connectorInstanceId: 'jobright-default',
      reason: 'jobright_auth_ready',
      status: 'ready',
    })
    expect(runs.total).toBe(0)
    expect(observations.total).toBe(0)
    expect(checkpoints.items).toEqual([])
    expect(JSON.stringify(reconnect)).not.toContain('demo@example.com')
    expect(JSON.stringify(reconnect)).not.toContain(' pass with spaces ')
    expect(JSON.stringify(reconnect)).not.toContain('session-cookie')
  })

  it('returns missing credentials for Jobright validateAuth without browser fallback', async () => {
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })
    const client = createJobrightTestClient({
      connectorAuth: ports.connectorAuth,
      connector: createJobrightConnector(),
      connectorRuntime: ports.connectorRuntime,
    })

    await registerJobrightFixture({
      client,
      connector: createJobrightConnector(),
      connectorInstanceId: 'jobright-missing-credentials',
    })

    const reconnect = await client.connectors.status.reconnect({
      connectorInstanceId: 'jobright-missing-credentials',
    })
    const runs = await client.connectors.runs.list({
      connectorInstanceId: 'jobright-missing-credentials',
      limit: 10,
    })

    expect(windows).toHaveLength(0)
    expect(reconnect).toMatchObject({
      action: 'reconnect',
      connectorInstanceId: 'jobright-missing-credentials',
      status: 'missing',
    })
    expect(runs.total).toBe(0)
  })

})

type FixtureJobrightConnector = ReturnType<typeof createJobrightConnector>

function createJobrightTestClient({
  connector,
  connectorAuth,
  connectorRuntime,
}: {
  connector: FixtureJobrightConnector
  connectorAuth?: AppConnectorAuthHost
  connectorRuntime?: AppConnectorRuntimePorts
}): LocalValedictorianClient {
  return createLocalValedictorianClient({
    connectorAuth,
    connectorRegistry: createStaticConnectorRegistry([connector]),
    connectorRuntime,
    now: () => new Date('2026-07-09T16:00:00.000Z'),
    sqlitePath: createTempSqlitePath(),
    workspaceId: 'workspace-1',
  })
}

async function registerJobrightFixture({
  client,
  connector,
  connectorInstanceId,
  feedUrl: _feedUrl,
  sessionKey: _sessionKey,
  secretKey = `connector_jobright_credentials_${connectorInstanceId.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`,
}: {
  client: LocalValedictorianClient
  connector: FixtureJobrightConnector
  connectorInstanceId: string
  feedUrl?: string
  sessionKey?: string
  secretKey?: string
}) {
  await client.connectors.create({
    id: connectorInstanceId,
    connectorId: connector.definition.id,
    connectorVersion: connector.definition.version,
    displayName: `Jobright ${connectorInstanceId}`,
    enabled: true,
    auth: [
      {
        id: 'jobright',
        label: 'Jobright username and password',
        mode: 'username_password',
        secretKey,
      },
    ],
    config: {},
    filters: {
      maxResolutionCount: 3,
      roleTerms: ['intern'],
    },
  })
}

function createTempSqlitePath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-jobright-')),
    'valedictorian.sqlite',
  )
}

class FakeConnectorWindow {
  readonly loadedUrls: string[] = []
  readonly webContents: FakeConnectorWebContents
  closed = false
  private readonly listeners = new Map<string, Array<() => void>>()
  private destroyed = false

  constructor(
    readonly options: ElectronConnectorWindowOptions,
    scriptResult: FakeScriptResult = null,
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

type FakeScriptResult =
  | ((script: string) => unknown)
  | boolean
  | Error
  | Promise<unknown>
  | null

class StalledConnectorWindow extends FakeConnectorWindow {
  override async loadURL(url: string): Promise<never> {
    this.loadedUrls.push(url)
    return new Promise<never>(() => undefined)
  }
}

class RedirectingConnectorWindow extends FakeConnectorWindow {
  constructor(
    options: ElectronConnectorWindowOptions,
    private readonly destinationUrl: string,
  ) {
    super(options)
  }

  override async loadURL(url: string) {
    this.loadedUrls.push(url)
    this.webContents.currentUrl = this.destinationUrl
  }
}

class PreActivationPopupWindow extends FakeConnectorWindow {
  constructor(
    options: ElectronConnectorWindowOptions,
    scriptResult: FakeScriptResult,
    private readonly popupUrl: string,
  ) {
    super(options, scriptResult)
  }

  override async loadURL(url: string) {
    await super.loadURL(url)
    this.webContents.openWindow(this.popupUrl)
  }
}

class FakeConnectorWebContents {
  currentUrl = 'about:blank'
  readonly executedScripts: string[] = []
  readonly executedScriptUserGestures: Array<boolean | undefined> = []
  private windowOpenHandler: ((details: { url: string }) => { action: 'allow' | 'deny' }) | undefined
  private readonly willNavigateListeners: Array<(
    event: { preventDefault?: () => void },
    url: string,
  ) => void> = []

  constructor(private readonly scriptResult: FakeScriptResult) {}

  getURL() {
    return this.currentUrl
  }

  async executeJavaScript<T = unknown>(script: string, userGesture?: boolean) {
    this.executedScripts.push(script)
    this.executedScriptUserGestures.push(userGesture)

    if (typeof this.scriptResult === 'function') {
      return await this.scriptResult(script) as T
    }

    if (this.scriptResult instanceof Error) {
      throw this.scriptResult
    }

    return this.scriptResult as T
  }

  setWindowOpenHandler(
    handler: (details: { url: string }) => { action: 'allow' | 'deny' },
  ) {
    this.windowOpenHandler = handler
  }

  openWindow(url: string) {
    return this.windowOpenHandler?.({ url }) ?? { action: 'allow' as const }
  }

  on(
    event: 'will-navigate',
    listener: (event: { preventDefault?: () => void }, url: string) => void,
  ) {
    if (event === 'will-navigate') {
      this.willNavigateListeners.push(listener)
    }
  }

  navigate(url: string) {
    let prevented = false
    const event = {
      preventDefault() {
        prevented = true
      },
    }

    for (const listener of this.willNavigateListeners) {
      listener(event, url)
    }

    if (!prevented) {
      this.currentUrl = url
    }
  }
}
