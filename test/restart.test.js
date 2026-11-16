import assert from 'node:assert/strict'
import test from 'node:test'
import { buildRestartScript, expandTarget } from '../host/restart.js'

const options = {
  oldPid: 4242,
  nodeBin: '/usr/bin/node',
  cliPath: "/opt/dsh bin/dsh's",
  argv: ['web', '--no-open'],
  cwd: '/tmp/work dir',
  host: '127.0.0.1',
  port: 3080,
  oldVersion: '0.2.1-rc.2',
  newVersion: '0.2.2-rc.1',
  packageName: '@deepseek-ai/dsh',
  npmCommand: '/usr/bin/npm',
  rollbackArgs: ['install', '-g', '--no-audit', '--no-fund', '{target}'],
  logPath: '/tmp/log path/update.log',
  statusPath: '/tmp/log path/last-restart.json',
  timeoutSeconds: 45,
}

test('shell-quotes every value and bakes the command line', () => {
  const script = buildRestartScript(options)
  assert.ok(script.startsWith('#!/usr/bin/env bash'))
  assert.ok(script.includes("OLD_PID='4242'"))
  assert.ok(script.includes("HEALTH_ITERATIONS='90'"), 'timeout seconds become poll iterations')
  assert.ok(script.includes("'/opt/dsh bin/dsh'\\''s'"), 'single quotes are escaped')
  assert.ok(script.includes("ARGS=( 'web' '--no-open' )"))
  assert.ok(script.includes("ROLLBACK_ARGS=( 'install' '-g' '--no-audit' '--no-fund' '@deepseek-ai/dsh@0.2.1-rc.2' )"))
  assert.ok(script.includes("PROBE_HOST='127.0.0.1'"))
  assert.ok(script.includes("PROBE_PORT='3080'"))
  assert.ok(script.includes('new dsh web is serving'), 'status writer keeps its outcome words')
})

test('falls back to a plain global install for the rollback', () => {
  const script = buildRestartScript({ ...options, rollbackArgs: undefined })
  assert.ok(script.includes("ROLLBACK_ARGS=( 'install' '-g' '--no-audit' '--no-fund' '@deepseek-ai/dsh@0.2.1-rc.2' )"))
})

test('expands the target placeholder without touching other arguments', () => {
  assert.deepEqual(expandTarget(['install', '-g', '{target}', '--prefix', '{target}-prefix'], 'pkg@1.0.0'), [
    'install',
    '-g',
    'pkg@1.0.0',
    '--prefix',
    'pkg@1.0.0-prefix',
  ])
})
