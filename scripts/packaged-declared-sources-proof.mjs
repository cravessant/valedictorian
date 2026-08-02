import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { listPackage } from '@electron/asar'

const packageManifestName = 'package.json'
const automaticPackageFilePattern =
  /^(?:package\.json|licen[cs]e(?:\.[^/]+)?|readme(?:\.[^/]+)?|changelog(?:\.[^/]+)?|history(?:\.[^/]+)?)$/i

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

function findWorkspacePackages(packagesRoot) {
  const packages = new Map()
  const pending = [packagesRoot]

  while (pending.length > 0) {
    const directory = pending.pop()
    if (!directory || !fs.existsSync(directory)) continue

    const manifestPath = path.join(directory, packageManifestName)
    if (fs.existsSync(manifestPath)) {
      const manifest = readJson(manifestPath)
      if (typeof manifest.name === 'string') {
        packages.set(manifest.name, { directory, manifest })
      }
      continue
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !['dist', 'node_modules'].includes(entry.name)) {
        pending.push(path.join(directory, entry.name))
      }
    }
  }

  return packages
}

function runtimeWorkspaceClosure(repositoryRoot) {
  const workspacePackages = findWorkspacePackages(path.join(repositoryRoot, 'packages'))
  const rootManifest = readJson(path.join(repositoryRoot, packageManifestName))
  const pending = Object.keys(rootManifest.dependencies ?? {})
    .filter(packageName => workspacePackages.has(packageName))
  const closure = new Map()

  while (pending.length > 0) {
    const packageName = pending.pop()
    if (!packageName || closure.has(packageName)) continue

    const workspacePackage = workspacePackages.get(packageName)
    if (!workspacePackage) continue
    closure.set(packageName, workspacePackage)

    for (const dependencyName of Object.keys(workspacePackage.manifest.dependencies ?? {})) {
      if (workspacePackages.has(dependencyName)) pending.push(dependencyName)
    }
  }

  return closure
}

function declaredPackageFiles(manifest) {
  const files = manifest.files ?? []
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`${manifest.name} must declare a non-empty package files allowlist`)
  }
  for (const entry of files) {
    if (typeof entry !== 'string' || !/^[A-Za-z0-9._-]+$/.test(entry)) {
      throw new Error(`${manifest.name} has unsupported package files entry ${String(entry)}`)
    }
  }
  return files
}

function isDeclaredPackageEntry(relativePath, declaredFiles) {
  if (automaticPackageFilePattern.test(relativePath)) return true
  return declaredFiles.some(entry => (
    relativePath === entry || relativePath.startsWith(`${entry}/`)
  ))
}

export function inspectPackagedDeclaredSources({ archivePath, repositoryRoot }) {
  const problems = []
  const packageCounts = {}
  const archiveEntries = listPackage(archivePath)
    .map(entry => entry.replace(/^[/\\]+/, '').replaceAll('\\', '/'))
  const workspacePackages = runtimeWorkspaceClosure(repositoryRoot)

  for (const [packageName, { manifest }] of workspacePackages) {
    const packageRoot = `node_modules/${packageName}/`
    const declaredFiles = declaredPackageFiles(manifest)
    const packagedEntries = archiveEntries
      .filter(entry => entry.startsWith(packageRoot))
      .map(entry => entry.slice(packageRoot.length))
      .filter(Boolean)

    packageCounts[packageName] = packagedEntries.length
    if (packagedEntries.length === 0) {
      problems.push(`${packageName} is absent from ${archivePath}`)
      continue
    }

    for (const entry of packagedEntries) {
      if (!isDeclaredPackageEntry(entry, declaredFiles)) {
        problems.push(`${packageName} packages undeclared path ${entry}`)
      }
    }
  }

  return { archivePath, packageCounts, problems }
}

function findArchives(root) {
  const archives = []
  const pending = [root]

  while (pending.length > 0) {
    const entry = pending.pop()
    if (!entry || !fs.existsSync(entry)) continue
    const stat = fs.statSync(entry)
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(entry)) pending.push(path.join(entry, child))
    } else if (path.basename(entry) === 'app.asar') {
      archives.push(entry)
    }
  }

  return archives.sort((left, right) => left.localeCompare(right))
}

function main() {
  const repositoryRoot = process.cwd()
  const rootManifest = readJson(path.join(repositoryRoot, packageManifestName))
  const releaseRoot = path.resolve(
    process.argv[2] ?? path.join('release', String(rootManifest.version)),
  )
  const archives = findArchives(releaseRoot)
  if (archives.length === 0) {
    throw new Error(`No app.asar found beneath ${releaseRoot}`)
  }

  const results = archives.map(archivePath => (
    inspectPackagedDeclaredSources({ archivePath, repositoryRoot })
  ))
  const problems = results.flatMap(result => result.problems)
  if (problems.length > 0) {
    throw new Error(`Packaged declared-source closure failed:\n${problems.join('\n')}`)
  }
  process.stdout.write(`${JSON.stringify({ archives: results })}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main()
