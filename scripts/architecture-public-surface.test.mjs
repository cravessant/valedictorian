import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  passingFixture,
  runArchitectureCheck,
  writeFixture,
} from './architecture-check.fixture.mjs'

/** @type {string[]} */
const fixtureRoots = []

/**
 * @param {Record<string, string>} files
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function check(files) {
  return runArchitectureCheck(writeFixture(files, fixtureRoots))
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) fs.rmSync(root, { recursive: true })
})

describe('module public surfaces', () => {
  const bypass = (source, target, specifier) =>
    `[module-public-surface-bypass] ${source} reaches ${target} through ${JSON.stringify(specifier)}; production server and runtime code imports a capability only through src/modules/job/public.ts\n`

  it('accepts a named value and type import from the exact public surface', () => {
    const result = check(passingFixture())

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('accepts a public surface reached by its alias spelling', () => {
    const result = check({
      ...passingFixture(),
      'src/runtime/runtime.ts': [
        "import { runJob, type JobRun } from '@/modules/job/public'",
        '',
        'export const columns = (run: JobRun) => runJob(run)',
        '',
      ].join('\n'),
    })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('accepts a type-only reach and a re-export of the public surface', () => {
    const result = check({
      ...passingFixture(),
      'src/runtime/runtime.ts': [
        "import type { JobRun } from '../modules/job/public'",
        "export { runJob } from '../modules/job/public'",
        '',
        'export const columns = (run: JobRun) => run.id',
        '',
      ].join('\n'),
    })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  const deepSpecifier = '../modules/job/job.service'
  const aliasSpecifier = '@/modules/job/job.service'

  it.each([
    ['a relative deep import', `import { runJob } from '${deepSpecifier}'`, deepSpecifier],
    ['an alias deep import', `import { runJob } from '${aliasSpecifier}'`, aliasSpecifier],
    ['a type-only deep import', `import type { JobRun } from '${deepSpecifier}'`, deepSpecifier],
    ['a re-export deep import', `export { runJob } from '${deepSpecifier}'`, deepSpecifier],
    ['a star re-export deep import', `export * from '${deepSpecifier}'`, deepSpecifier],
    ['a namespace deep import', `import * as service from '${deepSpecifier}'`, deepSpecifier],
    ['a default deep import', `import service from '${deepSpecifier}'`, deepSpecifier],
    [
      'a literal dynamic deep import',
      `export const load = () => import('${deepSpecifier}')`,
      deepSpecifier,
    ],
  ])('rejects %s', (_label, statement, specifier) => {
    const result = check({
      ...passingFixture(),
      'src/runtime/runtime.ts': `${statement}\nexport const columns = 1\n`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      bypass('src/runtime/runtime.ts', 'src/modules/job/job.service.ts', specifier),
    )
  })

  it('rejects a deep import from a server file named like a fixture', () => {
    const result = check({
      ...passingFixture(),
      'src/server/server.http-fixture.ts':
        "import { runJob } from '../modules/job/job.service'\n\nexport const boot = runJob\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      bypass('src/server/server.http-fixture.ts', 'src/modules/job/job.service.ts', '../modules/job/job.service'),
    )
  })

  it('rejects a deep import from a runtime harness on an alternate TypeScript extension', () => {
    const result = check({
      ...passingFixture(),
      'src/runtime/runtime.test-harness.mts':
        "import { runJob } from '../modules/job/job.service'\n\nexport const boot = runJob\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      bypass('src/runtime/runtime.test-harness.mts', 'src/modules/job/job.service.ts', '../modules/job/job.service'),
    )
  })

  it.each([
    ['an extension spelling', '../modules/job/public.js'],
    ['a redundant-segment spelling', '../modules/job/../job/public'],
  ])('rejects the public surface reached by %s', (_label, specifier) => {
    const result = check({
      ...passingFixture(),
      'src/runtime/runtime.ts': `import { runJob } from '${specifier}'\n\nexport const columns = runJob\n`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[module-public-surface-bypass] src/runtime/runtime.ts reaches src/modules/job/public.ts through ${JSON.stringify(specifier)}; the surface is imported by its exact path with no extension, index, or redundant segment\n`,
    )
  })

  it('rejects an index spelling standing in for the public surface', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/index.ts': "export { runJob } from './job.service'\n",
      'src/runtime/runtime.ts': "import { runJob } from '../modules/job'\n\nexport const columns = runJob\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      bypass('src/runtime/runtime.ts', 'src/modules/job/index.ts', '../modules/job'),
    )
  })

  it('rejects a deep import laundered through a symlink', () => {
    const files = passingFixture()
    delete files['src/runtime/runtime.ts']
    const root = writeFixture({
      ...files,
      'src/runtime/runtime.ts': "import { runJob } from './job-alias'\n\nexport const columns = runJob\n",
    }, fixtureRoots)
    fs.symlinkSync(
      path.join(root, 'src/modules/job/job.service.ts'),
      path.join(root, 'src/runtime/job-alias.ts'),
    )
    const result = runArchitectureCheck(root)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      bypass('src/runtime/runtime.ts', 'src/modules/job/job.service.ts', './job-alias'),
    )
  })

  it.each([
    ['a renamed one-hop barrel', "export { runJob as start } from '../modules/job/job.service'", 'start'],
    ['a type-only one-hop barrel', "export type { JobRun } from '../modules/job/job.service'", 'JobRun'],
    ['a star one-hop barrel', "export * from '../modules/job/job.service'", 'runJob'],
    ['a namespace one-hop barrel', "export * as job from '../modules/job/job.service'", 'job'],
  ])('rejects %s carrying a module internal across', (_label, statement, name) => {
    const result = check({
      ...passingFixture(),
      'src/shared/job-barrel.ts': `${statement}\n`,
      'src/runtime/runtime.ts':
        `import { ${name} } from '../shared/job-barrel'\n\nexport const columns = 1\nvoid ${name}\n`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[module-public-surface-bypass] src/runtime/runtime.ts reaches src/modules/job/job.service.ts through the barrel src/shared/job-barrel.ts; a re-export carries a module internal across the boundary that src/modules/job/public.ts exists to hold\n',
    )
  })

  it('rejects a local binding re-exported across several hops', () => {
    const result = check({
      ...passingFixture(),
      'src/shared/job-local.ts':
        "import { runJob } from '../modules/job/job.service'\n\nexport { runJob }\n",
      'src/shared/job-barrel.ts': "export { runJob as start } from './job-local'\n",
      'src/runtime/runtime.ts':
        "import { start } from '../shared/job-barrel'\n\nexport const columns = start\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[module-public-surface-bypass] src/runtime/runtime.ts reaches src/modules/job/job.service.ts through the barrel src/shared/job-barrel.ts; a re-export carries a module internal across the boundary that src/modules/job/public.ts exists to hold\n',
    )
  })

  it('refuses a computed dynamic import in a production consumer', () => {
    const result = check({
      ...passingFixture(),
      'src/runtime/runtime.ts': "const t = './x'\nexport const load = () => import(t)\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[module-public-surface-bypass] src/runtime/runtime.ts imports a module whose specifier is computed; a reach that cannot be read from the source cannot be proven to use a public surface\n',
    )
  })

  it('refuses a module specifier that resolves to no file', () => {
    const result = check({
      ...passingFixture(),
      'src/runtime/runtime.ts':
        "export const load = () => import('../modules/job/absent')\nexport const columns = 1\n",
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[module-public-surface-bypass] src/runtime/runtime.ts names module specifier "../modules/job/absent", which resolves to no file; an unresolvable reach is refused rather than assumed to be a public surface\n',
    )
  })

  it.each([
    ['the runtime', 'src/runtime/runtime.ts', '../../runtime/runtime', 'src/runtime'],
    ['the server', 'src/server/server.ts', '../../server/server', 'src/server'],
    ['the IPC edge', 'src/ipc/job.ipc.ts', '../../ipc/job.ipc', 'src/ipc'],
  ])('rejects a public surface reaching back into %s', (_label, edgePath, specifier, edge) => {
    const result = check({
      ...passingFixture(),
      [edgePath]: 'export const columns = 1\n',
      'src/modules/job/public.ts': [
        "export { runJob, type JobRun } from './job.service'",
        `export { columns } from '${specifier}'`,
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[module-public-surface-bypass] src/modules/job/public.ts depends on ${edge} through src/modules/job/public.ts -> ${edgePath}; no file in a public surface's closure reaches its own consumer\n`,
    )
  })

  it('rejects a public surface reaching Electron', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/public.ts': [
        "import { app } from 'electron'",
        "export { runJob, type JobRun } from './job.service'",
        '',
        'export const host = app',
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[module-public-surface-bypass] src/modules/job/public.ts depends on Electron through src/modules/job/public.ts -> "electron"; a public surface carries no Electron edge anywhere in its closure\n',
    )
  })

  it('leaves a test file free to reach a module internal', () => {
    const result = check({
      ...passingFixture(),
      'src/runtime/runtime.test.ts':
        "import { runJob } from '../modules/job/job.service'\n\nexport const boot = runJob\n",
    })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it('accepts a surface that publishes only its own module', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/public.ts': [
        "export { runJob, type JobRun } from './job.service'",
        "export { jobLabel } from './job.labels'",
        '',
      ].join('\n'),
      'src/modules/job/job.labels.ts': "export const jobLabel = 'job'\n",
      'src/runtime/runtime.ts': [
        "import { jobLabel, runJob, type JobRun } from '../modules/job/public'",
        '',
        'export const columns = (run: JobRun) => `${jobLabel}:${runJob(run)}`',
        '',
      ].join('\n'),
    })

    expect(result.stderr).toBe('')
    expect(result.status).toBe(0)
  })

  it.each([
    ['a named re-export', "export { columns as captureColumns } from '../capture/capture.service'"],
    ['a type-only re-export', "export type { CaptureRow } from '../capture/capture.service'"],
    ['a local binding re-export', "import { columns } from '../capture/capture.service'\nexport { columns }"],
  ])('rejects a public surface laundering another module through %s', (_label, statement) => {
    const result = check({
      ...passingFixture(),
      'src/modules/capture/capture.service.ts': [
        "import { jobs } from '../job/job.schema'",
        '',
        'void jobs',
        'export const columns = 1',
        'export interface CaptureRow { readonly id: string }',
        '',
      ].join('\n'),
      'src/modules/job/public.ts': [
        "export { runJob, type JobRun } from './job.service'",
        statement,
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[module-public-surface-bypass] src/modules/job/public.ts transports src/modules/capture/capture.service.ts; a public surface publishes its own module only, and src/modules/capture/public.ts owns that contract\n',
    )
  })

  it('rejects a consumer reaching a foreign internal laundered through a public surface', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/public.ts': [
        "export { runJob, type JobRun } from './job.service'",
        "export { columns as captureColumns } from '../capture/capture.service'",
        '',
      ].join('\n'),
      'src/runtime/runtime.ts': [
        "import { captureColumns, runJob, type JobRun } from '../modules/job/public'",
        '',
        'export const columns = (run: JobRun) => runJob(run) + String(captureColumns)',
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[module-public-surface-bypass] src/runtime/runtime.ts reaches src/modules/capture/capture.service.ts through the barrel src/modules/job/public.ts; a re-export carries a module internal across the boundary that src/modules/capture/public.ts exists to hold\n',
    )
  })

  it.each([
    ['export *', "export * from './job.service'", 'a star'],
    ['export * as', "export * as job from './job.service'", 'a namespace'],
  ])('rejects the %s public export form', (_label, statement, shape) => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/public.ts': `export { runJob, type JobRun } from './job.service'\n${statement}\n`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[module-public-surface-bypass] src/modules/job/public.ts re-exports "./job.service" as ${shape}; a public surface names every export explicitly\n`,
    )
  })

  it.each([
    ['a bare default declaration', 'export default function surface() {}'],
    ['a renamed local default', 'const surface = 1\nexport { surface as default }'],
    ['a forwarded default', "export { default } from './job.service'"],
  ])('rejects %s on a public surface', (_label, statement) => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/job.service.ts': [
        'export interface JobRun { readonly id: string }',
        '',
        'export const runJob = (run: JobRun) => run.id',
        'export default runJob',
        '',
      ].join('\n'),
      'src/modules/job/public.ts': `export { runJob, type JobRun } from './job.service'\n${statement}\n`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[module-public-surface-bypass] src/modules/job/public.ts exports a default binding; a public surface names every export explicitly\n',
    )
  })

  it.each([
    [
      'the connectors shape: a status projection reading a runtime run summary',
      'src/modules/job/job.status.ts',
      "import { runOutcome } from '../../runtime/runtime-run-summary'\n\nexport const status = runOutcome\n",
      'src/runtime/runtime-run-summary.ts',
      'export const runOutcome = 1\n',
      'src/modules/job/public.ts -> src/modules/job/job.status.ts -> src/runtime/runtime-run-summary.ts',
      "export { status } from './job.status'",
    ],
    [
      'the capture shape: a resolution throwing a runtime transport error',
      'src/modules/job/job.resolution.ts',
      "import { HttpError } from '../../runtime/runtime-lifecycle'\n\nexport const resolve = () => new HttpError()\n",
      'src/runtime/runtime-lifecycle.ts',
      'export class HttpError extends Error {}\n',
      'src/modules/job/public.ts -> src/modules/job/job.resolution.ts -> src/runtime/runtime-lifecycle.ts',
      "export { resolve } from './job.resolution'",
    ],
    [
      'the scheduling shape: a work source typed by the runtime scheduler',
      'src/modules/job/job.work-source.ts',
      "import type { WorkSource } from '../../runtime/runtime-scheduler'\n\nexport const source: WorkSource = { id: 'job' }\n",
      'src/runtime/runtime-scheduler.ts',
      'export interface WorkSource { id: string }\n',
      'src/modules/job/public.ts -> src/modules/job/job.work-source.ts -> src/runtime/runtime-scheduler.ts',
      "export { source } from './job.work-source'",
    ],
  ])('rejects %s', (_label, modulePath, moduleSource, edgePath, edgeSource, trail, surfaceLine) => {
    const result = check({
      ...passingFixture(),
      [edgePath]: edgeSource,
      [modulePath]: moduleSource,
      'src/modules/job/public.ts':
        `export { runJob, type JobRun } from './job.service'\n${surfaceLine}\n`,
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[module-public-surface-bypass] src/modules/job/public.ts depends on src/runtime through ${trail}; no file in a public surface's closure reaches its own consumer\n`,
    )
  })

  it('rejects a runtime edge three hops inside a public surface closure', () => {
    const result = check({
      ...passingFixture(),
      'src/runtime/runtime-edge.ts': 'export const edge = 1\n',
      'src/modules/job/job.third.ts': "export { edge } from '../../runtime/runtime-edge'\n",
      'src/modules/job/job.second.ts': "export { edge } from './job.third'\n",
      'src/modules/job/job.first.ts': "export { edge } from './job.second'\n",
      'src/modules/job/public.ts': [
        "export { runJob, type JobRun } from './job.service'",
        "export { edge } from './job.first'",
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      "[module-public-surface-bypass] src/modules/job/public.ts depends on src/runtime through src/modules/job/public.ts -> src/modules/job/job.first.ts -> src/modules/job/job.second.ts -> src/modules/job/job.third.ts -> src/runtime/runtime-edge.ts; no file in a public surface's closure reaches its own consumer\n",
    )
  })

  it.each([
    ['the IPC edge', 'src/ipc/job.ipc.ts', 'src/ipc'],
    ['the server edge', 'src/server/job.server.ts', 'src/server'],
  ])('rejects %s reached through a public surface closure', (_label, edgePath, edge) => {
    const result = check({
      ...passingFixture(),
      [edgePath]: 'export const edge = 1\n',
      'src/modules/job/job.bridge.ts':
        `import { edge } from '../../${edgePath.replace(/^src\//, '').replace(/\.ts$/, '')}'\n\nexport const bridge = edge\n`,
      'src/modules/job/public.ts': [
        "export { runJob, type JobRun } from './job.service'",
        "export { bridge } from './job.bridge'",
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      `[module-public-surface-bypass] src/modules/job/public.ts depends on ${edge} through src/modules/job/public.ts -> src/modules/job/job.bridge.ts -> ${edgePath}; no file in a public surface's closure reaches its own consumer\n`,
    )
  })

  it('rejects Electron reached two hops inside a public surface closure', () => {
    const result = check({
      ...passingFixture(),
      'src/modules/job/job.host.ts': "import { app } from 'electron'\n\nexport const host = app\n",
      'src/modules/job/public.ts': [
        "export { runJob, type JobRun } from './job.service'",
        "export { host } from './job.host'",
        '',
      ].join('\n'),
    })

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      '[module-public-surface-bypass] src/modules/job/public.ts depends on Electron through src/modules/job/public.ts -> src/modules/job/job.host.ts -> "electron"; a public surface carries no Electron edge anywhere in its closure\n',
    )
  })
})
