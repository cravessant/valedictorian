import type { ApplicationLinkSummary, ApplicationListSort } from '../modules/applications/application.types'

export const PAGE_LIMIT = 50

export interface FilterState {
  search: string
  status: string
  priorityBand: string
  minScore: string
  workMode: string
  sort: ApplicationListSort
  createdFrom: string
  createdTo: string
  updatedFrom: string
  updatedTo: string
}

export const defaultFilters: FilterState = {
  search: '',
  status: '',
  priorityBand: '',
  minScore: '',
  workMode: '',
  sort: 'priority_desc',
  createdFrom: '',
  createdTo: '',
  updatedFrom: '',
  updatedTo: '',
}

export const APP_VIEWS = {
  APPLICATIONS: 'applications',
  PROFILE: 'profile',
  ACTION_QUEUE: 'action-queue',
  CONNECTORS: 'connectors',
  CONNECTOR_RUNS: 'connector-runs',
  SETTINGS: 'settings',
  SOURCING: 'sourcing',
} as const

export type AppView = typeof APP_VIEWS[keyof typeof APP_VIEWS]

export type MainAppView = Exclude<AppView, typeof APP_VIEWS.SETTINGS>

export interface ApplicationDetailSeed {
  id: string
  companyName: string
  primaryLink: ApplicationLinkSummary | null
  roleTitle: string
  sourceName: string
  status: string
}

export const SETTINGS_PANELS = {
  PROFILE: 'profile',
  GENERAL: 'general',
  CONNECTORS: 'connectors',
  POLICY: 'policy',
  APPEARANCE: 'appearance',
  CONFIGURATION: 'configuration',
  AGENT_ACCESS: 'agent-access',
  AGENT_WORKFLOWS: 'agent-workflows',
  ADVANCED: 'advanced',
  DATA: 'data',
} as const

export type SettingsPanelId = typeof SETTINGS_PANELS[keyof typeof SETTINGS_PANELS]
