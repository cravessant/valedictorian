export interface ElectronNativeUiProofResultSummary {
  readonly diagnostics?: {
    readonly assertionFailure?: unknown
  }
}

export function electronNativeUiProofFailureMessage({
  output,
  result,
  safeOutput,
}: {
  readonly output: string
  readonly result: ElectronNativeUiProofResultSummary
  readonly safeOutput: (value: string) => string
}) {
  const assertionFailure = typeof result.diagnostics?.assertionFailure === 'string'
    ? safeOutput(result.diagnostics.assertionFailure)
    : null
  return `Electron proof failed${assertionFailure ? `: ${assertionFailure}` : ''}. ${safeOutput(output)}`
}
