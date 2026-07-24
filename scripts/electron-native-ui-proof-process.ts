import type { ChildProcess } from 'node:child_process'

type ProofSignal = 'SIGINT' | 'SIGTERM'

interface SignalProcess {
  readonly platform: NodeJS.Platform
  kill(processId: number, signal: ProofSignal): boolean
  off(event: ProofSignal, listener: () => void): this
  on(event: ProofSignal, listener: () => void): this
}

export function installElectronNativeUiProofSignalForwarding(
  proof: Pick<ChildProcess, 'kill' | 'pid'>,
  signalProcess: SignalProcess = process,
) {
  let forwardingError: Error | undefined
  const forward = (signal: ProofSignal) => {
    if (!proof.pid) return
    try {
      if (signalProcess.platform === 'win32') {
        proof.kill(signal)
      } else {
        signalProcess.kill(-proof.pid, signal)
      }
    } catch (error) {
      if (!isMissingProcess(error)) {
        forwardingError = error instanceof Error ? error : new Error(String(error))
      }
    }
  }
  const onInterrupt = () => forward('SIGINT')
  const onTerminate = () => forward('SIGTERM')
  signalProcess.on('SIGINT', onInterrupt)
  signalProcess.on('SIGTERM', onTerminate)
  return {
    error: () => forwardingError,
    stop() {
      signalProcess.off('SIGINT', onInterrupt)
      signalProcess.off('SIGTERM', onTerminate)
    },
  }
}

function isMissingProcess(error: unknown) {
  return error instanceof Error && 'code' in error && error.code === 'ESRCH'
}
