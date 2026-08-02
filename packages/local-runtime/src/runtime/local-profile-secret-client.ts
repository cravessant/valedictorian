import type { ValedictorianWorkspaceClient } from '@sparxie/sdk'
import type { AppConnectorAuthHost } from '../modules/connectors/public.js'
import type { ProfileService } from '../modules/profile/public.js'
import {
  createConnectorSecretResolver,
  rejectUnsupportedLocalSecretResolution,
  type LocalSecretResolutionService,
  type SecretService,
} from '../modules/secrets/public.js'

export function composeTrustedConnectorAuth(
  secretService: Pick<SecretService, 'resolve'>,
): AppConnectorAuthHost {
  return {
    secrets: createConnectorSecretResolver(secretService),
  }
}

export function createWorkspaceProfileMethods(
  profileService: ProfileService,
): ValedictorianWorkspaceClient['profile'] {
  return {
    get: () => profileService.get(),
    update: (input) => profileService.update(input),
    agentContext: {
      get: () => profileService.getAgentContext(),
    },
    document: {
      get: () => profileService.getDocument(),
      update: (input) => profileService.updateDocument(input),
      validate: () => profileService.validateDocument(),
      format: (input) => profileService.formatDocument(input),
      restore: (input) => profileService.restoreDocument(input),
    },
  }
}

export function createWorkspaceSecretMethods(
  secretService: SecretService,
  localResolution: LocalSecretResolutionService = {
    resolve: rejectUnsupportedLocalSecretResolution,
  },
): ValedictorianWorkspaceClient['secrets'] {
  return {
    delete: (key) => secretService.delete(key),
    list: () => secretService.listResult(),
    upsert: (input) => secretService.upsert(input),
    local: {
      resolve: (input) => localResolution.resolve(input),
    },
  }
}
