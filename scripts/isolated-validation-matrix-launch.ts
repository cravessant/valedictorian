export function isolatedValidationMatrixLaunch({
  display = process.env.DISPLAY,
  platform = process.platform,
}: {
  readonly display?: string
  readonly platform?: NodeJS.Platform
} = {}) {
  const command = ['pnpm', 'exec', 'tsx', 'scripts/isolated-validation.command-matrix.ts']
  return platform === 'linux' && !display
    ? {
        args: ['--auto-servernum', '--server-args=-screen 0 1280x1024x24', ...command],
        command: 'xvfb-run',
      }
    : { args: command.slice(1), command: command[0] }
}
