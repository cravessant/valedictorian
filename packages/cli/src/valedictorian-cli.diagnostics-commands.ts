import {
  booleanFlags,
  makeCommand,
  optionFlags,
  optionValue,
  parseTimeoutMs,
  readPackageVersion,
  writeJson,
} from './valedictorian-cli.command-runtime.js'
import { formatDoctorText, runContext, runDoctor } from './valedictorian-cli.doctor.js'

export function buildContextCommand() {
  return makeCommand({
    docs: { brief: 'Print current CLI target context' },
    flags: {
      ...optionFlags(['timeout-ms', 'workspace']),
      ...booleanFlags(['skip-network']),
    },
    run: async (context, flags) => {
      writeJson(
        context,
        await runContext({
          cwd: context.cwd,
          env: context.env,
          skipNetwork: flags['skip-network'] === true,
          timeoutMs: parseTimeoutMs(optionValue(flags, 'timeout-ms')),
          workspaceSelector: optionValue(flags, 'workspace'),
        }),
      )
    },
  })
}

export function buildDoctorCommand() {
  return makeCommand({
    docs: { brief: 'Run read-only CLI diagnostics' },
    flags: {
      ...optionFlags(['timeout-ms', 'workspace']),
      ...booleanFlags(['skip-network']),
    },
    run: async (context, flags) => {
      const report = await runDoctor({
        cliVersion: await readPackageVersion(),
        cwd: context.cwd,
        env: context.env,
        skipNetwork: flags['skip-network'] === true,
        timeoutMs: parseTimeoutMs(optionValue(flags, 'timeout-ms')),
        workspaceSelector: optionValue(flags, 'workspace'),
      })

      if (flags.json === true) {
        writeJson(context, report)
      } else {
        context.process.stdout.write(formatDoctorText(report))
      }

      if (!report.ok) {
        context.process.exitCode = 1
      }
    },
  })
}
