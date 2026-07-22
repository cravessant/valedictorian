export const PAGE_LIMIT = 50

export const APP_VIEWS = {
  APPLICATIONS: 'applications',
  PROFILE: 'profile',
  ACTION_QUEUE: 'action-queue',
  CONNECTORS: 'connectors',
  CONNECTOR_RUNS: 'connector-runs',
  SETTINGS: 'settings',
  SOURCING: 'sourcing',
  SOURCING_NORMALIZATION: 'sourcing-normalization',
} as const

export type AppView = typeof APP_VIEWS[keyof typeof APP_VIEWS]

export type MainAppView = Exclude<AppView, typeof APP_VIEWS.SETTINGS>

export interface ApplicationDetailSeed {
  id: string
  companyName: string
  primaryLink: { label: string; url: string } | null
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
