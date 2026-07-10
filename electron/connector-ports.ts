import {
  createJitterDelayRuntime,
  type DefaultLocalConnectorPorts,
} from '../src/modules/connectors/connector.runtime-ports'
import { resolveJobrightLink } from './jobright-link-resolver'

export interface ElectronConnectorWindowOptions {
  show: boolean
  title: string
  width: number
  height: number
  webPreferences: {
    contextIsolation: boolean
    nodeIntegration: boolean
    partition: string
    sandbox: boolean
  }
}

export interface ElectronConnectorWindow {
  webContents?: {
    executeJavaScript<T = unknown>(script: string, userGesture?: boolean): Promise<T>
    getURL(): string
    on?: (
      event: 'will-navigate',
      listener: (event: { preventDefault?: () => void }, url: string) => void
    ) => unknown
    setWindowOpenHandler?: (
      handler: (details: { url: string }) => { action: 'allow' | 'deny' }
    ) => void
  }
  loadURL(url: string): Promise<unknown>
  on(event: 'closed', listener: () => void): unknown
  close?: () => void
  isDestroyed?: () => boolean
}

export interface CreateElectronConnectorPortsOptions {
  createBrowserWindow: (options: ElectronConnectorWindowOptions) => ElectronConnectorWindow
  navigationTimeoutMs?: number
  now?: () => Date
  sessionNamespace: string
}

const defaultNavigationTimeoutMs = 15_000

export function createElectronConnectorPorts({
  createBrowserWindow,
  navigationTimeoutMs = defaultNavigationTimeoutMs,
  now = () => new Date(),
  sessionNamespace,
}: CreateElectronConnectorPortsOptions): DefaultLocalConnectorPorts {
  return {
    connectorAuth: {},
    connectorRuntime: {
      browserSession: {
        async resolveLink(input) {
          if (input.source !== 'jobright') {
            return {
              method: 'electron_browser_session',
              officialUrl: null,
              reason: 'browser_session_source_not_supported',
              status: 'unresolved',
            }
          }

          return resolveJobrightLink({
            createResolverWindow: () => createBrowserWindow({
              height: 760,
              show: false,
              title: 'Jobright link resolver',
              webPreferences: createSessionWebPreferences(sessionNamespace, input.sessionId),
              width: 1100,
            }),
            input,
            navigationTimeoutMs,
            now,
          })
        },
      },
      delay: createJitterDelayRuntime(),
    },
  }
}

function createSessionWebPreferences(sessionNamespace: string, sessionKey: string) {
  return {
    contextIsolation: true,
    nodeIntegration: false,
    partition: createPersistentPartition(sessionNamespace, sessionKey),
    sandbox: true,
  }
}

function createPersistentPartition(sessionNamespace: string, sessionKey: string) {
  return [
    'persist:valedictorian-connector',
    sanitizePartitionSegment(sessionNamespace),
    sanitizePartitionSegment(sessionKey),
  ].join('-')
}

function sanitizePartitionSegment(value: string) {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-')

  return normalized.length > 0 ? normalized : 'default'
}
