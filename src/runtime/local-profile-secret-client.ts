import type { ValedictorianWorkspaceClient } from 'sparxie'
import type { ProfileService } from '../modules/profile/profile.service'
import { createConnectorSecretResolver } from '../modules/secrets/connector-secret-resolver'
import { rejectUnsupportedLocalSecretResolution } from '../modules/secrets/local-secret-resolution'
import type { SecretService } from '../modules/secrets/secret.service'
import type { AppConnectorAuthHost } from '../modules/connectors/connector.runner'

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
    sensitive: {
      get: () => profileService.getSensitiveDetails(),
      update: (input) => profileService.updateSensitiveDetails(input),
    },
  }
}

export function createWorkspaceSecretMethods(
  secretService: SecretService,
  localResolution: { resolve: (input: unknown) => Promise<unknown> } = {
    resolve: (input) => rejectUnsupportedLocalSecretResolution(
      input as Parameters<typeof rejectUnsupportedLocalSecretResolution>[0],
    ),
  },
): ValedictorianWorkspaceClient['secrets'] {
  return {
    delete: (key) => secretService.delete(key),
    list: () => secretService.listResult(),
    upsert: (input) => secretService.upsert(input),
    local: {
      resolve: (input) => localResolution.resolve(input) as ReturnType<
        ValedictorianWorkspaceClient['secrets']['local']['resolve']
      >,
    },
  }
}
