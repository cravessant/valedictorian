import { writeIsolatedValidationTerminalState } from '../src/runtime/isolated-validation'
import { SUPERVISED_LEADER_EXIT_MESSAGE } from './supervised-launch'

/** Simulates a window closing cleanly before the readiness manifest exists. */
writeIsolatedValidationTerminalState('completed')
process.send?.({
  code: 0,
  signal: null,
  type: SUPERVISED_LEADER_EXIT_MESSAGE,
}, () => process.disconnect?.())
