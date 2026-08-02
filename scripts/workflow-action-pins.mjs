export const reviewedActionPins = new Map([
  ['actions/cache', '0057852bfaa89a56745cba8c7296529d2fc39830'],
  ['actions/checkout', 'd23441a48e516b6c34aea4fa41551a30e30af803'],
  ['actions/setup-node', '249970729cb0ef3589644e2896645e5dc5ba9c38'],
  ['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
  ['pnpm/action-setup', '0ebf47130e4866e96fce0953f49152a61190b271'],
])

export const reviewedActionVersions = new Map([
  ['actions/cache', 'v4'],
  ['actions/checkout', 'v6'],
  ['actions/setup-node', 'v6'],
  ['actions/upload-artifact', 'v7'],
  ['pnpm/action-setup', 'v6'],
])

export const approvedSelectedActionPatterns = Object.freeze(
  [...reviewedActionPins.keys()].map((action) => `${action}@*`).sort(),
)
