export function cliUiDevProofLaunch({
  display = process.env.DISPLAY,
  nodeExecutable = process.execPath,
  platform = process.platform,
}: {
  readonly display?: string
  readonly nodeExecutable?: string
  readonly platform?: NodeJS.Platform
} = {}) {
  const command = [
    nodeExecutable,
    '--import',
    'tsx',
    'scripts/run-isolated-validation.ts',
    '--proof-dev',
    '--timeout-ms',
    '120000',
  ]
  return platform === 'linux' && !display
    ? {
        args: ['--auto-servernum', '--server-args=-screen 0 1280x1024x24', ...command],
        command: 'xvfb-run',
      }
    : { args: command.slice(1), command: command[0] }
}
