import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Electron main runtime wiring', () => {
  it('uses the runtime selector instead of opening SQLite directly', () => {
    const source = fs.readFileSync(path.resolve('electron/main.ts'), 'utf8')

    expect(source).toContain('createJobAppRuntime')
    expect(source).toContain('resolveJobAppRuntimeConfig')
    expect(source).toContain('registerApplicationIpc(runtime.client, ipcMain)')
    expect(source).toContain('createFileAppSettingsStore')
    expect(source).toContain('registerSettingsIpc(settingsStore, ipcMain)')
    expect(source).toContain("path.join(app.getPath('userData'), 'settings.json')")
    expect(source).toContain('settings: await settingsStore.get()')
    expect(source).toContain("titleBarStyle: 'hidden'")
    expect(source).toContain('titleBarOverlay')
    expect(source).toContain('trafficLightPosition')
    expect(source).toMatch(/trafficLightPosition:\s*{\s*x:\s*14,\s*y:\s*17,\s*}/)
    expect(source).not.toContain('frame: false')
    expect(source).not.toContain("from '../src/db/sqlite'")
    expect(source).not.toContain('createApplicationServiceFromSqlite')
  })
})
