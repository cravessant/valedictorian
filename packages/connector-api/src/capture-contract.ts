import { z } from "zod"
import {
  snapshotBoundedPlainData,
  type PlainDataBounds,
} from "./plain-data.js"
import { sourceExecutionScopeIdSchema } from "./source-execution.js"

export const evidenceModes = ["reported", "ats_details_provided"] as const
export type EvidenceMode = (typeof evidenceModes)[number]

const lifecycleIdSchema = z.string().trim().min(1).max(200)
const lifecycleInstantSchema = z.iso.datetime({ offset: true })
const forbiddenEvidenceKey = /^(?:authorization|cookie|password|secret|token|ssn)$/i
const captureJsonBounds = {
  maxDepth: 64,
  maxNodes: 100_000,
  maxArrayLength: 10_000,
} as const
const evidenceJsonBounds = {
  maxDepth: 64,
  maxNodes: 10_000,
  maxArrayLength: 1_000,
} as const

function boundedPlainDataSchema(
  bounds: PlainDataBounds,
  message: string,
) {
  return z.unknown().transform((value, context) => {
    const snapshot = snapshotBoundedPlainData(value, bounds)
    if (!snapshot.success) {
      context.addIssue({ code: "custom", message })
      return z.NEVER
    }
    return snapshot.value
  })
}

const jsonValueSchema = z.json().transform((value): unknown => value)

function findForbiddenEvidencePath(
  value: unknown,
  path: Array<string | number> = [],
): Array<string | number> | null {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenEvidencePath(item, [...path, index])
      if (found) return found
    }
    return null
  }
  if (value === null || typeof value !== "object") return null
  for (const [key, item] of Object.entries(value)) {
    if (forbiddenEvidenceKey.test(key)) return [...path, key]
    const found = findForbiddenEvidencePath(item, [...path, key])
    if (found) return found
  }
  return null
}

const boundedJsonObjectSchema = boundedPlainDataSchema(
  captureJsonBounds,
  "payload must be bounded plain JSON data",
)
  .pipe(z.record(z.string().min(1).max(200), jsonValueSchema))
  .superRefine((value, context) => {
    if (JSON.stringify(value).length > 262_144) {
      context.addIssue({
        code: "custom",
        message: "payload exceeds the capture evidence bound",
      })
    }
    const forbiddenPath = findForbiddenEvidencePath(value)
    if (forbiddenPath) {
      context.addIssue({
        code: "custom",
        message: "payload contains a forbidden sensitive key",
        path: forbiddenPath,
      })
    }
  })

export const captureEvidenceSchema = z
  .object({
    kind: z.string().trim().min(1).max(100),
    label: z.string().trim().min(1).max(200),
    value: boundedPlainDataSchema(
      evidenceJsonBounds,
      "evidence value must be bounded plain JSON data",
    ).pipe(jsonValueSchema),
  })
  .strict()
  .superRefine((evidence, context) => {
    if (JSON.stringify(evidence.value).length > 16_384) {
      context.addIssue({
        code: "custom",
        message: "evidence value exceeds its bound",
        path: ["value"],
      })
    }
    const forbiddenPath = findForbiddenEvidencePath(evidence.value)
    if (forbiddenPath) {
      context.addIssue({
        code: "custom",
        message: "evidence contains a forbidden sensitive key",
        path: ["value", ...forbiddenPath],
      })
    }
  })

export const captureAdapterSchema = z.object({
  id: lifecycleIdSchema,
  kind: z.enum(["connector", "cli", "manual", "import"]),
  version: z.string().trim().min(1).max(100),
}).strict()

export const createCaptureInputSchema = z.object({
  evidenceMode: z.enum(evidenceModes),
  adapter: captureAdapterSchema,
  observedAt: lifecycleInstantSchema,
  providerRecordId: z.string().trim().min(1).max(500).nullable(),
  providerSchema: z.string().trim().min(1).max(500).nullable(),
  payload: boundedJsonObjectSchema.nullable(),
  evidence: z.array(captureEvidenceSchema).max(50),
}).strict()

export type CreateCaptureInput = z.infer<typeof createCaptureInputSchema>
export type ConnectorSourceAdapter = CreateCaptureInput["adapter"]
export type ConnectorSourceExecutionScopeId = z.infer<
  typeof sourceExecutionScopeIdSchema
>
