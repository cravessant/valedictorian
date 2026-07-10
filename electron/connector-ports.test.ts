import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createJobrightConnector } from '@sparxie/valedictorian-connectors-jobright'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { createStaticConnectorRegistry } from '../src/modules/connectors/connector.registry'
import type {
  AppConnectorAuthHost,
  AppConnectorRuntimePorts,
} from '../src/modules/connectors/connector.runner'
import {
  createLocalValedictorianClient,
  type LocalValedictorianClient,
} from '../src/runtime/local-valedictorian-client'
import { createElectronConnectorPorts, type ElectronConnectorWindowOptions } from './connector-ports'

describe('Electron connector ports', () => {
  it('keeps browser-session auth non-ready when the Jobright login window is closed', async () => {
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
    expect(windows[0]?.loadedUrls).toEqual(['https://jobright.ai'])

    await vi.waitFor(() => {
      expect(windows[0]?.webContents.executedScripts[0]).toContain('sign in')
    })

    windows[0]?.emitClosed()

    await expect(pendingGrant).resolves.toEqual({
      id: 'jobright',
      mode: 'browser_session',
      reason: 'browser_session_login_cancelled',
      status: 'action_required',
    })
  })

  it('marks browser-session auth ready only after Jobright verifies the session', async () => {
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      authProbeIntervalMs: 1,
      authSetupTimeoutMs: 100,
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options, true)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })

    let grant: unknown
    void ports.connectorAuth.browserSessions?.resolve({
      id: 'jobright',
      label: 'Jobright browser session',
      mode: 'browser_session',
      sessionKey: 'jobright-browser-session',
    }).then((result) => {
      grant = result
    })

    await vi.waitFor(() => {
      expect(grant).toEqual({
        id: 'jobright',
        mode: 'browser_session',
        sessionId: 'jobright-browser-session',
        sessionKey: 'jobright-browser-session',
        status: 'ready',
      })
    }, { timeout: 150 })
    expect(windows).toHaveLength(1)
    expect(windows[0]?.loadedUrls).toEqual(['https://jobright.ai'])
    expect(windows[0]?.closed).toBe(true)
  })

  it('blocks embedded Google sign-in and reports the supported-login limitation', async () => {
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      authProbeIntervalMs: 1,
      authSetupTimeoutMs: 100,
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options, false)
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

    expect(windows[0]?.webContents.openWindow(
      'https://accounts.google.com/gsi/select',
    )).toEqual({ action: 'deny' })
    await expect(pendingGrant).resolves.toEqual({
      id: 'jobright',
      mode: 'browser_session',
      reason: 'browser_session_google_sign_in_unsupported',
      status: 'action_required',
    })
    expect(windows[0]?.closed).toBe(true)
  })

  it('detects an expired Jobright session with a hidden non-interactive probe', async () => {
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(options, false)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorAuth.browserSessions?.validate?.({
      id: 'jobright',
      label: 'Jobright browser session',
      mode: 'browser_session',
      sessionKey: 'jobright-browser-session',
    })).resolves.toEqual({
      id: 'jobright',
      mode: 'browser_session',
      reason: 'browser_session_expired',
      status: 'expired',
    })
    expect(windows).toHaveLength(1)
    expect(windows[0]?.options.show).toBe(false)
    expect(windows[0]?.loadedUrls).toEqual(['https://jobright.ai'])
    expect(windows[0]?.closed).toBe(true)
  })

  it('returns a sanitized failure when Jobright session verification rejects', async () => {
    const windows: FakeConnectorWindow[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FakeConnectorWindow(
          options,
          new Error('sensitive account details from failed verification'),
        )
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })

    const grant = await ports.connectorAuth.browserSessions?.resolve({
      id: 'jobright',
      label: 'Jobright browser session',
      mode: 'browser_session',
      sessionKey: 'jobright-browser-session',
    })

    expect(grant).toEqual({
      id: 'jobright',
      mode: 'browser_session',
      reason: 'browser_session_verification_failed',
      status: 'action_required',
    })
    expect(JSON.stringify(grant)).not.toContain('sensitive account details')
    expect(JSON.stringify(grant)).not.toContain('jobright-browser-session')
    expect(windows[0]?.closed).toBe(true)
  })

  it('returns a typed failure when the Jobright login window cannot be created', async () => {
    const attemptedWindowOptions: ElectronConnectorWindowOptions[] = []
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        attemptedWindowOptions.push(options)
        throw new Error('sensitive login window construction failure')
      },
      sessionNamespace: 'workspace-1',
    })

    await expect(ports.connectorAuth.browserSessions?.resolve({
      id: 'jobright',
      label: 'Jobright browser session',
      mode: 'browser_session',
      sessionKey: 'jobright-browser-session',
    })).resolves.toEqual({
      id: 'jobright',
      mode: 'browser_session',
      reason: 'browser_session_login_failed',
      status: 'action_required',
    })
    expect(attemptedWindowOptions).toHaveLength(1)
    expect(attemptedWindowOptions[0]?.show).toBe(true)
  })

  it('bounds a stalled visible Jobright login navigation', async () => {
    vi.useFakeTimers()
    const windows: FakeConnectorWindow[] = []

    try {
      const ports = createElectronConnectorPorts({
        authSetupTimeoutMs: 2_000,
        createBrowserWindow(options) {
          const window = new StalledConnectorWindow(options)
          windows.push(window)
          return window
        },
        navigationTimeoutMs: 1_000,
        sessionNamespace: 'workspace-1',
      })
      const pendingGrant = ports.connectorAuth.browserSessions?.resolve({
        id: 'jobright',
        label: 'Jobright browser session',
        mode: 'browser_session',
        sessionKey: 'jobright-browser-session',
      })

      await vi.advanceTimersByTimeAsync(1_000)

      await expect(pendingGrant).resolves.toEqual({
        id: 'jobright',
        mode: 'browser_session',
        reason: 'browser_session_verification_timed_out',
        status: 'action_required',
      })
      expect(windows).toHaveLength(1)
      expect(windows[0]?.options.show).toBe(true)
      expect(windows[0]?.closed).toBe(true)
    } finally {
      vi.useRealTimers()
    }
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

  it('finishes an auth-blocked multi-job refresh without opening visible auth windows', async () => {
    const feedUrl = 'https://jobright.test/public-feed'
    const windows: FakeConnectorWindow[] = []
    const connector = createFixtureJobrightConnector(feedUrl)
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const dom = new JSDOM(
          '<main><div role="dialog"><h2>Sign Up to Apply</h2></div></main>',
          { runScripts: 'outside-only', url: 'https://jobright.ai/jobs/info/auth-required' },
        )
        const window = new FakeConnectorWindow(
          options,
          (script: string) => dom.window.eval(script),
        )
        windows.push(window)

        if (options.show) {
          queueMicrotask(() => window.emitClosed())
        }

        return window
      },
      sessionNamespace: 'workspace-1',
    })
    const client = createJobrightTestClient({
      connectorAuth: createVerifiedBrowserSessionAuth(),
      connector,
      connectorRuntime: {
        ...ports.connectorRuntime,
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-default',
      feedUrl,
      sessionKey: 'jobright-browser-session',
    })

    const { run, status } = await runJobrightFixture(client, 'jobright-default')

    expect(windows.filter((window) => window.options.show)).toHaveLength(0)
    expect(windows).toHaveLength(1)
    expect(run).toMatchObject({
      connectorInstanceId: 'jobright-default',
      observationCount: 3,
      retryHints: {
        authRequired: 3,
      },
    })
    expect(run.completedAt).not.toBeNull()
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({
          kind: 'auth',
          label: 'Reconnect',
        }),
      ],
      status: 'auth_required',
    })
  })

  it('fails closed and persists Reconnect when hidden Jobright resolution rejects', async () => {
    const feedUrl = 'https://jobright.test/rejected-resolution-feed'
    const windows: FakeConnectorWindow[] = []
    const connector = createFixtureJobrightConnector(feedUrl)
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        const window = new FailingConnectorWindow(options)
        windows.push(window)
        return window
      },
      sessionNamespace: 'workspace-1',
    })
    const client = createJobrightTestClient({
      connectorAuth: createVerifiedBrowserSessionAuth(),
      connector,
      connectorRuntime: {
        ...ports.connectorRuntime,
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-rejected-resolution',
      feedUrl,
      sessionKey: 'jobright-browser-session',
    })

    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-rejected-resolution',
    )

    expect(windows.filter((window) => window.options.show)).toHaveLength(0)
    expect(windows).toHaveLength(1)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 3,
      retryHints: {
        authRequired: 3,
      },
    })
    expect(persistedRuns).toMatchObject({
      items: [expect.objectContaining({ id: run.id })],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })

  it('circuits window-construction failure and persists Reconnect for three jobs', async () => {
    const feedUrl = 'https://jobright.test/window-construction-failure-feed'
    const attemptedWindowOptions: ElectronConnectorWindowOptions[] = []
    const connector = createFixtureJobrightConnector(feedUrl)
    const ports = createElectronConnectorPorts({
      createBrowserWindow(options) {
        attemptedWindowOptions.push(options)
        throw new Error('hidden Jobright window construction failed')
      },
      sessionNamespace: 'workspace-1',
    })
    const client = createJobrightTestClient({
      connectorAuth: createVerifiedBrowserSessionAuth(),
      connector,
      connectorRuntime: {
        ...ports.connectorRuntime,
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-window-construction-failure',
      feedUrl,
      sessionKey: 'jobright-browser-session',
    })

    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-window-construction-failure',
    )

    expect(attemptedWindowOptions).toHaveLength(1)
    expect(attemptedWindowOptions[0]?.show).toBe(false)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 3,
      retryHints: {
        authRequired: 3,
      },
    })
    expect(persistedRuns).toMatchObject({
      items: [expect.objectContaining({ id: run.id })],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })

  it('fails closed and persists Reconnect when the run resolver rejects directly', async () => {
    const feedUrl = 'https://jobright.test/direct-resolver-rejection-feed'
    let resolverAttempts = 0
    const connector = createFixtureJobrightConnector(feedUrl)
    const client = createJobrightTestClient({
      connectorAuth: createVerifiedBrowserSessionAuth(),
      connector,
      connectorRuntime: {
        browserSession: {
          async resolveLink() {
            resolverAttempts += 1
            throw new Error('direct browser-session resolver rejection')
          },
        },
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-direct-resolver-rejection',
      feedUrl,
      sessionKey: 'jobright-browser-session',
    })

    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-direct-resolver-rejection',
    )

    expect(resolverAttempts).toBe(1)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 3,
      retryHints: {
        authRequired: 3,
      },
    })
    expect(persistedRuns).toMatchObject({
      items: [expect.objectContaining({ id: run.id })],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })

  it('retains known-unusable auth across a later empty-feed run without reconnect', async () => {
    const feedUrl = 'https://jobright.test/two-run-unusable-session-feed'
    let feedRequests = 0
    let resolverAttempts = 0
    const connector = createJobrightConnector({
      fetch: async (input) => {
        const requestedUrl = typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url

        if (requestedUrl !== feedUrl) {
          return new Response('', { status: 404 })
        }

        feedRequests += 1
        return new Response(JSON.stringify(
          feedRequests === 1
            ? [{ companyName: 'Acme', jobId: 'job-1', roleTitle: 'Software Intern' }]
            : [],
        ), {
          headers: { 'content-type': 'application/json' },
        })
      },
      now: () => '2026-07-09T16:00:00.000Z',
    })
    const client = createJobrightTestClient({
      connectorAuth: createVerifiedBrowserSessionAuth(),
      connector,
      connectorRuntime: {
        browserSession: {
          async resolveLink() {
            resolverAttempts += 1
            return {
              reason: 'browser_session_action_required',
              status: 'auth_required',
            }
          },
        },
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-two-run-unusable-session',
      feedUrl,
      sessionKey: 'jobright-browser-session',
    })

    const first = await runJobrightFixture(client, 'jobright-two-run-unusable-session')
    const second = await runJobrightFixture(client, 'jobright-two-run-unusable-session')
    const instances = await client.connectors.list()

    expect(feedRequests).toBe(1)
    expect(resolverAttempts).toBe(1)
    expect(first.run).toMatchObject({
      observationCount: 1,
      retryHints: { authRequired: 1 },
    })
    expect(first.status).toMatchObject({
      actionRequired: [expect.objectContaining({ kind: 'auth', label: 'Reconnect' })],
      status: 'auth_required',
    })
    expect(second.run).toMatchObject({
      observationCount: 0,
      retryHints: {
        authRequired: 1,
        reason: 'browser_session_action_required',
      },
      status: 'partial_success',
    })
    expect(second.persistedRuns).toMatchObject({ total: 2 })
    expect(second.status).toMatchObject({
      actionRequired: [expect.objectContaining({ kind: 'auth', label: 'Reconnect' })],
      status: 'auth_required',
    })
    expect(instances.items[0]?.auth).toEqual([
      expect.objectContaining({ configured: false, id: 'jobright' }),
    ])
  })

  it('persists an actionable terminal run when the Jobright session handle is missing', async () => {
    const feedUrl = 'https://jobright.test/missing-session-feed'
    const windows: FakeConnectorWindow[] = []
    const connector = createFixtureJobrightConnector(feedUrl)
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
      connector,
      connectorRuntime: {
        ...ports.connectorRuntime,
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-missing-session',
      feedUrl,
    })

    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-missing-session',
    )

    expect(windows).toHaveLength(0)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 0,
      retryHints: {
        authRequired: 1,
      },
      status: 'partial_success',
    })
    expect(persistedRuns).toMatchObject({
      items: [
        expect.objectContaining({
          id: run.id,
          completedAt: '2026-07-09T16:00:00.000Z',
        }),
      ],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })

  it('preflights a missing Jobright session before an empty feed with no browser fallback', async () => {
    const feedUrl = 'https://jobright.test/empty-feed'
    const windows: FakeConnectorWindow[] = []
    let feedRequests = 0
    const connector = createJobrightConnector({
      fetch: async () => {
        feedRequests += 1
        return new Response('[]', {
          headers: { 'content-type': 'application/json' },
        })
      },
      now: () => '2026-07-09T16:00:00.000Z',
    })
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
      connector,
      connectorRuntime: ports.connectorRuntime,
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-empty-feed-missing-session',
      feedUrl,
    })

    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-empty-feed-missing-session',
    )

    expect(feedRequests).toBe(0)
    expect(windows).toHaveLength(0)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 0,
      retryHints: {
        authRequired: 1,
        reason: 'browser_session_action_required',
      },
      status: 'partial_success',
    })
    expect(persistedRuns).toMatchObject({
      items: [expect.objectContaining({ id: run.id })],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })

  it('persists an actionable terminal run after explicit Jobright login is cancelled', async () => {
    const feedUrl = 'https://jobright.test/cancelled-session-feed'
    const browserResolutionInputs: unknown[] = []
    const connector = createFixtureJobrightConnector(feedUrl)
    const client = createJobrightTestClient({
      connectorAuth: {
        browserSessions: {
          async resolve(reference) {
            return {
              id: reference.id,
              mode: reference.mode,
              reason: 'browser_session_login_cancelled',
              status: 'action_required',
            }
          },
        },
      },
      connector,
      connectorRuntime: {
        browserSession: {
          async resolveLink(input) {
            browserResolutionInputs.push(input)
            return {
              reason: 'browser_session_action_required',
              status: 'auth_required',
            }
          },
        },
        delay: immediateDelay,
      },
    })

    await registerJobrightFixture({
      client,
      connector,
      connectorInstanceId: 'jobright-cancelled-session',
      feedUrl,
      sessionKey: 'cancelled-jobright-session',
    })

    const reconnect = await client.connectors.status.reconnect({
      connectorInstanceId: 'jobright-cancelled-session',
    })
    const instances = await client.connectors.list()
    const { persistedRuns, run, status } = await runJobrightFixture(
      client,
      'jobright-cancelled-session',
    )

    expect(reconnect).toMatchObject({
      grants: [
        {
          id: 'jobright',
          reason: 'browser_session_login_cancelled',
          status: 'action_required',
        },
      ],
      status: 'action_required',
    })
    expect(instances.items[0]?.auth).toEqual([
      expect.objectContaining({
        configured: false,
        id: 'jobright',
      }),
    ])
    expect(browserResolutionInputs).toHaveLength(0)
    expect(run).toMatchObject({
      completedAt: '2026-07-09T16:00:00.000Z',
      observationCount: 0,
      retryHints: {
        authRequired: 1,
      },
      status: 'partial_success',
    })
    expect(persistedRuns).toMatchObject({
      items: [
        expect.objectContaining({
          id: run.id,
          completedAt: '2026-07-09T16:00:00.000Z',
        }),
      ],
      total: 1,
    })
    expect(status).toMatchObject({
      actionRequired: [
        expect.objectContaining({ kind: 'auth', label: 'Reconnect' }),
      ],
      status: 'auth_required',
    })
  })
})

type FixtureJobrightConnector = ReturnType<typeof createJobrightConnector>

function createFixtureJobrightConnector(feedUrl: string): FixtureJobrightConnector {
  return createJobrightConnector({
    fetch: createJobrightFixtureFetch(feedUrl),
    now: () => '2026-07-09T16:00:00.000Z',
  })
}

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
  feedUrl,
  sessionKey,
}: {
  client: LocalValedictorianClient
  connector: FixtureJobrightConnector
  connectorInstanceId: string
  feedUrl: string
  sessionKey?: string
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
        label: 'Jobright browser session',
        mode: 'browser_session',
        ...(sessionKey ? { sessionKey } : {}),
      },
    ],
    config: { publicFeedUrl: feedUrl },
    filters: {
      maxResolutionCount: 3,
      roleTerms: ['intern'],
    },
  })
}

async function runJobrightFixture(
  client: LocalValedictorianClient,
  connectorInstanceId: string,
) {
  const run = await client.connectors.runs.trigger({
    connectorInstanceId,
    coverageStartedAt: '2026-07-09T15:00:00.000Z',
    coverageEndedAt: '2026-07-09T16:00:00.000Z',
    mode: 'manual',
  })
  const persistedRuns = await client.connectors.runs.list({ connectorInstanceId })
  const status = await client.connectors.inspect(connectorInstanceId)

  return { persistedRuns, run, status }
}

const immediateDelay = {
  async wait() {
    return 0
  },
}

function createVerifiedBrowserSessionAuth(): AppConnectorAuthHost {
  return {
    browserSessions: {
      async resolve(reference) {
        return {
          id: reference.id,
          mode: reference.mode,
          reason: 'browser_session_interactive_auth_not_expected',
          status: 'action_required',
        }
      },
      async validate(reference) {
        return {
          id: reference.id,
          mode: reference.mode,
          sessionId: reference.sessionKey,
          sessionKey: reference.sessionKey,
          status: 'ready',
        }
      },
    },
  }
}

function createJobrightFixtureFetch(feedUrl: string): typeof fetch {
  return async (input) => {
    const requestedUrl = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url

    if (requestedUrl === feedUrl) {
      return new Response(JSON.stringify([
        { companyName: 'Acme', jobId: 'job-1', roleTitle: 'Software Intern' },
        { companyName: 'Beta', jobId: 'job-2', roleTitle: 'Platform Intern' },
        { companyName: 'Gamma', jobId: 'job-3', roleTitle: 'Security Intern' },
      ]), {
        headers: { 'content-type': 'application/json' },
      })
    }

    return new Response('', { status: 404 })
  }
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

class FailingConnectorWindow extends FakeConnectorWindow {
  override async loadURL(url: string): Promise<never> {
    this.loadedUrls.push(url)
    throw new Error('hidden Jobright resolution failed')
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
