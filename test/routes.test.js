import assert from 'node:assert/strict'
import test from 'node:test'
import { apply } from '../index.js'

/**
 * Drive the real route handlers with a plugin context that has NO connection
 * service, i.e. the composition the fail-closed rule exists for.
 */
function mountWithoutConnection() {
  const routes = new Map()
  const ctx = {
    get(name) {
      return name === 'connection' ? undefined : undefined
    },
    effect(fn) {
      const dispose = fn()
      return dispose
    },
    timeout() {
      return () => {}
    },
    interval() {
      return () => {}
    },
    webServer: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
      getOrigin() {
        return 'http://127.0.0.1:3099'
      },
    },
  }
  apply(ctx, { autoCheckOnStart: false, checkIntervalHours: 24 })
  return routes
}

function invoke(route, { method = 'GET', headers = {} } = {}) {
  const res = {
    statusCode: undefined,
    body: undefined,
    writableEnded: false,
    writeHead(status) {
      this.statusCode = status
    },
    end(body) {
      this.body = body
      this.writableEnded = true
    },
  }
  route.handler({ method, headers }, res)
  return res
}

test('routes answer 503 when the connection fence is missing', () => {
  const routes = mountWithoutConnection()

  const state = invoke(routes.get('/dsh-web-update/state'))
  assert.equal(state.statusCode, 503)
  assert.match(state.body, /trust fence is unavailable/)

  const update = invoke(routes.get('/dsh-web-update/update'), { method: 'POST' })
  assert.equal(update.statusCode, 503)
  assert.match(update.body, /trust fence is unavailable/)

  const check = invoke(routes.get('/dsh-web-update/check'), { method: 'POST' })
  assert.equal(check.statusCode, 503)
})

test('fail-closed refusal happens before method or body handling', () => {
  const routes = mountWithoutConnection()
  // Wrong method would normally be 405; without the fence it must still be 503.
  const wrongMethod = invoke(routes.get('/dsh-web-update/check'), { method: 'GET' })
  assert.equal(wrongMethod.statusCode, 503)
})

test('reports the missing fence once, on the first refused request', () => {
  const warnings = []
  const original = console.warn
  console.warn = (...args) => warnings.push(args.join(' '))
  try {
    const routes = mountWithoutConnection()
    const fenceWarnings = () => warnings.filter((line) => line.includes('trust fence is unavailable')).length
    assert.equal(fenceWarnings(), 0, 'activation must not warn')
    invoke(routes.get('/dsh-web-update/state'))
    invoke(routes.get('/dsh-web-update/state'))
    invoke(routes.get('/dsh-web-update/update'), { method: 'POST' })
    assert.equal(fenceWarnings(), 1, 'exactly one warning for all refusals')
  } finally {
    console.warn = original
  }
})
