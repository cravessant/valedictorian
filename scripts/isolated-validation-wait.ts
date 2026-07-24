export interface IsolatedValidationWaitOptions {
  readonly description: string
  readonly intervalMs?: number
  readonly now?: () => number
  readonly sleep?: (milliseconds: number) => Promise<void>
  readonly timeoutMs: number
}

export async function waitForIsolatedValidationCondition(
  predicate: () => boolean,
  {
    description,
    intervalMs = 50,
    now = Date.now,
    sleep = (milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    timeoutMs,
  }: IsolatedValidationWaitOptions,
) {
  const deadline = now() + timeoutMs
  while (!predicate()) {
    if (now() >= deadline) throw new Error(`Timed out waiting for ${description}.`)
    await sleep(intervalMs)
  }
}
