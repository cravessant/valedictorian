import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './packages/local-runtime/src/db/schema.ts',
  out: './packages/local-runtime/drizzle',
  dialect: 'postgresql',
  driver: 'pglite',
  dbCredentials: {
    url: './.data/pglite',
  },
})
