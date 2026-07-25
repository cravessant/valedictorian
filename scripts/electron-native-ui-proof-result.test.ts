import { describe, expect, it } from 'vitest'

import { electronNativeUiProofFailureMessage } from './electron-native-ui-proof-result'

describe('Electron native UI proof result', () => {
  it('places the persisted assertion failure before truncated child output', () => {
    expect(electronNativeUiProofFailureMessage({
      output: 'very long child output',
      result: { diagnostics: { assertionFailure: 'form-modal at 768px: close is clipped' } },
      safeOutput: (value) => `[safe] ${value}`,
    })).toBe('Electron proof failed: [safe] form-modal at 768px: close is clipped. [safe] very long child output')
  })
})
