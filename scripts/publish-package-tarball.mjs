import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const registry = 'https://registry.npmjs.org'
const productRepository = 'git+https://github.com/cravessant/valedictorian.git'
const forbiddenDependencySource =
  /^(?:file:|git(?:\+[^:]+)?:|github:|https?:|link:|workspace:)/
const approvedPackageDirectories = new Map([
  ['@sparxie/valedictorian-cli', 'packages/cli'],
  ['@sparxie/valedictorian-connectors-core', 'packages/connector-api'],
  [
    '@sparxie/valedictorian-connectors-test-harness',
    'packages/connector-testkit',
  ],
  ['@sparxie/valedictorian-local-runtime', 'packages/local-runtime'],
  ['@sparxie/valedictorian-workspace-client', 'packages/workspace/client'],
  [
    '@sparxie/valedictorian-workspace-conformance',
    'packages/workspace/conformance',
  ],
  ['@sparxie/valedictorian-workspace-server', 'packages/workspace/server'],
])

export function inspectReleaseTarball(tarballPath) {
  const manifestSource = execFileSync(
    'tar',
    ['-xOf', tarballPath, 'package/package.json'],
    { encoding: 'utf8' },
  )
  const manifest = JSON.parse(manifestSource)
  const violations = []

  const approvedDirectory = approvedPackageDirectories.get(manifest.name)
  if (approvedDirectory === undefined) {
    violations.push('package name is outside the approved Valedictorian scope')
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    violations.push('package version is missing')
  }
  if (manifest.private === true) violations.push('package is marked private')
  if (manifest.license !== 'MIT') violations.push('package license must be MIT')
  if (manifest.repository?.url !== productRepository) {
    violations.push('package repository must resolve to the public product')
  }
  if (manifest.repository?.directory !== approvedDirectory) {
    violations.push('package repository directory is not the reviewed source boundary')
  }
  if (manifest.homepage !== 'https://github.com/cravessant/valedictorian#readme') {
    violations.push('package homepage must resolve to the public product')
  }
  if (manifest.bugs?.url !== 'https://github.com/cravessant/valedictorian/issues') {
    violations.push('package issue link must resolve to the public product')
  }
  if (manifest.publishConfig?.access !== 'public') {
    violations.push('package publish access must be public')
  }
  if (manifest.publishConfig?.registry !== `${registry}/`) {
    violations.push('package registry must be the public npm registry')
  }

  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [name, specifier] of Object.entries(manifest[field] ?? {})) {
      if (forbiddenDependencySource.test(String(specifier))) {
        violations.push(`${field}.${name} uses forbidden source ${specifier}`)
      }
    }
  }

  return {
    integrity: `sha512-${crypto
      .createHash('sha512')
      .update(fs.readFileSync(tarballPath))
      .digest('base64')}`,
    manifest,
    violations,
  }
}

export function assertNpmOidcVersion(version) {
  const [major = 0, minor = 0] = version.split('.').map(Number)
  if (major < 11 || (major === 11 && minor < 5)) {
    throw new Error(`npm ${version} is too old for Trusted Publishing OIDC`)
  }
}

export function registryReceiptViolations({
  distTag,
  integrity,
  name,
  packument,
  version,
}) {
  const violations = []
  const published = packument.versions?.[version]
  if (packument['dist-tags']?.[distTag] !== version) {
    violations.push(`${distTag} dist-tag does not select ${version}`)
  }
  if (published?.dist?.integrity !== integrity) {
    violations.push('registry integrity does not match the packed artifact')
  }
  if (!published?.dist?.attestations?.provenance) {
    violations.push('registry provenance attestation is missing')
  }
  if (!(published?.dist?.signatures?.length > 0)) {
    violations.push('registry signature is missing')
  }
  if (published?.repository?.url !== productRepository) {
    violations.push(`${name}@${version} registry repository is not the public product`)
  }
  if (published?.repository?.directory !== approvedPackageDirectories.get(name)) {
    violations.push(`${name}@${version} registry repository directory is incorrect`)
  }
  if (published?.name !== name) {
    violations.push(`${name}@${version} registry package name is incorrect`)
  }
  if (published?.version !== version) {
    violations.push(`${name}@${version} registry package version is incorrect`)
  }
  if (published?.license !== 'MIT') {
    violations.push(`${name}@${version} registry license is not MIT`)
  }
  if (published?.homepage !== 'https://github.com/cravessant/valedictorian#readme') {
    violations.push(`${name}@${version} registry homepage is incorrect`)
  }
  if (published?.bugs?.url !== 'https://github.com/cravessant/valedictorian/issues') {
    violations.push(`${name}@${version} registry issue link is incorrect`)
  }
  return violations
}

async function readRegistryReceipt({
  distTag,
  integrity,
  maxAttempts,
  name,
  version,
}) {
  const endpoint = `${registry}/${encodeURIComponent(name)}`
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(endpoint, {
      headers: { accept: 'application/json' },
    })
    if (response.ok) {
      const packument = await response.json()
      const violations = registryReceiptViolations({
        distTag,
        integrity,
        name,
        packument,
        version,
      })
      if (violations.length === 0) return packument.versions[version]
    }
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2_000))
    }
  }
  throw new Error(
    `${name}@${version} registry receipt lacks the ${distTag} tag, `
      + 'exact artifact metadata, signature, or provenance',
  )
}

export async function publishReleaseTarball({
  distTag,
  dryRun = false,
  tarballPath,
}) {
  if (!/^[a-z][a-z0-9._-]*$/.test(distTag)) {
    throw new Error(`Invalid npm dist-tag: ${distTag}`)
  }
  const inspection = inspectReleaseTarball(tarballPath)
  if (inspection.violations.length > 0) {
    throw new Error(inspection.violations.join('\n'))
  }
  if (dryRun) return { ...inspection, published: false, skipped: false }

  const npmVersion = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim()
  assertNpmOidcVersion(npmVersion)
  const { name, version } = inspection.manifest
  const endpoint = `${registry}/${encodeURIComponent(name)}/${encodeURIComponent(version)}`
  const existingResponse = await fetch(endpoint, {
    headers: { accept: 'application/json' },
  })
  if (existingResponse.ok) {
    const existing = await existingResponse.json()
    if (existing.dist?.integrity !== inspection.integrity) {
      throw new Error(`${name}@${version} already exists with different integrity`)
    }
    const receipt = await readRegistryReceipt({
      distTag,
      integrity: inspection.integrity,
      maxAttempts: 1,
      name,
      version,
    })
    process.stdout.write(
      `${name}@${version} already has the exact artifact and ${distTag} receipt; skipping\n`,
    )
    return { ...inspection, published: false, receipt, skipped: true }
  }
  if (existingResponse.status !== 404) {
    throw new Error(
      `Registry preflight failed for ${name}@${version}: HTTP ${existingResponse.status}`,
    )
  }

  execFileSync(
    'npm',
    [
      'publish',
      path.resolve(tarballPath),
      '--access',
      'public',
      '--tag',
      distTag,
      '--provenance',
    ],
    { stdio: 'inherit' },
  )
  const receipt = await readRegistryReceipt({
    distTag,
    integrity: inspection.integrity,
    maxAttempts: 10,
    name,
    version,
  })
  return { ...inspection, published: true, receipt, skipped: false }
}

function parseArguments(argv) {
  const args = [...argv]
  const dryRunIndex = args.indexOf('--verify-only')
  const dryRun = dryRunIndex >= 0
  if (dryRun) args.splice(dryRunIndex, 1)
  if (args.length !== 2) {
    throw new Error(
      'Usage: publish-package-tarball.mjs [--verify-only] <tarball> <dist-tag>',
    )
  }
  return { distTag: args[1], dryRun, tarballPath: args[0] }
}

async function run() {
  const arguments_ = parseArguments(process.argv.slice(2))
  const result = await publishReleaseTarball(arguments_)
  process.stdout.write(`${JSON.stringify({
    distTag: arguments_.distTag,
    integrity: result.integrity,
    name: result.manifest.name,
    published: result.published,
    registry,
    registryReceipt: result.receipt ?? null,
    skipped: result.skipped,
    version: result.manifest.version,
  })}\n`)
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined
if (invokedPath === import.meta.url) await run()
