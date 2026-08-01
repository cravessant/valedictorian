import { describe, expect, it } from "vitest"

import { scheduleRetry } from "./index.js"

describe("shared retry policy", () => {
  it.each([
    ["nowEpochMs", 0],
    ["nowEpochMs", 1.5],
    ["nowEpochMs", 8_640_000_000_000_001],
    ["baseDelayMs", 0],
    ["baseDelayMs", 1.5],
    ["baseDelayMs", 8_640_000_000_000_001],
    ["maxDelayMs", 0],
    ["maxDelayMs", 1.5],
    ["maxDelayMs", 8_640_000_000_000_001],
  ] as const)("rejects invalid millisecond input %s=%s", (field, value) => {
    expect(() =>
      scheduleRetry(
        {
          attempt: 1,
          baseDelayMs: field === "baseDelayMs" ? value : 1_000,
          horizonAt: "2026-07-10T01:00:00.000Z",
          maxAttempts: 5,
          maxDelayMs: field === "maxDelayMs" ? value : 30_000,
          reason: "network_interruption",
        },
        {
          nowEpochMs: () =>
            field === "nowEpochMs"
              ? value
              : Date.parse("2026-07-10T00:00:00.000Z"),
          random: () => 0,
        },
      ),
    ).toThrow(`${field} must be a positive safe millisecond value`)
  })

  it("uses full jitter with an operational one millisecond floor", () => {
    expect(
      scheduleRetry(
        {
          attempt: 1,
          baseDelayMs: 1_000,
          horizonAt: "2026-07-10T01:00:00.000Z",
          maxAttempts: 5,
          maxDelayMs: 30_000,
          reason: "rate_limit",
        },
        {
          nowEpochMs: () => Date.parse("2026-07-10T00:00:00.000Z"),
          random: () => 0,
        },
      ),
    ).toEqual({
      attempt: 1,
      computedDelayMs: 1,
      horizonAt: "2026-07-10T01:00:00.000Z",
      lastAttemptAt: "2026-07-10T00:00:00.000Z",
      maxAttempts: 5,
      nextAttemptAt: "2026-07-10T00:00:00.001Z",
      reason: "rate_limit",
      state: "scheduled",
    })
  })

  it("grows exponentially by completed attempt and respects the maximum cap", () => {
    const delays = [1, 2, 3, 8].map(
      (attempt) =>
        scheduleRetry(
          {
            attempt,
            baseDelayMs: 1_000,
            horizonAt: "2026-07-10T01:00:00.000Z",
            maxAttempts: 10,
            maxDelayMs: 5_000,
            reason: "server_failure",
          },
          {
            nowEpochMs: () => Date.parse("2026-07-10T00:00:00.000Z"),
            random: () => 0.999,
          },
        ).computedDelayMs,
    )

    expect(delays).toEqual([999, 1_998, 3_996, 4_995])
  })

  it.each([Number.NaN, -0.1, 1, Number.POSITIVE_INFINITY])(
    "rejects invalid randomness %s",
    (random) => {
      expect(() =>
        scheduleRetry(
          {
            attempt: 1,
            baseDelayMs: 1_000,
            horizonAt: "2026-07-10T01:00:00.000Z",
            maxAttempts: 5,
            maxDelayMs: 30_000,
            reason: "network_interruption",
          },
          {
            nowEpochMs: () => Date.parse("2026-07-10T00:00:00.000Z"),
            random: () => random,
          },
        ),
      ).toThrow("random must be in [0, 1)")
    },
  )

  it("honors a sanitized server minimum with bounded positive jitter", () => {
    expect(
      scheduleRetry(
        {
          attempt: 1,
          baseDelayMs: 1_000,
          horizonAt: "2026-07-10T01:00:00.000Z",
          maxAttempts: 5,
          maxDelayMs: 30_000,
          reason: "rate_limit",
          serverMinimumDelayMs: 30_000,
        },
        {
          nowEpochMs: () => Date.parse("2026-07-10T00:00:00.000Z"),
          random: () => 0.999,
        },
      ),
    ).toMatchObject({
      computedDelayMs: 31_000,
      nextAttemptAt: "2026-07-10T00:00:31.000Z",
      serverMinimumDelayMs: 30_000,
    })
  })

  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    "rejects an unsanitized server minimum %s",
    (serverMinimumDelayMs) => {
      expect(() =>
        scheduleRetry(
          {
            attempt: 1,
            baseDelayMs: 1_000,
            horizonAt: "2026-07-10T01:00:00.000Z",
            maxAttempts: 5,
            maxDelayMs: 30_000,
            reason: "rate_limit",
            serverMinimumDelayMs,
          },
          {
            nowEpochMs: () => Date.parse("2026-07-10T00:00:00.000Z"),
            random: () => 0,
          },
        ),
      ).toThrow("serverMinimumDelayMs must be a positive safe integer")
    },
  )

  it.each([
    {
      name: "attempt ceiling",
      attempt: 3,
      horizonAt: "2026-07-10T01:00:00.000Z",
      serverMinimumDelayMs: undefined,
    },
    {
      name: "finite horizon",
      attempt: 1,
      horizonAt: "2026-07-10T00:00:10.000Z",
      serverMinimumDelayMs: 30_000,
    },
  ])("emits terminal advice at the $name", (scenario) => {
    expect(
      scheduleRetry(
        {
          attempt: scenario.attempt,
          baseDelayMs: 1_000,
          horizonAt: scenario.horizonAt,
          maxAttempts: 3,
          maxDelayMs: 30_000,
          reason: "operation_timeout",
          ...(scenario.serverMinimumDelayMs === undefined
            ? {}
            : { serverMinimumDelayMs: scenario.serverMinimumDelayMs }),
        },
        {
          nowEpochMs: () => Date.parse("2026-07-10T00:00:00.000Z"),
          random: () => 0,
        },
      ),
    ).toMatchObject({
      attempt: scenario.attempt,
      computedDelayMs:
        scenario.serverMinimumDelayMs === undefined
          ? null
          : scenario.serverMinimumDelayMs,
      nextAttemptAt: null,
      state: "exhausted",
    })
  })

  it.each([
    {
      name: "attempt ceiling",
      attempt: 3,
      horizonAt: "2026-07-10T01:00:00.000Z",
    },
    {
      name: "ended horizon",
      attempt: 1,
      horizonAt: "2026-07-09T23:59:59.999Z",
    },
  ])("does not request randomness at the $name", (scenario) => {
    expect(
      scheduleRetry(
        {
          attempt: scenario.attempt,
          baseDelayMs: 1_000,
          horizonAt: scenario.horizonAt,
          maxAttempts: 3,
          maxDelayMs: 30_000,
          reason: "operation_timeout",
        },
        {
          nowEpochMs: () => Date.parse("2026-07-10T00:00:00.000Z"),
          random: () => { throw new Error("random must not be called") },
        },
      ),
    ).toMatchObject({
      computedDelayMs: null,
      nextAttemptAt: null,
      state: "exhausted",
    })
  })

  it("exhausts a safe server minimum beyond the horizon without jitter arithmetic", () => {
    const serverMinimumDelayMs = 9_007_199_254_740_000
    expect(
      scheduleRetry(
        {
          attempt: 1,
          baseDelayMs: 1_000,
          horizonAt: "2026-07-10T01:00:00.000Z",
          maxAttempts: 3,
          maxDelayMs: 30_000,
          reason: "rate_limit",
          serverMinimumDelayMs,
        },
        {
          nowEpochMs: () => Date.parse("2026-07-10T00:00:00.000Z"),
          random: () => { throw new Error("random must not be called") },
        },
      ),
    ).toMatchObject({
      computedDelayMs: serverMinimumDelayMs,
      nextAttemptAt: null,
      serverMinimumDelayMs,
      state: "exhausted",
    })
  })
})
