import type { PolicyPreloadApi } from '@/ipc/policy.preload'
import type { ProfilePreloadApi } from '@/ipc/profile.preload'
import type { UpdatesPreloadApi } from '@/ipc/updates.preload'
import type { ConnectorScheduleUiApi } from '@/settings/connector-schedule.types'
import {
  getRendererHttpRootClient,
  requireRendererHttpWorkspaceClient,
} from './renderer-http-client'

const unavailable = async (): Promise<never> => {
  throw new Error('This settings control is unavailable in the current renderer')
}

const unavailablePolicyApi: PolicyPreloadApi = {
  config: { get: unavailable, reset: unavailable, update: unavailable },
  evidence: { list: unavailable, record: unavailable },
  evaluate: { application: unavailable, opportunity: unavailable, runWindow: unavailable },
}

const unavailableProfileApi: ProfilePreloadApi = {
  agentContext: { get: unavailable },
  get: unavailable,
  identity: { set: unavailable, status: unavailable },
  secrets: { delete: unavailable, list: unavailable, upsert: unavailable },
  update: unavailable,
}

const rendererScheduleApi: ConnectorScheduleUiApi = {
  deleteSchedule: (input) =>
    requireRendererHttpWorkspaceClient().connectors.schedules.delete(input),
  async getCapabilities() {
    const rootClient = getRendererHttpRootClient()
    if (!rootClient) return { connectorScheduling: { available: false } }
    const capabilities = await rootClient.capabilities.get()
    return { connectorScheduling: capabilities.connectorScheduling }
  },
  getSchedule: (connectorInstanceId) =>
    requireRendererHttpWorkspaceClient().connectors.schedules.get(connectorInstanceId),
  pauseSchedule: (input) =>
    requireRendererHttpWorkspaceClient().connectors.schedules.pause(input),
  resumeSchedule: (input) =>
    requireRendererHttpWorkspaceClient().connectors.schedules.resume(input),
  upsertSchedule: (input) =>
    requireRendererHttpWorkspaceClient().connectors.schedules.upsert(input),
}

const unavailableUpdatesApi: UpdatesPreloadApi = {
  check: async () => ({ currentVersion: '', status: 'disabled' }),
  getState: async () => ({ currentVersion: '', status: 'disabled' }),
  install: async () => undefined,
  onStateChanged: () => () => undefined,
}

function rendererPolicyApi(): PolicyPreloadApi {
  return (window as Window & { policy?: PolicyPreloadApi }).policy ?? unavailablePolicyApi
}

function rendererProfileApi(): ProfilePreloadApi {
  return (window as Window & { profile?: ProfilePreloadApi }).profile ?? unavailableProfileApi
}

function rendererUpdatesApi(): UpdatesPreloadApi {
  return (window as Window & { valedictorianUpdates?: UpdatesPreloadApi })
    .valedictorianUpdates ?? unavailableUpdatesApi
}

export {
  rendererPolicyApi,
  rendererProfileApi,
  rendererUpdatesApi,
  rendererScheduleApi,
}
