import fs from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = /** @type {unknown} */ (require('electron'))
const { version } = /** @type {{ version: string }} */ (require('electron/package.json'))

if (typeof electronPath !== 'string') {
  throw new TypeError(`Electron ${version} did not resolve to a runtime path`)
}

if (!fs.existsSync(electronPath)) {
  throw new Error(`Electron ${version} runtime is unavailable at ${electronPath}`)
}

console.log(`Electron ${version} runtime is available at ${electronPath}`)
