import fs from 'node:fs'
import path from 'node:path'

export interface ProfileJsonWatchOptions {
  debounceMs?: number
  setTimeoutFn?: (callback: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void
  watchFn?: typeof fs.watch
}

export interface ProfileJsonWatcher {
  start(): void
  stop(): void
}

export function createProfileJsonWatcher(
  profilePath: string,
  onChange: () => void,
  options: ProfileJsonWatchOptions = {},
): ProfileJsonWatcher {
  const debounceMs = options.debounceMs ?? 50
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout
  const watchFn = options.watchFn ?? fs.watch
  const directoryPath = path.dirname(profilePath)
  const targetName = path.basename(profilePath)

  let watcher: fs.FSWatcher | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let generation = 0

  return {
    start() {
      if (watcher) return
      const startedGeneration = ++generation
      fs.mkdirSync(directoryPath, { recursive: true })
      watcher = watchFn(directoryPath, { persistent: false }, (_eventType, filename) => {
        if (startedGeneration !== generation || watcher == null) return
        const name = filename == null ? targetName : filename.toString()
        if (name !== targetName) return
        if (timer) clearTimeoutFn(timer)
        timer = setTimeoutFn(() => {
          timer = null
          if (startedGeneration === generation && watcher != null) onChange()
        }, debounceMs)
      })
    },
    stop() {
      generation += 1
      if (timer) {
        clearTimeoutFn(timer)
        timer = null
      }
      if (watcher) {
        watcher.close()
        watcher = null
      }
    },
  }
}
