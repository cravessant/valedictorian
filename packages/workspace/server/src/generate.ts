import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeWorkspaceContractArtifacts } from './generator.js'

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..',
)

writeWorkspaceContractArtifacts(repositoryRoot)
