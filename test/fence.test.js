import assert from 'node:assert/strict'
import test from 'node:test'
import { FENCE_UNAVAILABLE, rejectionFor } from '../index.js'

/** Minimal plugin context whose only service is the injected fake connection. */
function contextWith(connection) {
  return {
    get(name) {
      return name === 'connection' ? connection : undefined
    },
  }
}

test('admits only what the connection fence admits', () => {
  const admitted = contextWith({ requestRejection: () => undefined })
  assert.equal(rejectionFor(admitted, { headers: {} }), undefined)

  for (const code of [401, 403]) {
    const rejected = contextWith({ requestRejection: () => code })
    assert.equal(rejectionFor(rejected, { headers: {} }), code)
  }

  // false/null/undefined mean "no rejection" on the Host fence contract
  for (const allowed of [false, null]) {
    const fence = contextWith({ requestRejection: () => allowed })
    assert.equal(rejectionFor(fence, { headers: {} }), undefined)
  }
})

test('fails closed with 503 when the fence is missing', () => {
  assert.equal(rejectionFor(contextWith(undefined), { headers: { host: '127.0.0.1:3080' } }), FENCE_UNAVAILABLE)
  assert.equal(rejectionFor(contextWith(null), { headers: { host: '127.0.0.1:3080' } }), FENCE_UNAVAILABLE)
  // a connection service without the fence method is not a fence either
  assert.equal(rejectionFor(contextWith({}), { headers: { host: '127.0.0.1:3080' } }), FENCE_UNAVAILABLE)
  assert.equal(rejectionFor(contextWith({ requestRejection: 'nope' }), { headers: {} }), FENCE_UNAVAILABLE)
})

test('fails closed when the context cannot be read', () => {
  const broken = { get() { throw new Error('service unavailable') } }
  assert.equal(rejectionFor(broken, { headers: {} }), FENCE_UNAVAILABLE)
})

test('a throwing fence rejects with 403 instead of admitting', () => {
  const throwing = contextWith({ requestRejection() { throw new Error('fence crashed') } })
  assert.equal(rejectionFor(throwing, { headers: {} }), 403)
})
