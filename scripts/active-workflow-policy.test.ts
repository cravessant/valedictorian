import { describe, expect, it } from 'vitest'
import {
  activeWorkflowPaths,
  approvedSelectedActionPatterns,
  findActiveWorkflowPolicyViolations,
  readActiveWorkflowState,
} from './active-workflow-policy.mjs'

describe('active disclosure workflow policy', () => {
  it('pins every active workflow action to the reviewed SHA contract', () => {
    expect(findActiveWorkflowPolicyViolations(readActiveWorkflowState())).toEqual([])
  })

  it('exposes exactly the selected-action families required by active workflows', () => {
    expect(approvedSelectedActionPatterns).toEqual([
      'actions/cache@*',
      'actions/checkout@*',
      'actions/setup-node@*',
      'actions/upload-artifact@*',
      'pnpm/action-setup@*',
    ])
  })

  it('fails closed for mutable, indirect, unreviewed, and undiscovered actions', () => {
    const state = readActiveWorkflowState()
    const workflowPath = activeWorkflowPaths[0]
    const source = state.workflows.get(workflowPath)!
    const checkoutPin = 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6'
    const attacks = [
      source.replace(checkoutPin, 'actions/checkout@v6 # v6'),
      source.replace(checkoutPin, 'actions/checkout@1111111111111111111111111111111111111111 # v6'),
      source.replace(checkoutPin, 'actions/checkout@${{ inputs.checkout_ref }} # v6'),
      source.replace(checkoutPin, 'evil/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6'),
      source.replace(checkoutPin, 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803'),
    ]

    for (const attackedSource of attacks) {
      expect(findActiveWorkflowPolicyViolations({
        discoveredPaths: state.discoveredPaths,
        workflows: new Map(state.workflows).set(workflowPath, attackedSource),
      })).not.toEqual([])
    }

    expect(findActiveWorkflowPolicyViolations({
      discoveredPaths: [...state.discoveredPaths, '.github/workflows/new.yml'],
      workflows: state.workflows,
    })).not.toEqual([])
  })

  it('fails closed when an approved selected family is no longer observed', () => {
    const state = readActiveWorkflowState()
    const workflowPath = activeWorkflowPaths[0]
    const source = state.workflows.get(workflowPath)!
    const cachePin = '        uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4'
    expect(source).toContain(cachePin)

    expect(findActiveWorkflowPolicyViolations({
      discoveredPaths: state.discoveredPaths,
      workflows: new Map(state.workflows).set(workflowPath, source.replace(cachePin, '')),
    })).not.toEqual([])
  })

  it('fails closed for alternate YAML uses spellings, flow mappings, and malformed values', () => {
    const state = readActiveWorkflowState()
    const workflowPath = activeWorkflowPaths[0]
    const source = state.workflows.get(workflowPath)!
    const checkoutValue = 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803'
    const checkoutLine = `        uses: ${checkoutValue} # v6`
    const flowAnchor = '      - name: Set up pnpm'
    const attacks = [
      source.replace(checkoutLine, `        uses : ${checkoutValue} # v6`),
      source.replace(checkoutLine, `        "uses": ${checkoutValue} # v6`),
      source.replace(flowAnchor, `      - {uses: ${checkoutValue}}\n\n${flowAnchor}`),
      source.replace(checkoutLine, '        uses: {ref: actions/checkout}'),
      source.replace('jobs:', 'jobs: ['),
    ]

    for (const attackedSource of attacks) {
      expect(findActiveWorkflowPolicyViolations({
        discoveredPaths: state.discoveredPaths,
        workflows: new Map(state.workflows).set(workflowPath, attackedSource),
      })).not.toEqual([])
    }
  })

  it('does not let a shell block spoof a rewritten action key', () => {
    const state = readActiveWorkflowState()
    const workflowPath = activeWorkflowPaths[0]
    const source = state.workflows.get(workflowPath)!
    const checkoutValue = 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803'
    const checkoutLine = `        uses: ${checkoutValue} # v6`
    const blockStep = [
      '      - name: Unexecuted shell text',
      '        if: false',
      '        run: |',
      `          uses: ${checkoutValue} # v6`,
      '',
    ].join('\n')
    const attackedSource = source
      .replace(checkoutLine, `        uses : ${checkoutValue} # wrong-version`)
      .replace('      - name: Set up pnpm', `${blockStep}      - name: Set up pnpm`)

    expect(findActiveWorkflowPolicyViolations({
      discoveredPaths: state.discoveredPaths,
      workflows: new Map(state.workflows).set(workflowPath, attackedSource),
    })).not.toEqual([])
  })
})
