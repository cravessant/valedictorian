import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createMigratedPgliteTemplate,
  PGLITE_TEST_TEMPLATE_PATH_ENV,
} from './pglite-template'

export default async function setup() {
  const templatePath = fs.mkdtempSync(path.join(os.tmpdir(), 'valedictorian-pglite-template-'))
  await createMigratedPgliteTemplate(templatePath)
  process.env[PGLITE_TEST_TEMPLATE_PATH_ENV] = templatePath

  return async function teardown() {
    delete process.env[PGLITE_TEST_TEMPLATE_PATH_ENV]
    fs.rmSync(templatePath, { force: true, recursive: true })
  }
}
