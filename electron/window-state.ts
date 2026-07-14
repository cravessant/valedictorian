import fs from 'node:fs'
import path from 'node:path'
import type { ResolvedTheme } from '../src/theme/theme-registry'

export interface WindowBounds {
  height: number
  width: number
  x: number
  y: number
}

export interface MainWindowState {
  bounds: WindowBounds
  isFullScreen: boolean
  isMaximized: boolean
}

export interface MainWindowStateSource {
  getBounds: () => WindowBounds
  isFullScreen: () => boolean
  isMaximized: () => boolean
}

export interface DisplayWorkArea {
  height: number
  width: number
  x: number
  y: number
}

export interface DisplayLike {
  workArea: DisplayWorkArea
}

export type MainWindowStateOptions =
  | {
      center: true
      height: number
      width: number
    }
  | WindowBounds

export const defaultMainWindowBounds = {
  height: 840,
  width: 1280,
}

export const minimumMainWindowBounds = {
  minHeight: 680,
  minWidth: 1024,
}

export const mainWindowFirstPaintOptions = {
  backgroundColor: '#181825',
  show: false,
}

export function createMainWindowFirstPaintOptions(theme: Pick<ResolvedTheme, 'firstPaintBackground'>) {
  return {
    ...mainWindowFirstPaintOptions,
    backgroundColor: theme.firstPaintBackground,
  }
}

export interface MainWindowStateStore {
  read: () => MainWindowState | null
  write: (state: MainWindowState) => void
}

export function createFileMainWindowStateStore(statePath: string): MainWindowStateStore {
  return {
    read() {
      try {
        return normalizeMainWindowState(JSON.parse(fs.readFileSync(statePath, 'utf8')) as unknown)
      } catch {
        return null
      }
    },
    write(state) {
      fs.mkdirSync(path.dirname(statePath), { recursive: true })
      fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    },
  }
}

export function createMainWindowStateSnapshot(window: MainWindowStateSource): MainWindowState {
  return {
    bounds: window.getBounds(),
    isFullScreen: window.isFullScreen(),
    isMaximized: window.isMaximized(),
  }
}

export function resolveMainWindowStateOptions(
  state: MainWindowState | null,
  displays: DisplayLike[],
): MainWindowStateOptions {
  if (state && isVisibleOnAnyDisplay(state.bounds, displays)) {
    return state.bounds
  }

  return {
    center: true,
    ...defaultMainWindowBounds,
  }
}

function isVisibleOnAnyDisplay(bounds: WindowBounds, displays: DisplayLike[]) {
  return displays.some((display) => intersects(bounds, display.workArea))
}

function intersects(bounds: WindowBounds, workArea: DisplayWorkArea) {
  const right = bounds.x + bounds.width
  const bottom = bounds.y + bounds.height
  const workAreaRight = workArea.x + workArea.width
  const workAreaBottom = workArea.y + workArea.height

  return (
    bounds.x < workAreaRight
    && right > workArea.x
    && bounds.y < workAreaBottom
    && bottom > workArea.y
  )
}

function normalizeMainWindowState(value: unknown): MainWindowState | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>
  const bounds = normalizeWindowBounds(candidate.bounds)

  if (!bounds) {
    return null
  }

  return {
    bounds,
    isFullScreen: candidate.isFullScreen === true,
    isMaximized: candidate.isMaximized === true,
  }
}

function normalizeWindowBounds(value: unknown): WindowBounds | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (
    typeof candidate.height !== 'number'
    || typeof candidate.width !== 'number'
    || typeof candidate.x !== 'number'
    || typeof candidate.y !== 'number'
  ) {
    return null
  }

  return {
    height: Math.round(candidate.height),
    width: Math.round(candidate.width),
    x: Math.round(candidate.x),
    y: Math.round(candidate.y),
  }
}
