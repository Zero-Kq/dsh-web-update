import assert from 'node:assert/strict'
import test from 'node:test'
import { compareVersions, isNewerVersion, parseVersion } from '../host/update.js'

test('parses semver with prerelease', () => {
  assert.deepEqual(parseVersion('1.2.3-rc.4'), { major: 1, minor: 2, patch: 3, prerelease: ['rc', '4'] })
  assert.deepEqual(parseVersion('v0.2.2'), { major: 0, minor: 2, patch: 2, prerelease: [] })
  assert.equal(parseVersion('not-a-version'), undefined)
})

test('orders releases like npm dist-tags', () => {
  const cases = [
    ['0.2.1-rc.2', '0.2.2-rc.1', -1],
    ['0.2.2-rc.1', '0.2.1-rc.2', 1],
    ['0.2.2-rc.1', '0.2.2-rc.1', 0],
    ['0.2.2', '0.2.2-rc.1', 1],
    ['0.2.2-rc.1', '0.2.2', -1],
    ['0.2.2-rc.2', '0.2.2-rc.10', -1],
    ['1.0.0', '0.9.9', 1],
  ]
  for (const [left, right, expected] of cases) {
    assert.equal(compareVersions(left, right), expected, `${left} vs ${right}`)
  }
})

test('offers only a genuinely newer version', () => {
  assert.equal(isNewerVersion('0.2.2-rc.1', '0.2.1-rc.2'), true)
  assert.equal(isNewerVersion('0.2.2-rc.1', '0.2.2-rc.1'), false)
  assert.equal(isNewerVersion('0.2.1-rc.2', '0.2.2-rc.1'), false)
  assert.equal(isNewerVersion('0.2.2-rc.1', '0.2.1-rc.2', { allowPrereleaseUpdates: false }), false)
  assert.equal(isNewerVersion('not-a-version', '0.2.1-rc.2'), false)
})
