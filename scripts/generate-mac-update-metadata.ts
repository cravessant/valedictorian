import crypto from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export interface MacUpdateFileInfo {
  readonly sha512: string
  readonly size: number
  readonly url: string
}

export interface CreateMacUpdateMetadataOptions {
  readonly now?: Date
  readonly releaseDir: string
  readonly version: string
}

export interface GenerateMacUpdateMetadataOptions {
  readonly now?: Date
  readonly packageJsonPath?: string
  readonly projectDir?: string
  readonly releaseRoot?: string
}

export interface GeneratedMacUpdateMetadata {
  readonly filePath: string
  readonly files: MacUpdateFileInfo[]
  readonly yaml: string
}

function quoteYamlString(value: string) {
  return JSON.stringify(value)
}

async function hashFileSha512Base64(filePath: string) {
  const hash = crypto.createHash('sha512')

  await new Promise<void>((resolve, reject) => {
    createReadStream(filePath)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', resolve)
  })

  return hash.digest('base64')
}

async function getUpdateFileInfo(releaseDir: string, fileName: string): Promise<MacUpdateFileInfo> {
  const filePath = path.join(releaseDir, fileName)
  const [sha512, stats] = await Promise.all([hashFileSha512Base64(filePath), fs.stat(filePath)])

  return {
    sha512,
    size: stats.size,
    url: fileName,
  }
}

function createYaml(version: string, files: MacUpdateFileInfo[], now: Date) {
  const primaryFile = files[0]
  if (primaryFile == null) {
    throw new Error('At least one Mac update file is required')
  }

  const lines = [`version: ${quoteYamlString(version)}`, 'files:']

  for (const file of files) {
    lines.push(
      `  - url: ${quoteYamlString(file.url)}`,
      `    sha512: ${quoteYamlString(file.sha512)}`,
      `    size: ${file.size}`,
    )
  }

  lines.push(
    `path: ${quoteYamlString(primaryFile.url)}`,
    `sha512: ${quoteYamlString(primaryFile.sha512)}`,
    `releaseDate: ${quoteYamlString(now.toISOString())}`,
    '',
  )

  return lines.join('\n')
}

export async function createMacUpdateMetadata({
  now = new Date(),
  releaseDir,
  version,
}: CreateMacUpdateMetadataOptions): Promise<GeneratedMacUpdateMetadata> {
  const entries = await fs.readdir(releaseDir, { withFileTypes: true })
  const artifactNames = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)

  const zipFile = artifactNames.find((fileName) => fileName.endsWith('.zip'))
  const dmgFile = artifactNames.find((fileName) => fileName.endsWith('.dmg'))

  if (zipFile == null) {
    throw new Error(`No Mac zip artifact found in ${releaseDir}`)
  }

  if (dmgFile == null) {
    throw new Error(`No Mac dmg artifact found in ${releaseDir}`)
  }

  const files = await Promise.all([
    getUpdateFileInfo(releaseDir, zipFile),
    getUpdateFileInfo(releaseDir, dmgFile),
  ])
  const yaml = createYaml(version, files, now)
  const filePath = path.join(releaseDir, 'latest-mac.yml')

  await fs.writeFile(filePath, yaml)

  return {
    filePath,
    files,
    yaml,
  }
}

export async function generateMacUpdateMetadata({
  now = new Date(),
  packageJsonPath = 'package.json',
  projectDir = process.cwd(),
  releaseRoot = 'release',
}: GenerateMacUpdateMetadataOptions = {}): Promise<GeneratedMacUpdateMetadata> {
  const packageJson = JSON.parse(
    await fs.readFile(path.resolve(projectDir, packageJsonPath), 'utf8'),
  ) as {
    version?: string
  }

  if (packageJson.version == null) {
    throw new Error('package.json version is required to generate Mac update metadata')
  }

  const releaseRootPath = path.resolve(projectDir, releaseRoot)
  const releaseDirs = (await fs.readdir(releaseRootPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(releaseRootPath, entry.name))

  if (releaseDirs.length !== 1) {
    throw new Error(`Expected exactly one release directory in ${releaseRootPath}`)
  }

  return createMacUpdateMetadata({
    now,
    releaseDir: releaseDirs[0]!,
    version: packageJson.version,
  })
}

const invokedPath = process.argv[1] == null ? null : path.resolve(process.argv[1])

if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = await generateMacUpdateMetadata()
  console.log(`Generated ${path.relative(process.cwd(), result.filePath)}`)
}
