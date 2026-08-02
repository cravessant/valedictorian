import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  approvedSelectedActionPatterns,
  reviewedActionPins,
  reviewedActionVersions,
} from './workflow-action-pins.mjs'
import {
  bindCanonicalWorkflowUses,
  findWorkflowUsesLines,
  inventoryWorkflowUses,
  workflowUsesMatchCanonicalLines,
} from './workflow-uses.mjs'

export const activeWorkflowPaths = [
  '.github/workflows/ci.yml',
  '.github/workflows/publish-cli.yml',
  '.github/workflows/publish-connectors.yml',
  '.github/workflows/publish-workspace.yml',
  '.github/workflows/release-mac.yml',
]

export { approvedSelectedActionPatterns }

const actionUsePattern = /^\s*(?:-\s*)?uses:\s*([^@\s#]+)@([^\s#]+)(?:\s+#\s*(\S+))?\s*$/
const staticActionIdentifierPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
const workflowFilePattern = /\.ya?ml$/
const approvedSelectedActionFamilies = new Set(
  approvedSelectedActionPatterns.map((pattern) => pattern.slice(0, -2)),
)

export function findActiveWorkflowPolicyViolations({
  discoveredPaths,
  workflows,
}) {
  const violations = []
  const observedActionFamilies = new Set()
  if (JSON.stringify(discoveredPaths) !== JSON.stringify(activeWorkflowPaths)) {
    violations.push('active workflow inventory does not match the reviewed workflow set')
  }

  for (const workflowPath of activeWorkflowPaths) {
    const source = workflows.get(workflowPath)
    if (source === undefined) {
      violations.push(`${workflowPath}: reviewed active workflow is missing`)
      continue
    }

    const structuralUses = inventoryWorkflowUses(source)
    for (const problem of structuralUses.problems) {
      violations.push(`${workflowPath}: ${problem}`)
    }
    const usesLines = bindCanonicalWorkflowUses(
      findWorkflowUsesLines(source, /^\s*(?:-\s*)?uses:/),
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

    for (const { line, number } of usesLines) {
      const match = actionUsePattern.exec(line)
      if (!match) {
        violations.push(`${workflowPath}:${number}: action use must have a full SHA and version comment`)
        continue
      }
      const [, action, revision, versionComment] = match
      if (!staticActionIdentifierPattern.test(action)) {
        violations.push(`${workflowPath}:${number}: action identifier must be static owner/name`)
        continue
      }
      observedActionFamilies.add(action)
      const reviewedRevision = reviewedActionPins.get(action)
      if (!approvedSelectedActionFamilies.has(action)) {
        violations.push(`${workflowPath}:${number}: ${action} is not in the selected action allowlist`)
      }
      if (reviewedRevision === undefined) {
        violations.push(`${workflowPath}:${number}: ${action} is not in the reviewed action allowlist`)
      } else if (revision !== reviewedRevision) {
        violations.push(`${workflowPath}:${number}: ${action} does not use its reviewed full commit SHA`)
      }
      if (!/^[0-9a-f]{40}$/.test(revision)) {
        violations.push(`${workflowPath}:${number}: ${action} is not pinned to a full lowercase commit SHA`)
      }
      const reviewedVersion = reviewedActionVersions.get(action)
      if (versionComment !== reviewedVersion) {
        violations.push(`${workflowPath}:${number}: ${action} must retain the reviewed ${reviewedVersion} comment`)
      }
    }
  }
  if (!setsEqual(observedActionFamilies, approvedSelectedActionFamilies)) {
    violations.push('active workflow action families do not match the selected action allowlist')
  }
  return violations
}

function setsEqual(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

export function readActiveWorkflowState(root = process.cwd()) {
  const discoveredPaths = listWorkflowFiles(path.join(root, '.github', 'workflows'))
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
    return entry.isFile() && workflowFilePattern.test(entry.name) ? [entryPath] : []
  })
}

function repositoryPath(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function run() {
  const violations = findActiveWorkflowPolicyViolations(readActiveWorkflowState())
  for (const violation of violations) process.stderr.write(`${violation}\n`)
  if (violations.length > 0) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
