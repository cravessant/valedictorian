export interface RuntimeLifecycleHandle {
  close(): Promise<void>
  stopScheduler?(): Promise<void>
}

export interface BackendSupervisorLifecycleHandle {
  stop(): Promise<void>
}

export function createRuntimeQuitBarrier({
  closeRuntime,
  onError = () => undefined,
  quit,
}: {
  closeRuntime: () => Promise<void>
  onError?: (error: unknown) => void
  quit: () => void
}) {
  let cleanupStarted = false
  let cleanupPromise: Promise<void> | null = null
  let quitAllowed = false

  return {
    requestQuit(event: { preventDefault(): void }) {
      if (quitAllowed) return
      event.preventDefault()
      if (cleanupStarted) return
      cleanupStarted = true
      cleanupPromise = closeRuntime()
        .catch(onError)
        .then(() => {
          quitAllowed = true
          quit()
        })
    },
    whenSettled() {
      return cleanupPromise ?? Promise.resolve()
    },
  }
}

export async function stopRuntimeLifecycle({
  backendSupervisor,
  runtime,
}: {
  backendSupervisor: BackendSupervisorLifecycleHandle | null
  runtime: RuntimeLifecycleHandle | null
}): Promise<void> {
  if (backendSupervisor) {
    await runtime?.stopScheduler?.()
    await backendSupervisor.stop()
    await runtime?.close()
    return
  }

  await runtime?.close()
}
