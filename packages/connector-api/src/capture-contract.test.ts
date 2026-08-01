import { describe, expect, expectTypeOf, it } from "vitest"
import {
  createCaptureInputSchema,
  type CreateCaptureInput,
} from "./capture-contract.js"

function deeplyNestedJson(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true }
  for (let index = 0; index < depth; index += 1) {
    value = { nested: value }
  }
  return value
}

const input = {
  evidenceMode: "reported",
  adapter: {
    id: "fixture.jobs",
    kind: "connector",
    version: "1.0.0",
  },
  observedAt: "2026-08-01T12:00:00.000Z",
  providerRecordId: "provider-1",
  providerSchema: "fixture@1",
  payload: {},
  evidence: [],
} as const

describe("capture input contract", () => {
  it("preserves the public JSON payload type", () => {
    expectTypeOf<CreateCaptureInput["payload"]>()
      .toEqualTypeOf<Record<string, unknown> | null>()
    expectTypeOf<CreateCaptureInput["evidence"][number]["value"]>()
      .toEqualTypeOf<unknown>()
  })

  it.each([
    ["payload", {
      ...input,
      payload: deeplyNestedJson(5_000),
    }],
    ["evidence", {
      ...input,
      evidence: [{
        kind: "provider",
        label: "Provider response",
        value: deeplyNestedJson(5_000),
      }],
    }],
  ])("rejects deeply nested %s without throwing", (_name, candidate) => {
    expect(() => createCaptureInputSchema.safeParse(candidate)).not.toThrow()
    expect(createCaptureInputSchema.safeParse(candidate).success).toBe(false)
  })
})
