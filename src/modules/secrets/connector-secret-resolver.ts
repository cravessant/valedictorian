import type { AppConnectorSecretResolver } from '../connectors/connector.runner'
import type { SecretService } from './secret.service'
import { isReservedIdentitySecretKey } from './secret.identity'

export function createConnectorSecretResolver(
  secretService: Pick<SecretService, 'resolve'>,
): AppConnectorSecretResolver {
  return {
    async revealSecret(key) {
      if (isReservedIdentitySecretKey(key)) return null
      const secret = await secretService.resolve(key)
      if (!secret) {
        return null
      }

      return {
        key: secret.key,
        value: secret.value,
      }
    },
  }
}
