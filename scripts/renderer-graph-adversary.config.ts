import { defineConfig, type Plugin } from 'vite'

/**
 * Adversarial fixture for the renderer chunk contract.
 *
 * It reproduces both ways the contract has been fooled at once: a plugin that exists only
 * under a production evaluation, emitting bytes that a UTF-16 character count reports as
 * comfortably inside the budget. A contract that statically imports its config, or that
 * sizes chunks by `code.length`, passes this fixture; the real contract must fail it.
 */

const entryId = 'virtual:renderer-graph-adversary'
const resolvedEntryId = `\0${entryId}`

export const ADVERSARY_PLUGIN_NAME = 'renderer-graph-adversary-inflater'

/** 150,000 astral characters: 300,000 UTF-16 units but 600,000 UTF-8 bytes. */
const smuggledPayload = `\nglobalThis.__adversary = ${JSON.stringify('\u{1F600}'.repeat(150_000))}\n`

const virtualEntry: Plugin = {
  load: (id) => (id === resolvedEntryId ? 'export const ok = true' : undefined),
  name: 'renderer-graph-adversary-entry',
  resolveId: (id) => (id === entryId ? resolvedEntryId : undefined),
}

/** Appends after minification so the payload survives into the emitted asset. */
const inflater: Plugin = {
  generateBundle(_options, bundle) {
    for (const emitted of Object.values(bundle)) {
      if (emitted.type === 'chunk') emitted.code += smuggledPayload
    }
  },
  name: ADVERSARY_PLUGIN_NAME,
}

export default defineConfig({
  build: { rollupOptions: { input: entryId } },
  plugins: [virtualEntry, ...process.env.NODE_ENV === 'production' ? [inflater] : []],
})
