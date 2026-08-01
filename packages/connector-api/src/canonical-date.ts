import { z } from "zod"

export type CanonicalDateOnly = z.infer<typeof canonicalDateOnlySchema>

export const canonicalDateOnlySchema = z.iso.date().refine(
  (value) => {
    const [year, month, day] = value.split("-").map(Number)
    const date = new Date(Date.UTC(year!, month! - 1, day!))
    return date.getUTCFullYear() === year &&
      date.getUTCMonth() === month! - 1 &&
      date.getUTCDate() === day
  },
  "date must be a real calendar date",
)
