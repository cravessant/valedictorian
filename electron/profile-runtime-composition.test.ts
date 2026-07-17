import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Electron profile runtime composition', () => {
  it('reuses runtime-prepared profile and secret capabilities instead of opening a second database', () => {
    const source = fs.readFileSync(new URL('./main.ts', import.meta.url), 'utf8')

    expect(source).not.toContain('createSqliteProfileService')
    expect(source).not.toContain('createFileDatabase(config.sqlitePath)')
    expect(source).toContain('if (runtime.profileService && runtime.secretService)')
    expect(source).toContain('registerProfileIpc(runtime.profileService, runtime.secretService, ipcMain)')
  })
})
