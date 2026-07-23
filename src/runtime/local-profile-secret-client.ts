import type {
  ProfileSensitiveDetails,
  ProfileSensitiveDetailsInput,
  UserProfile,
  ValedictorianWorkspaceClient,
} from '@sparxie/sdk'
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

/**
 * Derive the deprecated 0.27 compatibility sensitive-profile surface from the live profile.
 * The dedicated sensitive-details table was retired (#267); non-secret self-id facts now live on
 * `UserProfile`, and SSN remains identity-secret only (never resolvable through this surface, so
 * `ssnLast4` is always null locally). Kept only for the cutover window.
 */
function deriveProfileSensitiveDetails(profile: UserProfile): ProfileSensitiveDetails {
  const dateOfBirth = profile.dateOfBirth
  const [birthYear, birthMonth, birthDay] = dateOfBirth
    ? dateOfBirth.split('-')
    : [null, null, null]
  return {
    dateOfBirth,
    disabilityStatus: profile.disabilityStatus,
    gender: profile.gender,
    hispanicLatino: profile.hispanicLatino,
    raceEthnicity: profile.raceEthnicity,
    veteranStatus: profile.veteranStatus,
    birthDay: birthDay ?? null,
    birthMonth: birthMonth ?? null,
    birthYear: birthYear ?? null,
    ssnLast4: null,
  }
}

function sensitiveInputToProfilePatch(input: ProfileSensitiveDetailsInput): Partial<UserProfile> {
  const patch: Record<string, unknown> = {}
  for (const key of [
    'disabilityStatus', 'gender', 'hispanicLatino', 'raceEthnicity', 'veteranStatus',
  ] as const) {
    if (input[key] !== undefined) patch[key] = input[key]
  }
  if (input.dateOfBirth !== undefined) {
    patch.dateOfBirth = input.dateOfBirth
  } else if (
    input.birthYear !== undefined || input.birthMonth !== undefined || input.birthDay !== undefined
  ) {
    patch.dateOfBirth = input.birthYear && input.birthMonth && input.birthDay
      ? `${input.birthYear}-${input.birthMonth}-${input.birthDay}`
      : null
  }
  return patch as Partial<UserProfile>
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
      get: async () => deriveProfileSensitiveDetails(await profileService.get()),
      update: async (input) =>
        deriveProfileSensitiveDetails(await profileService.update(sensitiveInputToProfilePatch(input))),
    },
  } as ValedictorianWorkspaceClient['profile']
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
