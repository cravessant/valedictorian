import { describe, expect, it } from 'vitest'
import {
  isWorkspaceLocation,
  isWorkspaceHistoryEntry,
  parseWorkspaceLocation,
  resetWorkspaceQuery,
  serializeWorkspaceLocation,
} from './workspace-location'
import {
  nextWorkspacePage,
  previousWorkspacePage,
  workspacePageRequest,
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
    'https://app.test/?view=opportunities&cursor=x&direction=after',
    'https://app.test/?view=applications&cursor=x&direction=before',
    'https://app.test/?view=applications&resource=application-one',
  ])('falls back safely for invalid or incompatible input: %s', (address) => {
    expect(parseWorkspaceLocation(new URL(address))).toEqual({ view: 'captures' })
  })

  it('round-trips canonical Capture filters and bidirectional cursors', () => {
    const location = {
      view: 'captures' as const,
      filter: 'needs_attention',
      sort: 'observed_desc',
      cursor: 'opaque-capture-cursor',
      cursorDirection: 'before' as const,
    }
    expect(parseWorkspaceLocation(serializeWorkspaceLocation(
      location,
      new URL('https://app.test/workspace'),
    ))).toEqual(location)
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

  it('round-trips a bidirectional Jobs page location', () => {
    const location = {
      view: 'jobs' as const,
      filter: 'include_removed',
      cursor: 'opaque-job-cursor',
      cursorDirection: 'before' as const,
    }
    expect(parseWorkspaceLocation(serializeWorkspaceLocation(
      location,
      new URL('https://app.test/workspace'),
    ))).toEqual(location)
  })

  it('validates history state without any client-held cursor stack', () => {
    expect(isWorkspaceHistoryEntry({
      location: { view: 'jobs', resourceId: 'job-1' },
      focusAnchor: 'job-link-job-1',
    })).toBe(true)
    expect(isWorkspaceHistoryEntry({ location: { view: 'jobs', filter: 'archived' } })).toBe(false)
    expect(isWorkspaceHistoryEntry({ location: 'jobs' })).toBe(false)
  })
})

describe('workspace page transitions', () => {
  const location = {
    view: 'companies' as const,
    resourceId: 'selected',
    filter: 'active',
    cursor: 'current',
    cursorDirection: 'after' as const,
  }

  it('uses PageInfo raw cursors exactly for Next and Previous', () => {
    const pageInfo = {
      startCursor: 'start/+==:%2F',
      endCursor: 'end/+==:%2F',
      hasPreviousPage: true,
      hasNextPage: true,
    }
    expect(nextWorkspacePage(location, pageInfo)).toEqual({
      view: 'companies',
      filter: 'active',
      cursor: pageInfo.endCursor,
      cursorDirection: 'after',
    })
    expect(previousWorkspacePage(location, pageInfo)).toEqual({
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
    expect(nextWorkspacePage(location, pageInfo)).toBeNull()
    expect(previousWorkspacePage(location, pageInfo)).toBeNull()
  })

  it('re-addresses its own cursor when an emptied page offers the opposite direction', () => {
    const emptiedAfter = {
      startCursor: null,
      endCursor: null,
      hasPreviousPage: true,
      hasNextPage: false,
    }
    expect(previousWorkspacePage(location, emptiedAfter)).toEqual({
      view: 'companies',
      filter: 'active',
      cursor: 'current',
      cursorDirection: 'before',
    })
    expect(nextWorkspacePage(location, emptiedAfter)).toBeNull()

    const backward = { ...location, cursorDirection: 'before' as const }
    const emptiedBefore = {
      startCursor: null,
      endCursor: null,
      hasPreviousPage: false,
      hasNextPage: true,
    }
    expect(nextWorkspacePage(backward, emptiedBefore)).toEqual({
      view: 'companies',
      filter: 'active',
      cursor: 'current',
      cursorDirection: 'after',
    })
    expect(previousWorkspacePage(backward, emptiedBefore)).toBeNull()
  })

  it('does not fabricate a transition when neither the page nor the location holds a cursor', () => {
    const unanchored = { view: 'companies' as const, filter: 'active' }
    const pageInfo = {
      startCursor: null,
      endCursor: null,
      hasPreviousPage: true,
      hasNextPage: true,
    }
    expect(nextWorkspacePage(unanchored, pageInfo)).toBeNull()
    expect(previousWorkspacePage(unanchored, pageInfo)).toBeNull()
  })

  it('asks each direction of the contract for exactly the addressed page', () => {
    expect(workspacePageRequest(undefined, undefined)).toEqual({})
    expect(workspacePageRequest('c', undefined)).toEqual({ after: 'c' })
    expect(workspacePageRequest('c', 'after')).toEqual({ after: 'c' })
    expect(workspacePageRequest('c', 'before')).toEqual({ before: 'c' })
  })
})
