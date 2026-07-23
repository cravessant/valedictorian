if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
  const { configure } = await import('@testing-library/react')
  configure({ asyncUtilTimeout: process.env.CI ? 15_000 : 1_000 })

  if (typeof globalThis.ResizeObserver === 'undefined') {
    globalThis.ResizeObserver = class TestResizeObserver implements ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    }
  }
}

export {}
