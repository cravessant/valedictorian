import type { AppSettings, AppSettingsPatch } from '../settings/app-settings'
import { normalizeAppSettings } from '../settings/app-settings'
import { requiresRestart } from '../settings/requiresRestart'
import type { SettingsPreloadApi } from '../ipc/settings.preload'

export type SettingsPatchKey = keyof AppSettings

export function createSettingsMutationTargetGate() {
  let epoch = 0
  let pending = 0

  function invalidate() {
    epoch += 1
    pending = 0
  }

  return {
    get epoch() {
      return epoch
    },
    get pending() {
      return pending
    },
    isIdle() {
      return pending === 0
    },
    invalidate,
    replaceTarget() {
      invalidate()
    },
    begin() {
      pending += 1
      const startedEpoch = epoch
      return {
        belongsToCurrentTarget() {
          return startedEpoch === epoch
        },
        end() {
          if (startedEpoch === epoch) {
            pending = Math.max(0, pending - 1)
          }
        },
      }
    },
  }
}

export type SettingsMutationTargetGate = ReturnType<typeof createSettingsMutationTargetGate>

export function settingsPatchKeys(patch: AppSettingsPatch): SettingsPatchKey[] {
  return (Object.keys(patch) as (keyof AppSettingsPatch)[])
    .filter((key) => patch[key] !== undefined)
    .map((key) => (key === 'apiToken' ? 'apiTokenConfigured' : key))
}

export function applySettingsPatchKeys(
  base: AppSettings,
  source: AppSettings,
  patch: AppSettingsPatch,
): AppSettings {
  const next = { ...base }
  for (const key of settingsPatchKeys(patch)) {
    next[key] = source[key] as never
  }
  return next
}

type SettingsStateSetter = (
  value: AppSettings | ((current: AppSettings) => AppSettings),
) => void

export function applyOptimisticSettingsPatch({
  patch,
  previousSettings,
  setFiltersExpanded,
  setSettings,
}: {
  patch: AppSettingsPatch
  previousSettings: AppSettings
  setFiltersExpanded: (value: boolean) => void
  setSettings: SettingsStateSetter
}): AppSettings {
  const nextSettings = normalizeAppSettings({
    ...previousSettings,
    ...patch,
  })
  setSettings(nextSettings)
  if (typeof patch.showAdvancedFilters === 'boolean') {
    setFiltersExpanded(patch.showAdvancedFilters)
  }
  return nextSettings
}

export async function commitSettingsPatch({
  getCommittedSettings,
  isActiveApiTarget,
  isCurrentOperation,
  patch,
  setCommittedSettings,
  setFiltersExpanded,
  setSettings,
  setSettingsRestartRequired,
  settingsApi,
}: {
  getCommittedSettings: () => AppSettings
  isActiveApiTarget: () => boolean
  isCurrentOperation: () => boolean
  patch: AppSettingsPatch
  setCommittedSettings: (settings: AppSettings) => void
  setFiltersExpanded: (value: boolean) => void
  setSettings: SettingsStateSetter
  setSettingsRestartRequired: (value: boolean) => void
  settingsApi: SettingsPreloadApi
}): Promise<void> {
  const isCurrent = () => isCurrentOperation() && isActiveApiTarget()

  try {
    const savedSettings = await settingsApi.update(patch)
    if (!isCurrent()) {
      return
    }
    setCommittedSettings(
      applySettingsPatchKeys(getCommittedSettings(), savedSettings, patch),
    )
    setSettings((current) => applySettingsPatchKeys(current, savedSettings, patch))
    if (typeof patch.showAdvancedFilters === 'boolean') {
      setFiltersExpanded(savedSettings.showAdvancedFilters)
    }
    if (requiresRestart(patch)) {
      setSettingsRestartRequired(true)
    }
  } catch (error: unknown) {
    if (!isCurrent()) {
      return
    }
    const committed = getCommittedSettings()
    setSettings((current) => applySettingsPatchKeys(current, committed, patch))
    if (typeof patch.showAdvancedFilters === 'boolean') {
      setFiltersExpanded(committed.showAdvancedFilters)
    }
    throw error
  }
}
