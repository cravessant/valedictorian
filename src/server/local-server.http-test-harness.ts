import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { ValedictorianWorkspaceClient } from '@sparxie/sdk'
import type { LocalValedictorianClient } from '../runtime/local-valedictorian-client'
import { createLocalValedictorianClient as createRuntimeLocalValedictorianClient } from './local-valedictorian-client.test-harness'
import {
  createValedictorianHttpServer,
  type CreateValedictorianHttpServerOptions,
  type StartedValedictorianHttpServer,
} from './local-server'

export function createTempDatabasePath() {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-server-'))
  return path.join(rootPath, 'pglite')
}

export function createTempFilePath(fileName: string) {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-server-file-'))
  return path.join(rootPath, fileName)
}

export function createSeededLocalClient(options: Parameters<typeof createRuntimeLocalValedictorianClient>[0]) {
  return createRuntimeLocalValedictorianClient({ seedDataMode: 'sample', ...options })
}

export async function readJson(response: Response) {
  return (await response.json()) as unknown
}

export function isolateReferenceTrackerEnvironment() {
  const original = process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
  process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = path.join(os.tmpdir(), 'valedictorian-missing-reference-tracker.md')
  return () => {
    if (original === undefined) delete process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH
    else process.env.VALEDICTORIAN_REFERENCE_TRACKER_PATH = original
  }
}

export function startBoundaryServer(client: LocalValedictorianClient): Promise<StartedValedictorianHttpServer> {
  return createValedictorianHttpServer({ client, host: '127.0.0.1', port: 0 })
}

export interface LocalServerHttpTestFixture {
  setup(): void
  start(options: CreateValedictorianHttpServerOptions): Promise<StartedValedictorianHttpServer>
  teardown(): Promise<void>
}

export function createLocalServerHttpTestFixture(): LocalServerHttpTestFixture {
  const activeServers = new Set<StartedValedictorianHttpServer>()
  let restoreEnvironment: (() => void) | null = null

  return {
    setup() {
      if (restoreEnvironment) {
        throw new Error('Local server HTTP test fixture is already set up.')
      }
      restoreEnvironment = isolateReferenceTrackerEnvironment()
    },
    async start(options) {
      const server = await createValedictorianHttpServer({
        ...options,
        host: options.host ?? '127.0.0.1',
        port: options.port ?? 0,
      })
      activeServers.add(server)
      return server
    },
    async teardown() {
      const servers = [...activeServers]
      activeServers.clear()
      try {
        await Promise.all(servers.map((server) => server.close()))
      } finally {
        restoreEnvironment?.()
        restoreEnvironment = null
      }
    },
  }
}

export function createBoundaryWorkspaceClient(
  onCreate: () => void,
  overrides: Partial<ValedictorianWorkspaceClient> = {},
): ValedictorianWorkspaceClient {
  const client = {
    applications: {
      async archive() {},
      async create() {
        onCreate()
        throw new Error('client create should not be called')
      },
      events: {
        async list() {
          throw new Error('not implemented')
        },
      },
      attempts: {
        async complete() {
          throw new Error('not implemented')
        },
        async list() {
          throw new Error('not implemented')
        },
        async start() {
          throw new Error('not implemented')
        },
        async step() {
          throw new Error('not implemented')
        },
      },
      async get() {
        return null
      },
      links: {
        async create() {
          throw new Error('not implemented')
        },
        async update() {
          throw new Error('not implemented')
        },
      },
      async list() {
        throw new Error('not implemented')
      },
      notes: {
        async append() {
          throw new Error('not implemented')
        },
      },
      async update() {
        throw new Error('not implemented')
      },
      async updateStatus() {
        throw new Error('not implemented')
      },
      workflow: {
        async update() {
          throw new Error('not implemented')
        },
      },
    },
    actionQueue: {
      async list() {
        throw new Error('not implemented')
      },
    },
    policy: {
      config: {
        async get() {
          throw new Error('not implemented')
        },
        async reset() {
          throw new Error('not implemented')
        },
        async update() {
          throw new Error('not implemented')
        },
      },
      evidence: {
        async list() {
          throw new Error('not implemented')
        },
        async record() {
          throw new Error('not implemented')
        },
      },
      evaluate: {
        async application() {
          throw new Error('not implemented')
        },
        async runWindow() {
          throw new Error('not implemented')
        },
        async sourcingCandidate() {
          throw new Error('not implemented')
        },
      },
    },
    runs: {
      async complete() {
        throw new Error('not implemented')
      },
      async list() {
        throw new Error('not implemented')
      },
      async start() {
        throw new Error('not implemented')
      },
      async step() {
        throw new Error('not implemented')
      },
    },
    scores: {
      async record() {},
    },
    sourcing: {
      candidates: {
        async process() {
          throw new Error('not implemented')
        },
      },
      findings: {
        async create() {
          throw new Error('not implemented')
        },
        async decide() {
          throw new Error('not implemented')
        },
        async list() {
          throw new Error('not implemented')
        },
        async promote() {
          throw new Error('not implemented')
        },
        async update() {
          throw new Error('not implemented')
        },
      },
    },
  } as unknown as ValedictorianWorkspaceClient

  return { ...client, ...overrides }
}
