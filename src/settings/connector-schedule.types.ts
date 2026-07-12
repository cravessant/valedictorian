import type {
  ConnectorScheduleSummary,
  ConnectorSchedulingCapability,
  DeleteConnectorScheduleInput,
  PauseConnectorScheduleInput,
  ResumeConnectorScheduleInput,
  UpsertConnectorScheduleInput,
  ValedictorianCapabilities,
} from 'sparxie'

export type ConnectorScheduleUiApi = {
  getCapabilities(): Promise<Pick<ValedictorianCapabilities, 'connectorScheduling'>>
  getSchedule(connectorInstanceId: string): Promise<ConnectorScheduleSummary | null>
  upsertSchedule(input: UpsertConnectorScheduleInput): Promise<ConnectorScheduleSummary>
  pauseSchedule(input: PauseConnectorScheduleInput): Promise<ConnectorScheduleSummary>
  resumeSchedule(input: ResumeConnectorScheduleInput): Promise<ConnectorScheduleSummary>
  deleteSchedule(input: DeleteConnectorScheduleInput): Promise<void>
}

export type ConnectorScheduleDraftMode =
  | 'manual'
  | 'preset'
  | 'custom-interval'
  | 'custom-daily'
  | 'custom-weekly'

export type ConnectorScheduleDraft = {
  mode: ConnectorScheduleDraftMode
  presetId: string | null
  state: 'enabled' | 'paused'
  timezone: string
  everyMinutes: string
  localTime: string
  dayOfWeek: string
}

export type ConnectorScheduleCardState = {
  capability: ConnectorSchedulingCapability | null
  canonical: ConnectorScheduleSummary | null
  draft: ConnectorScheduleDraft
  statusMessage: string | null
  statusTone: 'idle' | 'success' | 'error'
  isLoading: boolean
  isSaving: boolean
}
