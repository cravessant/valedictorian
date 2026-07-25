export type ElectronNativeUiProofMode = 'capture-completion-layout' | 'dialog-close-target' | 'workflow'

/**
 * Wide enough for the widest CSS viewport the geometry proofs request (1440)
 * plus window chrome. The proofs assert the renderer viewport matches the
 * requested one, so a screen too small to hold it fails rather than measuring
 * a clamped window.
 */
const virtualScreen = '1920x1080x24'

export function electronNativeUiProofLaunch({
  display = process.env.DISPLAY,
  nodeExecutable = process.execPath,
  platform = process.platform,
  proof = 'workflow',
}: {
  readonly display?: string
  readonly nodeExecutable?: string
  readonly platform?: NodeJS.Platform
  readonly proof?: ElectronNativeUiProofMode
} = {}) {
  const command = [
    nodeExecutable,
    '--import',
    'tsx',
    'scripts/run-isolated-validation.ts',
    proof === 'capture-completion-layout'
      ? '--proof-electron-layout'
      : proof === 'dialog-close-target'
        ? '--proof-electron-close-target'
        : '--proof-electron',
    '--timeout-ms',
    '120000',
  ]
  return platform === 'linux' && !display
    ? {
        args: ['--auto-servernum', `--server-args=-screen 0 ${virtualScreen}`, ...command],
        command: 'xvfb-run',
      }
    : { args: command.slice(1), command: command[0] }
}
