import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createFileMainWindowStateStore,
  defaultMainWindowBounds,
  resolveMainWindowStateOptions,
  type MainWindowState,
} from '../../electron/window-state'

const primaryDisplay = {
  workArea: {
    height: 900,
    width: 1440,
    x: 0,
    y: 0,
  },
}

describe('main window state resolution', () => {
  it('uses intentional default bounds when no saved state exists', () => {
    expect(resolveMainWindowStateOptions(null, [primaryDisplay])).toEqual({
      center: true,
      ...defaultMainWindowBounds,
    })
  })

  it('restores saved bounds when they are visible on a connected display', () => {
    const savedState: MainWindowState = {
      bounds: {
        height: 780,
        width: 1220,
        x: 80,
        y: 64,
      },
      isFullScreen: false,
      isMaximized: false,
    }

    expect(resolveMainWindowStateOptions(savedState, [primaryDisplay])).toEqual({
      height: 780,
      width: 1220,
      x: 80,
      y: 64,
    })
  })

  it('falls back to default bounds when saved bounds are offscreen', () => {
    const savedState: MainWindowState = {
      bounds: {
        height: 780,
        width: 1220,
        x: 3000,
        y: 2000,
      },
      isFullScreen: false,
      isMaximized: false,
    }

    expect(resolveMainWindowStateOptions(savedState, [primaryDisplay])).toEqual({
      center: true,
      ...defaultMainWindowBounds,
    })
  })
})

describe('main window state store', () => {
  it('persists and reads main window state from app data', () => {
    const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-window-state-')), 'state.json')
    const store = createFileMainWindowStateStore(statePath)
    const state: MainWindowState = {
      bounds: {
        height: 760,
        width: 1180,
        x: 48,
        y: 40,
      },
      isFullScreen: false,
      isMaximized: true,
    }

    expect(store.read()).toBeNull()

    store.write(state)

    expect(store.read()).toEqual(state)
  })

  it('ignores corrupt saved main window state', () => {
    const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-window-state-')), 'state.json')
    const store = createFileMainWindowStateStore(statePath)
    fs.writeFileSync(statePath, '{"bounds":{"width":"huge"}}', 'utf8')

    expect(store.read()).toBeNull()
  })
})
