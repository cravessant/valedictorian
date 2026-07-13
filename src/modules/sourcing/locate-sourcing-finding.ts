import type { SourcingFindingsListInput, SourcingFindingsListResult } from 'sparxie'

type SourcingLoader = (
  input: SourcingFindingsListInput,
) => Promise<SourcingFindingsListResult>

export async function locateSourcingFinding(
  loader: SourcingLoader,
  findingId: string,
  limit: number,
): Promise<SourcingFindingsListResult | null> {
  let offset = 0
  while (true) {
    const result = await loader({ limit, offset })
    if (result.items.some((finding) => finding.id === findingId)) return result
    if (!result.hasMore) return null
    const nextOffset = result.offset + result.limit
    if (nextOffset <= offset) return null
    offset = nextOffset
  }
}
