import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  reviewedActionPins,
  reviewedActionVersions,
} from './workflow-action-pins.mjs'
import {
  bindCanonicalWorkflowUses,
  findWorkflowUsesLines,
  inventoryWorkflowUses,
  workflowUsesMatchCanonicalLines,
} from './workflow-uses.mjs'

export { reviewedActionPins, reviewedActionVersions }

export const inactiveWorkflowPaths = [
  'packages/cli/.github/workflows/ci.yml',
]

const inactiveReviewedActionFamilies = new Set([
  'actions/checkout',
  'actions/setup-node',
  'pnpm/action-setup',
])

const actionUsePattern = /^\s*uses:\s*([^@\s#]+)@([^\s#]+)(?:\s+#\s*(\S+))?\s*$/
const workflowFilePattern = /\.ya?ml$/

export function findInactiveWorkflowPolicyViolations({
  discoveredPaths,
  workflows,
}) {
  const violations = []
  if (JSON.stringify(discoveredPaths) !== JSON.stringify(inactiveWorkflowPaths)) {
    violations.push('inactive workflow inventory does not match the reviewed CLI workflow set')
  }

  for (const workflowPath of inactiveWorkflowPaths) {
    const source = workflows.get(workflowPath)
    if (source === undefined) {
      violations.push(`${workflowPath}: reviewed inactive workflow is missing`)
      continue
    }
    const structuralUses = inventoryWorkflowUses(source)
    for (const problem of structuralUses.problems) {
      violations.push(`${workflowPath}: ${problem}`)
    }
    const usesLines = bindCanonicalWorkflowUses(
      findWorkflowUsesLines(source, /^\s*uses:/),
      structuralUses.scalarUseOffsets,
      actionUsePattern,
    )
    const canonicalUses = usesLines.flatMap(({ match }) =>
      match ? [`${match[1]}@${match[2]}`] : [],
    )
    if (structuralUses.problems.length === 0
      && !workflowUsesMatchCanonicalLines(structuralUses.uses, canonicalUses)) {
      violations.push(`${workflowPath}: structural uses inventory does not match canonical uses lines`)
    }
    if (usesLines.length === 0) {
      violations.push(`${workflowPath}: workflow contains no reviewed action uses`)
    }
    for (const { match } of usesLines) {
      if (!match) {
        violations.push(`${workflowPath}: action use must have a full SHA and version comment`)
        continue
      }
      const [, action, revision, versionComment] = match
      if (!inactiveReviewedActionFamilies.has(action)) {
        violations.push(`${workflowPath}: ${action} is not in the reviewed action allowlist`)
        continue
      }
      const reviewedRevision = reviewedActionPins.get(action)
      if (revision !== reviewedRevision) {
        violations.push(`${workflowPath}: ${action} does not use its reviewed full commit SHA`)
      }
      if (!/^[0-9a-f]{40}$/.test(revision)) {
        violations.push(`${workflowPath}: ${action} is not pinned to a full lowercase commit SHA`)
      }
      const reviewedVersion = reviewedActionVersions.get(action)
      if (versionComment !== reviewedVersion) {
        violations.push(`${workflowPath}: ${action} must retain the reviewed ${reviewedVersion} comment`)
      }
    }
  }
  return violations
}

export function readInactiveWorkflowState(root = process.cwd()) {
  const discoveredPaths = listWorkflowFiles(path.join(root, 'packages'))
    .map((filePath) => repositoryPath(root, filePath))
    .sort()
  return {
    discoveredPaths,
    workflows: new Map(discoveredPaths.map((workflowPath) => [
      workflowPath,
      fs.readFileSync(path.join(root, workflowPath), 'utf8'),
    ])),
  }
}

function listWorkflowFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return listWorkflowFiles(entryPath)
    return entry.isFile()
      && entryPath.includes(`${path.sep}.github${path.sep}workflows${path.sep}`)
      && workflowFilePattern.test(entry.name)
      ? [entryPath]
      : []
  })
}

function repositoryPath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function run() {
  const violations = findInactiveWorkflowPolicyViolations(readInactiveWorkflowState())
  for (const violation of violations) process.stderr.write(`${violation}\n`)
  if (violations.length > 0) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
