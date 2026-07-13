export function completedConnectorRefreshContract(earliestDate = '2026-07-01') {
  return {
    operationOutcome: null,
    status: 'completed' as const,
    synchronization: {
      newestFrontier: { state: 'caught_up' as const },
      historicalBackfill: { state: 'caught_up' as const, boundary: { earliestDate } },
      pendingResolutionCount: 0,
      outcome: { kind: 'caught_up' as const },
    },
  }
}
