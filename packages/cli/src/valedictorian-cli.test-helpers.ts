import fs from 'node:fs'
import path from 'node:path'
import { runValedictorianCli } from './valedictorian-cli'
import type { SecretsRunSpawnAdapter } from './valedictorian-cli.secrets-run-spawn.js'

export function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status: 200,
    ...init,
  })
}

export function readPackageJson() {
  return JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')) as {
    bin?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
    files?: string[]
    name?: string
  }
}

export function applicationDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 'application-1',
    companyName: 'Versant Media',
    roleTitle: 'Software Engineer Intern',
    roleKind: 'internship',
    sourceName: 'LinkedIn',
    status: 'queued',
    term: null,
    terms: [],
    timingMode: 'unknown',
    startDate: null,
    endDate: null,
    location: 'Remote',
    workMode: 'remote',
    hasApplied: false,
    currentPriorityScore: null,
    currentPriorityBand: null,
    primaryLink: null,
    notes: null,
    createdAt: '2026-07-11T14:00:00.000Z',
    updatedAt: '2026-07-11T14:00:00.000Z',
    ...overrides,
  }
}

export function applicationLinkRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    applicationId: 'application-1',
    kind: 'official',
    label: 'official',
    url: 'https://jobs.example.com/1',
    externalId: null,
    isPrimary: true,
    discoveredAt: '2026-07-11T14:00:00.000Z',
    createdAt: '2026-07-11T14:00:00.000Z',
    updatedAt: '2026-07-11T14:00:00.000Z',
    deletedAt: null,
    ...overrides,
  }
}

export function applicationAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: 'attempt-1',
    applicationId: 'application-1',
    status: 'in_progress',
    outcome: null,
    actorType: 'agent',
    actorName: 'codex',
    entryUrl: null,
    resumeVariant: null,
    resumeArtifactPath: null,
    summary: 'Started.',
    stopReason: null,
    confirmationUrl: null,
    confirmationText: null,
    startedAt: '2026-07-11T14:00:00.000Z',
    completedAt: null,
    createdAt: '2026-07-11T14:00:00.000Z',
    updatedAt: '2026-07-11T14:00:00.000Z',
    steps: [],
    ...overrides,
  }
}

export function applicationAttemptStep(overrides: Record<string, unknown> = {}) {
  return {
    id: 'step-1',
    attemptId: 'attempt-1',
    applicationId: 'application-1',
    sequence: 1,
    type: 'page_verified',
    message: 'Verified page.',
    payloadJson: '{}',
    actor: 'agent:codex',
    createdAt: '2026-07-11T14:00:00.000Z',
    ...overrides,
  }
}

export function applicationListResult(
  items: unknown[] = [],
  overrides: Record<string, unknown> = {},
) {
  return {
    items,
    total: items.length,
    limit: 25,
    offset: 0,
    hasMore: false,
    ...overrides,
  }
}

export function actionQueueListResult(overrides: Record<string, unknown> = {}) {
  return {
    items: [],
    total: 0,
    limit: 25,
    offset: 0,
    hasMore: false,
    actionBucketCounts: {
      apply_now: 0,
      manual_review_pickup: 0,
      needs_user_info: 0,
      stale_lock_recovery: 0,
      user_review_required: 0,
      blocked: 0,
      skip_below_cutoff: 0,
    },
    ...overrides,
  }
}

export function publishedCommandNames(help: string): string[] {
  const commands = help.split(/^COMMANDS$/m)[1] ?? ''
  return [...commands.matchAll(/^ {2}(\S+)/gm)].map((match) => match[1] ?? '')
}

export function parseCliError(stderr: string): Record<string, unknown> {
  return (JSON.parse(stderr) as { error: Record<string, unknown> }).error
}

export async function runCli(
  argv: string[],
  env: Record<string, string | undefined> = {},
  options: { cwd?: string; secretsRunSpawn?: SecretsRunSpawnAdapter } = {},
) {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCode = await runValedictorianCli({
    argv,
    env: {
      VALEDICTORIAN_API_URL: 'https://valedictorian.test',
      ...env,
    },
    cwd: options.cwd,
    stdout: (value) => stdout.push(value),
    stderr: (value) => stderr.push(value),
    secretsRunSpawn: options.secretsRunSpawn,
  })

  return {
    exitCode,
    stderr: stderr.join(''),
    stdout: stdout.join(''),
  }
}
