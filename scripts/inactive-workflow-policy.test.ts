import { describe, expect, it } from 'vitest'
import {
  findInactiveWorkflowPolicyViolations,
  inactiveWorkflowPaths,
  readInactiveWorkflowState,
} from './inactive-workflow-policy.mjs'

describe('inactive imported workflow policy', () => {
  it('pins every imported CLI action to its reviewed full commit SHA', () => {
    expect(findInactiveWorkflowPolicyViolations(readInactiveWorkflowState())).toEqual([])
  })

  it('rejects tag pins, unreviewed SHAs, missing comments, and new workflows', () => {
    const state = readInactiveWorkflowState()
    const ciPath = inactiveWorkflowPaths[0]
    const ci = state.workflows.get(ciPath)!
    const attacks = [
      ci.replace(
        'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6',
        'actions/checkout@v6',
      ),
      ci.replace(
        'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6',
        'actions/setup-node@1111111111111111111111111111111111111111 # v6',
      ),
      ci.replace(
        'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271 # v6',
        'pnpm/action-setup@0ebf47130e4866e96fce0953f49152a61190b271',
      ),
    ]

    for (const source of attacks) {
      expect(findInactiveWorkflowPolicyViolations({
        discoveredPaths: state.discoveredPaths,
        workflows: new Map(state.workflows).set(ciPath, source),
      })).not.toEqual([])
    }
    expect(findInactiveWorkflowPolicyViolations({
      discoveredPaths: [...state.discoveredPaths, 'packages/new/.github/workflows/ci.yml'],
      workflows: state.workflows,
    })).not.toEqual([])
  })
})
