import { describe, expect, it } from 'vitest'
import {
  isWorkspaceLocation,
  isWorkspaceHistoryEntry,
  parseWorkspaceLocation,
  resetWorkspaceQuery,
  serializeWorkspaceLocation,
} from './workspace-location'
import {
  nextLegacyForwardCursorPage,
  nextWorkspacePage,
  previousLegacyForwardCursorPage,
  previousWorkspacePage,
} from './workspace-page'

describe('workspace location', () => {
  it('round-trips an opaque cursor byte-for-byte', () => {
    const cursor = 'opaque/+==:%2F?and unicode ✓😀'
    const location = {
      view: 'companies' as const,
      resourceId: 'company/42',
      filter: 'active',
      sort: 'display_name_asc',
      cursor,
      cursorDirection: 'after' as const,
    }

    const serialized = serializeWorkspaceLocation(
      location,
      new URL('https://app.test/workspace?unrelated=kept'),
    )

    expect(parseWorkspaceLocation(serialized)).toEqual(location)
    expect(serialized.searchParams.get('cursor')).toBe(cursor)
    expect(serialized.searchParams.get('unrelated')).toBe('kept')
  })

  it.each(['\uD800', '\uDC00'])(
    'rejects a lone surrogate cursor before URL serialization',
    (cursor) => {
      const location = {
        view: 'jobs' as const,
        cursor,
        cursorDirection: 'after' as const,
      }
      expect(isWorkspaceLocation(location)).toBe(false)
      expect(() => serializeWorkspaceLocation(
        location,
        new URL('https://app.test/workspace'),
      )).toThrow('Cannot serialize an invalid workspace location.')
    },
  )

  it.each([
    'https://app.test/?view=unknown',
    'https://app.test/?view=jobs&filter=archived',
    'https://app.test/?view=companies&direction=after',
    'https://app.test/?view=companies&cursor=x&direction=sideways',
    'https://app.test/?view=captures&mode=processing',
    'https://app.test/?view=companies&mode=duplicates&filter=archived',
    'https://app.test/?view=companies&mode=duplicates&sort=display_name_asc',
    'https://app.test/?view=companies&filter=open',
    'https://app.test/?view=jobs&cursor=x&direction=before',
    'https://app.test/?view=opportunities&cursor=x&direction=after',
    'https://app.test/?view=applications&resource=application-one',
    'https://app.test/?view=captures&filter=all',
  ])('falls back safely for invalid or incompatible input: %s', (address) => {
    expect(parseWorkspaceLocation(new URL(address))).toEqual({ view: 'captures' })
  })

  it('round-trips the separate possible-duplicate queue mode', () => {
    const location = {
      view: 'companies' as const,
      mode: 'duplicates',
      resourceId: 'candidate-1',
      filter: 'open',
      sort: 'score_desc',
      cursor: 'opaque-candidate-cursor',
      cursorDirection: 'after' as const,
    }
    expect(parseWorkspaceLocation(serializeWorkspaceLocation(
      location,
      new URL('https://app.test/workspace'),
    ))).toEqual(location)
  })

  it('resets the cursor chain and selection when filtering or sorting', () => {
    expect(resetWorkspaceQuery({
      view: 'companies',
      resourceId: 'company-1',
      filter: 'all',
      sort: 'display_name_asc',
      cursor: 'cursor-2',
      cursorDirection: 'after',
    }, {
      filter: 'archived',
      sort: 'display_name_asc',
    })).toEqual({
      view: 'companies',
      filter: 'archived',
      sort: 'display_name_asc',
    })
  })

  it('validates history state including its cursor chain', () => {
    expect(isWorkspaceHistoryEntry({
      location: { view: 'jobs', resourceId: 'job-1' },
      cursorChain: [{ view: 'jobs', filter: 'all' }],
      focusAnchor: 'job-link-job-1',
    })).toBe(true)
    expect(isWorkspaceHistoryEntry({
      location: { view: 'jobs' },
      cursorChain: [{ view: 'jobs', filter: 'archived' }],
    })).toBe(false)
    expect(isWorkspaceHistoryEntry({
      location: { view: 'jobs' },
      cursorChain: [{ view: 'companies' }],
    })).toBe(false)
  })
})

describe('workspace page transitions', () => {
  const entry = {
    location: {
      view: 'companies' as const,
      resourceId: 'selected',
      filter: 'active',
      cursor: 'current',
      cursorDirection: 'after' as const,
    },
    cursorChain: [{ view: 'companies' as const, filter: 'active' }],
  }

  it('uses PageInfo raw cursors exactly for Next and Previous', () => {
    const pageInfo = {
      startCursor: 'start/+==:%2F',
      endCursor: 'end/+==:%2F',
      hasPreviousPage: true,
      hasNextPage: true,
    }
    expect(nextWorkspacePage(entry, pageInfo)?.location).toEqual({
      view: 'companies',
      filter: 'active',
      cursor: pageInfo.endCursor,
      cursorDirection: 'after',
    })
    expect(previousWorkspacePage(entry, pageInfo)?.location).toEqual({
      view: 'companies',
      filter: 'active',
      cursor: pageInfo.startCursor,
      cursorDirection: 'before',
    })
  })

  it('does not transition when PageInfo disables the direction', () => {
    const pageInfo = {
      startCursor: 'start',
      endCursor: 'end',
      hasPreviousPage: false,
      hasNextPage: false,
    }
    expect(nextWorkspacePage(entry, pageInfo)).toBeNull()
    expect(previousWorkspacePage(entry, pageInfo)).toBeNull()
  })

  it('keeps legacy forward cursors backend-owned and Previous history-owned', () => {
    const jobsEntry = {
      location: {
        view: 'jobs' as const,
        filter: 'include_removed',
        resourceId: 'selected-job',
        cursor: 'current-page',
        cursorDirection: 'after' as const,
      },
      cursorChain: [{ view: 'jobs' as const, filter: 'include_removed' }],
    }
    const cursor = 'server/+==:\u0000\n +'
    const next = nextLegacyForwardCursorPage(jobsEntry, cursor)
    expect(next).toEqual({
      location: {
        view: 'jobs',
        filter: 'include_removed',
        cursor,
        cursorDirection: 'after',
      },
      cursorChain: [
        { view: 'jobs', filter: 'include_removed' },
        {
          view: 'jobs',
          filter: 'include_removed',
          cursor: 'current-page',
          cursorDirection: 'after',
        },
      ],
    })
    expect(previousLegacyForwardCursorPage({
      location: next!.location,
      cursorChain: next!.cursorChain,
    })).toEqual({
      location: {
        view: 'jobs',
        filter: 'include_removed',
        cursor: 'current-page',
        cursorDirection: 'after',
      },
      cursorChain: [{ view: 'jobs', filter: 'include_removed' }],
    })
  })
})
