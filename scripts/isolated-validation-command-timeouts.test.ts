import { describe, expect, it } from 'vitest'
import {
  isolatedValidationCommandMatrixTestTimeoutMs,
  isolatedValidationCommandMatrixTimeoutMs,
  isolatedValidationMatrixTeardownMarginMs,
} from './isolated-validation-command-timeouts'

describe('isolated validation command timeouts', () => {
  it('covers every sequential session window plus explicit cleanup time', () => {
    expect(isolatedValidationCommandMatrixTimeoutMs).toBe(406_000)
    expect(isolatedValidationCommandMatrixTestTimeoutMs).toBe(
      isolatedValidationCommandMatrixTimeoutMs + isolatedValidationMatrixTeardownMarginMs,
    )
  })
})
