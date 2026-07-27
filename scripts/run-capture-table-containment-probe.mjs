import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runElectronLayoutProbe } from './electron-probe-launcher.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(here, '..')

await runElectronLayoutProbe({
  harnessConfig: path.join(repoRoot, 'electron/capture-table-probe/vite.config.mjs'),
  label: '#472 capture table probe',
  probeEntry: path.join(here, 'capture-table-containment-probe.mjs'),
})
