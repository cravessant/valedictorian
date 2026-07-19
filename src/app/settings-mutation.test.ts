import { describe, expect, it, vi } from 'vitest'
import {
  applyOptimisticSettingsPatch,
  applySettingsPatchKeys,
  commitSettingsPatch,
  createSettingsMutationTargetGate,
  settingsPatchKeys,
} from './settings-mutation'
import {
  defaultAppSettings,
  type AppSettings,
  type AppSettingsPatch,
} from '../settings/app-settings'
import type { SettingsPreloadApi } from '../ipc/settings.preload'

function createKeyTracker() {
  const generations: Record<string, number> = {}
  return {
    begin(patch: AppSettingsPatch) {
      const operation: Record<string, number> = {}
      for (const key of settingsPatchKeys(patch)) {
        const next = (generations[key] ?? 0) + 1
        generations[key] = next
        operation[key] = next
      }
      return operation
    },
    isCurrent(operation: Record<string, number>) {
      return Object.entries(operation).every(
        ([key, generation]) => generations[key] === generation,
      )
    },
    invalidate() {
      for (const key of Object.keys(generations)) {
        generations[key] += 1
      }
    },
  }
}

describe('settings mutation per-key freshness', () => {
  it('keeps an independent key rejection owned after an unrelated newer patch starts', async () => {
    let settings: AppSettings = {
      ...defaultAppSettings,
      apiTokenConfigured: false,
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    }
    const committed = { current: settings }
    const keys = createKeyTracker()
    const setSettings = vi.fn((next: AppSettings | ((current: AppSettings) => AppSettings)) => {
      settings = typeof next === 'function' ? next(settings) : next
    })

    let rejectToken!: (reason?: unknown) => void
    let resolveTheme!: (value: AppSettings) => void
    const tokenUpdate = new Promise<AppSettings>((_resolve, reject) => {
      rejectToken = reject
    })
    const themeUpdate = new Promise<AppSettings>((resolve) => {
      resolveTheme = resolve
    })
    const settingsApi = {
      get: vi.fn(),
      reset: vi.fn(),
      update: vi.fn()
        .mockImplementationOnce(() => tokenUpdate)
        .mockImplementationOnce(() => themeUpdate),
    } as SettingsPreloadApi

    const tokenPatch: AppSettingsPatch = { apiToken: 'draft-token-value' }
    const themePatch: AppSettingsPatch = {
      theme: { presetId: 'catppuccin-latte', overrides: {} },
    }

    const tokenOperation = keys.begin(tokenPatch)
    applyOptimisticSettingsPatch({
      patch: tokenPatch,
      previousSettings: settings,
      setFiltersExpanded: vi.fn(),
      setSettings,
    })
    const tokenCommit = commitSettingsPatch({
      getCommittedSettings: () => committed.current,
      isActiveApiTarget: () => true,
      isCurrentOperation: () => keys.isCurrent(tokenOperation),
      patch: tokenPatch,
      setCommittedSettings: (next) => {
        committed.current = next
      },
      setFiltersExpanded: vi.fn(),
      setSettings,
      setSettingsRestartRequired: vi.fn(),
      settingsApi,
    })

    const themeOperation = keys.begin(themePatch)
    applyOptimisticSettingsPatch({
      patch: themePatch,
      previousSettings: settings,
      setFiltersExpanded: vi.fn(),
      setSettings,
    })
    const themeCommit = commitSettingsPatch({
      getCommittedSettings: () => committed.current,
      isActiveApiTarget: () => true,
      isCurrentOperation: () => keys.isCurrent(themeOperation),
      patch: themePatch,
      setCommittedSettings: (next) => {
        committed.current = next
      },
      setFiltersExpanded: vi.fn(),
      setSettings,
      setSettingsRestartRequired: vi.fn(),
      settingsApi,
    })

    rejectToken(new Error('token failed'))
    await expect(tokenCommit).rejects.toThrow('token failed')

    resolveTheme({
      ...committed.current,
      theme: { presetId: 'catppuccin-latte', overrides: {} },
    })
    await expect(themeCommit).resolves.toBeUndefined()

    expect(settings.theme.presetId).toBe('catppuccin-latte')
    expect(committed.current.theme.presetId).toBe('catppuccin-latte')
    expect(settings.apiTokenConfigured).toBe(false)
  })

  it('ignores a superseded same-key rejection while keeping a newer same-key failure owned', async () => {
    let settings: AppSettings = {
      ...defaultAppSettings,
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    }
    const committed = { current: settings }
    const keys = createKeyTracker()
    const setSettings = vi.fn((next: AppSettings | ((current: AppSettings) => AppSettings)) => {
      settings = typeof next === 'function' ? next(settings) : next
    })

    let rejectFirst!: (reason?: unknown) => void
    let rejectSecond!: (reason?: unknown) => void
    const firstUpdate = new Promise<AppSettings>((_resolve, reject) => {
      rejectFirst = reject
    })
    const secondUpdate = new Promise<AppSettings>((_resolve, reject) => {
      rejectSecond = reject
    })
    const settingsApi = {
      get: vi.fn(),
      reset: vi.fn(),
      update: vi.fn()
        .mockImplementationOnce(() => firstUpdate)
        .mockImplementationOnce(() => secondUpdate),
    } as SettingsPreloadApi

    const firstPatch: AppSettingsPatch = {
      theme: { presetId: 'catppuccin-latte', overrides: {} },
    }
    const secondPatch: AppSettingsPatch = {
      theme: { presetId: 'graphite', overrides: {} },
    }

    const firstOperation = keys.begin(firstPatch)
    applyOptimisticSettingsPatch({
      patch: firstPatch,
      previousSettings: settings,
      setFiltersExpanded: vi.fn(),
      setSettings,
    })
    const firstCommit = commitSettingsPatch({
      getCommittedSettings: () => committed.current,
      isActiveApiTarget: () => true,
      isCurrentOperation: () => keys.isCurrent(firstOperation),
      patch: firstPatch,
      setCommittedSettings: (next) => {
        committed.current = next
      },
      setFiltersExpanded: vi.fn(),
      setSettings,
      setSettingsRestartRequired: vi.fn(),
      settingsApi,
    })

    const secondOperation = keys.begin(secondPatch)
    applyOptimisticSettingsPatch({
      patch: secondPatch,
      previousSettings: settings,
      setFiltersExpanded: vi.fn(),
      setSettings,
    })
    const secondCommit = commitSettingsPatch({
      getCommittedSettings: () => committed.current,
      isActiveApiTarget: () => true,
      isCurrentOperation: () => keys.isCurrent(secondOperation),
      patch: secondPatch,
      setCommittedSettings: (next) => {
        committed.current = next
      },
      setFiltersExpanded: vi.fn(),
      setSettings,
      setSettingsRestartRequired: vi.fn(),
      settingsApi,
    })

    rejectFirst(new Error('stale theme failed'))
    await expect(firstCommit).resolves.toBeUndefined()
    expect(settings.theme.presetId).toBe('graphite')

    rejectSecond(new Error('latest theme failed'))
    await expect(secondCommit).rejects.toThrow('latest theme failed')
    expect(settings.theme.presetId).toBe('catppuccin-blur-mocha')
  })

  it('applies an independent success without reverting another in-flight key, then rolls only the failed key back', async () => {
    let settings: AppSettings = {
      ...defaultAppSettings,
      showAdvancedFilters: false,
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    }
    const committed = { current: settings }
    const keys = createKeyTracker()
    const setSettings = vi.fn((next: AppSettings | ((current: AppSettings) => AppSettings)) => {
      settings = typeof next === 'function' ? next(settings) : next
    })
    const setFiltersExpanded = vi.fn()

    let resolveTheme!: (value: AppSettings) => void
    let rejectFilters!: (reason?: unknown) => void
    const themeUpdate = new Promise<AppSettings>((resolve) => {
      resolveTheme = resolve
    })
    const filtersUpdate = new Promise<AppSettings>((_resolve, reject) => {
      rejectFilters = reject
    })
    const settingsApi = {
      get: vi.fn(),
      reset: vi.fn(),
      update: vi.fn()
        .mockImplementationOnce(() => themeUpdate)
        .mockImplementationOnce(() => filtersUpdate),
    } as SettingsPreloadApi

    const themePatch: AppSettingsPatch = {
      theme: { presetId: 'catppuccin-latte', overrides: {} },
    }
    const filtersPatch: AppSettingsPatch = { showAdvancedFilters: true }

    const themeOperation = keys.begin(themePatch)
    applyOptimisticSettingsPatch({
      patch: themePatch,
      previousSettings: settings,
      setFiltersExpanded,
      setSettings,
    })
    const themeCommit = commitSettingsPatch({
      getCommittedSettings: () => committed.current,
      isActiveApiTarget: () => true,
      isCurrentOperation: () => keys.isCurrent(themeOperation),
      patch: themePatch,
      setCommittedSettings: (next) => {
        committed.current = next
      },
      setFiltersExpanded,
      setSettings,
      setSettingsRestartRequired: vi.fn(),
      settingsApi,
    })

    const filtersOperation = keys.begin(filtersPatch)
    applyOptimisticSettingsPatch({
      patch: filtersPatch,
      previousSettings: settings,
      setFiltersExpanded,
      setSettings,
    })
    const filtersCommit = commitSettingsPatch({
      getCommittedSettings: () => committed.current,
      isActiveApiTarget: () => true,
      isCurrentOperation: () => keys.isCurrent(filtersOperation),
      patch: filtersPatch,
      setCommittedSettings: (next) => {
        committed.current = next
      },
      setFiltersExpanded,
      setSettings,
      setSettingsRestartRequired: vi.fn(),
      settingsApi,
    })

    resolveTheme({
      ...defaultAppSettings,
      theme: { presetId: 'catppuccin-latte', overrides: {} },
      showAdvancedFilters: false,
    })
    await expect(themeCommit).resolves.toBeUndefined()
    expect(settings.theme.presetId).toBe('catppuccin-latte')
    expect(settings.showAdvancedFilters).toBe(true)
    expect(committed.current.theme.presetId).toBe('catppuccin-latte')
    expect(committed.current.showAdvancedFilters).toBe(false)

    rejectFilters(new Error('filters failed'))
    await expect(filtersCommit).rejects.toThrow('filters failed')
    expect(settings.theme.presetId).toBe('catppuccin-latte')
    expect(settings.showAdvancedFilters).toBe(false)
  })

  it('ignores old-API success when the active API target was replaced synchronously', async () => {
    let settings: AppSettings = {
      ...defaultAppSettings,
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    }
    const committed = { current: settings }
    const keys = createKeyTracker()
    let activeApi: SettingsPreloadApi
    const setSettings = vi.fn((next: AppSettings | ((current: AppSettings) => AppSettings)) => {
      settings = typeof next === 'function' ? next(settings) : next
    })

    let resolveOld!: (value: AppSettings) => void
    const oldUpdate = new Promise<AppSettings>((resolve) => {
      resolveOld = resolve
    })
    const oldApi = {
      get: vi.fn(),
      reset: vi.fn(),
      update: vi.fn(() => oldUpdate),
    } as SettingsPreloadApi
    activeApi = oldApi

    const patch: AppSettingsPatch = {
      theme: { presetId: 'graphite', overrides: {} },
    }
    const operation = keys.begin(patch)
    applyOptimisticSettingsPatch({
      patch,
      previousSettings: settings,
      setFiltersExpanded: vi.fn(),
      setSettings,
    })
    setSettings.mockClear()

    const pending = commitSettingsPatch({
      getCommittedSettings: () => committed.current,
      isActiveApiTarget: () => activeApi === oldApi,
      isCurrentOperation: () => keys.isCurrent(operation),
      patch,
      setCommittedSettings: (next) => {
        committed.current = next
      },
      setFiltersExpanded: vi.fn(),
      setSettings,
      setSettingsRestartRequired: vi.fn(),
      settingsApi: oldApi,
    })

    activeApi = {
      get: vi.fn(),
      reset: vi.fn(),
      update: vi.fn(),
    } as SettingsPreloadApi
    keys.invalidate()

    resolveOld({
      ...defaultAppSettings,
      theme: { presetId: 'graphite', overrides: {} },
    })
    await expect(pending).resolves.toBeUndefined()
    expect(setSettings).not.toHaveBeenCalled()
    expect(committed.current.theme.presetId).toBe('catppuccin-blur-mocha')
  })

  it('maps apiToken patches onto apiTokenConfigured for key tracking', () => {
    expect(settingsPatchKeys({ apiToken: 'secret' })).toEqual(['apiTokenConfigured'])
    expect(
      applySettingsPatchKeys(
        defaultAppSettings,
        { ...defaultAppSettings, apiTokenConfigured: true },
        { apiToken: 'secret' },
      ).apiTokenConfigured,
    ).toBe(true)
  })
})

describe('settings mutation target-epoch pending ownership', () => {
  it('ignores old-target finalizers after replacement so new rejection rolls back to the real baseline', async () => {
    const gate = createSettingsMutationTargetGate()
    let settings: AppSettings = {
      ...defaultAppSettings,
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    }
    const committed = { current: settings }
    const keys = createKeyTracker()
    const setSettings = vi.fn((next: AppSettings | ((current: AppSettings) => AppSettings)) => {
      settings = typeof next === 'function' ? next(settings) : next
      if (gate.isIdle()) {
        committed.current = settings
      }
    })
    const setFiltersExpanded = vi.fn()

    let resolveOld!: (value: AppSettings) => void
    let rejectNew!: (reason?: unknown) => void
    const oldUpdate = new Promise<AppSettings>((resolve) => {
      resolveOld = resolve
    })
    const newUpdate = new Promise<AppSettings>((_resolve, reject) => {
      rejectNew = reject
    })
    const oldApi = {
      get: vi.fn(),
      reset: vi.fn(),
      update: vi.fn(() => oldUpdate),
    } as SettingsPreloadApi
    const newApi = {
      get: vi.fn(),
      reset: vi.fn(),
      update: vi.fn(() => newUpdate),
    } as SettingsPreloadApi
    let activeApi: SettingsPreloadApi = oldApi

    const oldPatch: AppSettingsPatch = {
      theme: { presetId: 'catppuccin-latte', overrides: {} },
    }
    const oldOperation = keys.begin(oldPatch)
    const oldMembership = gate.begin()
    applyOptimisticSettingsPatch({
      patch: oldPatch,
      previousSettings: settings,
      setFiltersExpanded,
      setSettings,
    })
    const oldCommit = commitSettingsPatch({
      getCommittedSettings: () => committed.current,
      isActiveApiTarget: () => activeApi === oldApi && oldMembership.belongsToCurrentTarget(),
      isCurrentOperation: () => keys.isCurrent(oldOperation),
      patch: oldPatch,
      setCommittedSettings: (next) => {
        committed.current = next
      },
      setFiltersExpanded,
      setSettings,
      setSettingsRestartRequired: vi.fn(),
      settingsApi: oldApi,
    }).finally(() => {
      oldMembership.end()
    })

    activeApi = newApi
    gate.replaceTarget()
    keys.invalidate()
    committed.current = {
      ...defaultAppSettings,
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    }
    settings = committed.current

    const newPatch: AppSettingsPatch = {
      theme: { presetId: 'graphite', overrides: {} },
    }
    const newOperation = keys.begin(newPatch)
    const newMembership = gate.begin()
    applyOptimisticSettingsPatch({
      patch: newPatch,
      previousSettings: settings,
      setFiltersExpanded,
      setSettings,
    })
    const newCommit = commitSettingsPatch({
      getCommittedSettings: () => committed.current,
      isActiveApiTarget: () => activeApi === newApi && newMembership.belongsToCurrentTarget(),
      isCurrentOperation: () => keys.isCurrent(newOperation),
      patch: newPatch,
      setCommittedSettings: (next) => {
        committed.current = next
      },
      setFiltersExpanded,
      setSettings,
      setSettingsRestartRequired: vi.fn(),
      settingsApi: newApi,
    }).finally(() => {
      newMembership.end()
    })

    expect(settings.theme.presetId).toBe('graphite')
    expect(gate.isIdle()).toBe(false)

    resolveOld({
      ...defaultAppSettings,
      theme: { presetId: 'catppuccin-latte', overrides: {} },
    })
    await expect(oldCommit).resolves.toBeUndefined()

    expect(gate.isIdle()).toBe(false)
    expect(committed.current.theme.presetId).toBe('catppuccin-blur-mocha')
    expect(settings.theme.presetId).toBe('graphite')

    rejectNew(new Error('new-target theme failed'))
    await expect(newCommit).rejects.toThrow('new-target theme failed')
    expect(settings.theme.presetId).toBe('catppuccin-blur-mocha')
    expect(committed.current.theme.presetId).toBe('catppuccin-blur-mocha')
    expect(gate.isIdle()).toBe(true)
  })

  it('ignores multiple superseded old-target finalizers without clearing the replacement pending count', () => {
    const gate = createSettingsMutationTargetGate()
    const firstOld = gate.begin()
    const secondOld = gate.begin()
    expect(gate.pending).toBe(2)

    gate.replaceTarget()
    expect(gate.pending).toBe(0)
    expect(gate.isIdle()).toBe(true)

    const replacement = gate.begin()
    expect(gate.pending).toBe(1)
    expect(firstOld.belongsToCurrentTarget()).toBe(false)
    expect(secondOld.belongsToCurrentTarget()).toBe(false)
    expect(replacement.belongsToCurrentTarget()).toBe(true)

    firstOld.end()
    secondOld.end()
    expect(gate.pending).toBe(1)
    expect(gate.isIdle()).toBe(false)

    replacement.end()
    expect(gate.pending).toBe(0)
    expect(gate.isIdle()).toBe(true)
  })

  it('swallows a deferred rejection after lifetime invalidation without updating state', async () => {
    const gate = createSettingsMutationTargetGate()
    let settings: AppSettings = {
      ...defaultAppSettings,
      theme: { presetId: 'catppuccin-blur-mocha', overrides: {} },
    }
    const committed = { current: settings }
    const keys = createKeyTracker()
    const setSettings = vi.fn((next: AppSettings | ((current: AppSettings) => AppSettings)) => {
      settings = typeof next === 'function' ? next(settings) : next
    })

    let rejectPending!: (reason?: unknown) => void
    const pendingUpdate = new Promise<AppSettings>((_resolve, reject) => {
      rejectPending = reject
    })
    const settingsApi = {
      get: vi.fn(),
      reset: vi.fn(),
      update: vi.fn(() => pendingUpdate),
    } as SettingsPreloadApi

    const patch: AppSettingsPatch = {
      theme: { presetId: 'graphite', overrides: {} },
    }
    const operation = keys.begin(patch)
    const membership = gate.begin()
    applyOptimisticSettingsPatch({
      patch,
      previousSettings: settings,
      setFiltersExpanded: vi.fn(),
      setSettings,
    })
    setSettings.mockClear()

    const pending = commitSettingsPatch({
      getCommittedSettings: () => committed.current,
      isActiveApiTarget: () => membership.belongsToCurrentTarget(),
      isCurrentOperation: () => keys.isCurrent(operation),
      patch,
      setCommittedSettings: (next) => {
        committed.current = next
      },
      setFiltersExpanded: vi.fn(),
      setSettings,
      setSettingsRestartRequired: vi.fn(),
      settingsApi,
    }).finally(() => {
      membership.end()
    })

    gate.invalidate()
    expect(membership.belongsToCurrentTarget()).toBe(false)
    expect(gate.isIdle()).toBe(true)

    rejectPending(new Error('unmounted settings failed'))
    await expect(pending).resolves.toBeUndefined()
    expect(setSettings).not.toHaveBeenCalled()
    expect(settings.theme.presetId).toBe('graphite')
    expect(committed.current.theme.presetId).toBe('catppuccin-blur-mocha')
  })
})
