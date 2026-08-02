import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { load as loadYaml } from 'js-yaml'
import { listCodeFiles, readModuleRecord } from './architecture-source-graph.mjs'

export const cliPackageName = '@sparxie/valedictorian-cli'
export const cliVersion = '0.1.0-alpha.20'
export const cliWorkspaceDependency = `workspace:${cliVersion}`
export const cliSourceCommit = 'd576ebfa84119e809666faac668ccd33b5fa3946'
export const approvedLicenseSha256 =
  'cd6a36f564f1c145458733fe9d99bc800c4e046b2d8920b138cecd5cc7c561b4'

const forbiddenRuntimeDependencies = [
  '@electric-sql/pglite',
  '@sparxie/valedictorian-local-runtime',
  'drizzle-orm',
  'electron',
]

export function findCliCompositionViolations({
  cliPackage,
  installedCliPath,
  license,
  lockfile,
  root,
  rootPackage,
  workspace,
}) {
  const violations = []
  const cliRoot = path.join(root, 'packages', 'cli')
  const rootImporter = lockfile.importers?.['.']
  const lockedCli = rootImporter?.devDependencies?.[cliPackageName]

  if (rootPackage.license !== 'MIT') violations.push('root package license must be exactly MIT')
  if (sha256(license) !== approvedLicenseSha256) {
    violations.push('root LICENSE does not byte-match the approved SPDX MIT substitution')
  }
  if (!Array.isArray(workspace.packages) || !workspace.packages.includes('packages/cli')) {
    violations.push('packages/cli is missing from the root pnpm workspace')
  }
  if (rootPackage.devDependencies?.[cliPackageName] !== cliWorkspaceDependency) {
    violations.push('root CLI dependency is not the exact workspace version')
  }
  if (
    lockedCli?.specifier !== cliWorkspaceDependency
    || lockedCli?.version !== 'link:packages/cli'
  ) {
    violations.push('root lock importer does not resolve the CLI to link:packages/cli')
  }
  if (
    cliPackage.name !== cliPackageName
    || cliPackage.version !== cliVersion
    || cliPackage.license !== 'MIT'
    || cliPackage.valedictorianSourceCommit !== cliSourceCommit
  ) {
    violations.push('workspace CLI identity or imported source provenance changed')
  }
  if (fs.existsSync(path.join(root, 'vendor', 'valedictorian-cli'))) {
    violations.push('obsolete vendored CLI still exists')
  }
  if (fs.existsSync(path.join(cliRoot, 'pnpm-lock.yaml'))) {
    violations.push('CLI package retains a competing nested lockfile')
  }
  if (fs.existsSync(path.join(cliRoot, 'pnpm-workspace.yaml'))) {
    violations.push('CLI package retains a competing nested workspace root')
  }
  if (installedCliPath === null || installedCliPath !== fs.realpathSync(cliRoot)) {
    violations.push('installed CLI does not resolve to the imported workspace source')
  }
  violations.push(...findCliDependencyViolations(root, cliPackage))
  return violations.sort()
}

export function findCliDependencyViolations(root, cliPackage) {
  const violations = []
  const cliRoot = path.join(root, 'packages', 'cli')
  const declared = {
    ...cliPackage.dependencies,
    ...cliPackage.devDependencies,
    ...cliPackage.optionalDependencies,
    ...cliPackage.peerDependencies,
  }
  for (const dependency of forbiddenRuntimeDependencies) {
    if (declared[dependency] !== undefined) {
      violations.push(`packages/cli/package.json: forbidden direct dependency ${dependency}`)
    }
  }
  for (const filePath of listCodeFiles(path.join(cliRoot, 'src'))) {
    const relativePath = path.relative(root, filePath).split(path.sep).join('/')
    const record = readModuleRecord(fs.readFileSync(filePath, 'utf8'), filePath)
    if (record.failure !== null) {
      violations.push(`${relativePath}: ${record.failure}`)
      continue
    }
    if (record.computedDynamicImport) {
      violations.push(`${relativePath}: computed dynamic import is forbidden`)
    }
    for (const specifier of record.specifiers) {
      if (forbiddenRuntimeDependencies.some((dependency) => (
        specifier === dependency || specifier.startsWith(`${dependency}/`)
      ))) {
        violations.push(`${relativePath}: forbidden direct import ${specifier}`)
      }
      if (specifier.startsWith('.') && !inside(cliRoot, path.resolve(path.dirname(filePath), specifier))) {
        violations.push(`${relativePath}: relative import escapes packages/cli`)
      }
      if (specifier.startsWith('@/') || path.isAbsolute(specifier)) {
        violations.push(`${relativePath}: application or absolute source import ${specifier}`)
      }
    }
  }
  return violations.sort()
}

export function readCliCompositionState(root = process.cwd()) {
  let installedCliPath = null
  try {
    installedCliPath = fs.realpathSync(
      path.join(root, 'node_modules', '@sparxie', 'valedictorian-cli'),
    )
  } catch {
    // Missing installation is a policy failure reported by the pure check.
  }
  return {
    cliPackage: readJson(path.join(root, 'packages', 'cli', 'package.json')),
    installedCliPath,
    license: fs.readFileSync(path.join(root, 'LICENSE')),
    lockfile: loadYaml(fs.readFileSync(path.join(root, 'pnpm-lock.yaml'), 'utf8')),
    root,
    rootPackage: readJson(path.join(root, 'package.json')),
    workspace: loadYaml(fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8')),
  }
}

function inside(root, target) {
  const relative = path.relative(root, target)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function run() {
  const violations = findCliCompositionViolations(readCliCompositionState())
  for (const violation of violations) process.stderr.write(`${violation}\n`)
  if (violations.length > 0) process.exitCode = 1
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) run()
