import fs from 'node:fs'
import path from 'node:path'
import { createPgliteClient, migratePgliteDatabase } from '../db/pglite'

export const PGLITE_TEST_TEMPLATE_PATH_ENV = 'VALEDICTORIAN_PGLITE_TEST_TEMPLATE_PATH'

export async function createMigratedPgliteTemplate(templatePath: string) {
  assertEmptyDirectory(templatePath, 'PGlite template directory')
  const client = await createPgliteClient({ dataDir: templatePath })
  try {
    await migratePgliteDatabase(client)
  } finally {
    await client.close()
  }
}

export function cloneMigratedPgliteTemplate(templatePath: string, targetPath: string) {
  const resolvedTemplatePath = path.resolve(templatePath)
  const resolvedTargetPath = path.resolve(targetPath)
  if (resolvedTemplatePath === resolvedTargetPath) {
    throw new Error('PGlite template target must differ from the template')
  }
  if (!fs.existsSync(resolvedTemplatePath)) {
    throw new Error(`PGlite template does not exist: ${resolvedTemplatePath}`)
  }
  assertEmptyDirectory(resolvedTargetPath, 'PGlite template target')
  copyDirectoryContents(resolvedTemplatePath, resolvedTargetPath)
}

export function cloneConfiguredPgliteTemplate(targetPath: string) {
  const templatePath = process.env[PGLITE_TEST_TEMPLATE_PATH_ENV]
  if (!templatePath) {
    throw new Error(`${PGLITE_TEST_TEMPLATE_PATH_ENV} is not configured by Vitest global setup`)
  }
  cloneMigratedPgliteTemplate(templatePath, targetPath)
}

export function prepareConfiguredPgliteDataPath(targetPath: string) {
  if (fs.existsSync(targetPath) && fs.readdirSync(targetPath).length > 0) return false
  cloneConfiguredPgliteTemplate(targetPath)
  return true
}

function assertEmptyDirectory(directoryPath: string, label: string) {
  fs.mkdirSync(directoryPath, { recursive: true })
  if (fs.readdirSync(directoryPath).length > 0) {
    throw new Error(`${label} must be empty: ${directoryPath}`)
  }
}

function copyDirectoryContents(sourcePath: string, targetPath: string) {
  for (const entry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
    const sourceEntryPath = path.join(sourcePath, entry.name)
    const targetEntryPath = path.join(targetPath, entry.name)
    if (entry.isDirectory()) {
      fs.mkdirSync(targetEntryPath)
      copyDirectoryContents(sourceEntryPath, targetEntryPath)
      continue
    }
    if (entry.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(sourceEntryPath), targetEntryPath)
      continue
    }
    if (!entry.isFile()) {
      throw new Error(`Unsupported PGlite template entry: ${sourceEntryPath}`)
    }
    fs.copyFileSync(sourceEntryPath, targetEntryPath, fs.constants.COPYFILE_FICLONE)
  }
}
