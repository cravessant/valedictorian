import fs from 'node:fs'
import path from 'node:path'
import { createPgliteClient, migratePgliteDatabase } from '@sparxie/valedictorian-local-runtime/database'

const pgliteDataPath =
  process.env.VALEDICTORIAN_PGLITE_DATA_PATH ?? path.join('.data', 'pglite')

fs.mkdirSync(pgliteDataPath, { recursive: true })

const client = await createPgliteClient({ dataDir: pgliteDataPath })
try {
  await migratePgliteDatabase(client)
} finally {
  await client.close()
}

console.log(`Migrated PGlite database at ${pgliteDataPath}`)
