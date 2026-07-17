import type { AppConnectorSecretResolver } from '../connectors/connector.runner'
import type { SecretService } from './secret.service'

export function createConnectorSecretResolver(
  secretService: Pick<SecretService, 'resolve'>,
): AppConnectorSecretResolver {
  return {
    async revealSecret(key) {
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
