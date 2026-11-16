/**
 * dsh-web-update — Host half.
 *
 * Owns three things for the browser half:
 *   1. the version picture: which @deepseek-ai/dsh this Host runs and which
 *      version the npm registry currently publishes;
 *   2. the one-click update: `npm install -g <package>@<version>` in the same
 *      npm prefix that installed this Host;
 *   3. the auto-restart: hand the exit-and-respawn to a detached helper script
 *      so an update never leaves dsh web stopped.
 *
 * Auto-checks run once shortly after activation and then every
 * `checkIntervalHours` (24h by default) for as long as the Host keeps running.
 *
 * The browser half talks to this half over exact HTTP routes under
 * `/dsh-web-update/`; every route passes the Host connection's browser-trust
 * fence (origin/host admission plus the signed browser cookie), so an
 * unauthenticated or cross-origin request can never install a package.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  DEFAULT_DIST_TAG,
  DEFAULT_PACKAGE,
  detectInstallation,
  fetchLatestVersion,
  isNewerVersion,
  runInstall,
  versionAt,
} from './host/update.js'
import {
  buildRestartScript,
  defaultStateDir,
  expandTarget,
  spawnRestartHelper,
} from './host/restart.js'

/** Cordis plugin name. */
export const name = 'dsh-web-update'
/** The update UI needs the browser HTTP carrier and the disposable timers. */
export const inject = ['webServer', 'timer']

const ROUTE_PREFIX = '/dsh-web-update'
const LOG_LIMIT = 16384

const SETTINGS_DEFAULTS = {
  checkIntervalHours: 24,
  autoCheckOnStart: true,
  registryUrl: 'https://registry.npmjs.org',
  packageName: DEFAULT_PACKAGE,
  distTag: DEFAULT_DIST_TAG,
  npmCommand: '',
  installArgs: null,
  restartTimeoutSeconds: 90,
  allowPrereleaseUpdates: true,
}

function positiveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Merge the loader row's config over the shipped defaults. */
function readSettings(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const npmCommand = typeof source.npmCommand === 'string' && source.npmCommand.trim() !== '' ? source.npmCommand.trim() : ''
  const installArgs = Array.isArray(source.installArgs) && source.installArgs.every((entry) => typeof entry === 'string')
    ? source.installArgs
    : ['install', '-g', '--no-audit', '--no-fund', '{target}']
  return {
    checkIntervalHours: positiveNumber(source.checkIntervalHours, SETTINGS_DEFAULTS.checkIntervalHours),
    autoCheckOnStart: source.autoCheckOnStart !== false,
    registryUrl: typeof source.registryUrl === 'string' && source.registryUrl.trim() !== '' ? source.registryUrl.trim() : SETTINGS_DEFAULTS.registryUrl,
    packageName: typeof source.packageName === 'string' && source.packageName.trim() !== '' ? source.packageName.trim() : SETTINGS_DEFAULTS.packageName,
    distTag: typeof source.distTag === 'string' && source.distTag.trim() !== '' ? source.distTag.trim() : SETTINGS_DEFAULTS.distTag,
    npmCommand,
    installArgs,
    restartTimeoutSeconds: positiveNumber(source.restartTimeoutSeconds, SETTINGS_DEFAULTS.restartTimeoutSeconds),
    allowPrereleaseUpdates: source.allowPrereleaseUpdates !== false,
  }
}

/** Read the outcome the restart helper wrote for the previous run. */
function readLastRestart(statusPath) {
  try {
    const parsed = JSON.parse(readFileSync(statusPath, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined
  } catch {
    return undefined
  }
}

function safeMessage(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

function sendJson(res, status, value) {
  if (res.writableEnded) return
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function sendText(res, status, value) {
  if (res.writableEnded) return
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
  res.end(value)
}

/**
 * Decide whether this HTTP request may touch the update surface.
 *
 * The Host connection fence already knows the trusted authorities and the
 * signed browser cookie, so it is the authority when present. Without it (an
 * older composition), the plugin keeps its own loopback + same-origin check.
 */
function rejectionFor(ctx, req) {
  const connection = ctx.get('connection')
  if (connection !== undefined && typeof connection.requestRejection === 'function') {
    try {
      const code = connection.requestRejection(req)
      return code === undefined || code === null || code === false ? undefined : code
    } catch {
      return 403
    }
  }
  const headers = req?.headers ?? {}
  let hostUrl
  try {
    hostUrl = new URL(`http://${String(headers.host ?? '')}`)
  } catch {
    return 403
  }
  const hostname = hostUrl.hostname.replace(/^\[/u, '').replace(/\]$/u, '')
  const loopback = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/u.test(hostname)
  if (!loopback) return 403
  if (String(headers['sec-fetch-site'] ?? '').toLowerCase() === 'cross-site') return 403
  const origin = headers.origin
  if (typeof origin === 'string' && origin !== '' && origin !== 'null') {
    try {
      if (new URL(origin).host.toLowerCase() !== String(headers.host ?? '').toLowerCase()) return 403
    } catch {
      return 403
    }
  }
  return undefined
}

/**
 * Mount the update surface.
 * @param {import('@deepseek-ai/cordis').Context} ctx Host plugin context
 * @param {unknown} rawConfig loader row config
 */
export function apply(ctx, rawConfig) {
  const settings = readSettings(rawConfig)
  const installation = detectInstallation({ packageName: settings.packageName })
  const stateDir = defaultStateDir()
  const logPath = path.join(stateDir, 'update.log')
  const statusPath = path.join(stateDir, 'last-restart.json')

  try {
    mkdirSync(stateDir, { recursive: true })
  } catch (error) {
    console.warn(`[dsh-web-update] cannot create the state directory ${stateDir}: ${safeMessage(error)}`)
  }

  const state = {
    /** idle | installing | restarting | error */
    phase: 'idle',
    currentVersion: installation.version,
    latestVersion: undefined,
    updateAvailable: false,
    checking: false,
    error: undefined,
    lastCheckedAt: undefined,
    installOutput: '',
    lastRestart: readLastRestart(statusPath),
  }
  let installChild
  let disposed = false
  let inFlight = undefined

  const npmCommand = settings.npmCommand !== '' ? settings.npmCommand : installation.npmCommand

  const appendLog = (text) => {
    if (typeof text !== 'string' || text === '') return
    try {
      appendFileSync(logPath, text.endsWith('\n') ? text : `${text}\n`, 'utf8')
    } catch {
      /* a log line must never break the update */
    }
    state.installOutput = `${state.installOutput}${text}`
    if (state.installOutput.length > LOG_LIMIT) state.installOutput = state.installOutput.slice(-LOG_LIMIT)
  }

  const snapshot = () => ({
    ok: true,
    phase: state.phase,
    checking: state.checking,
    currentVersion: state.currentVersion ?? null,
    latestVersion: state.latestVersion ?? null,
    updateAvailable: state.updateAvailable,
    error: state.error ?? null,
    lastCheckedAt: state.lastCheckedAt ?? null,
    installOutput: state.installOutput.slice(-4000),
    lastRestart: state.lastRestart ?? null,
    settings: {
      packageName: settings.packageName,
      distTag: settings.distTag,
      checkIntervalHours: settings.checkIntervalHours,
      autoCheckOnStart: settings.autoCheckOnStart,
      registryUrl: settings.registryUrl,
      restartTimeoutSeconds: settings.restartTimeoutSeconds,
      allowPrereleaseUpdates: settings.allowPrereleaseUpdates,
    },
    debug: {
      stateDir,
      logPath,
      statusPath,
      execPath: installation.execPath,
      argv: installation.argv,
      cwd: installation.cwd ?? null,
      packageDir: installation.packageDir ?? null,
      prefix: installation.prefix ?? null,
      globalInstall: installation.globalInstall === true,
      npmCommand,
      installArgs: settings.installArgs,
      detectionError: installation.error ?? null,
      origin: safeOrigin(ctx),
    },
  })

  function safeOrigin(client) {
    try {
      return client.webServer.getOrigin()
    } catch {
      return null
    }
  }

  /** Ask the registry whether a newer release exists. */
  function checkNow({ force = false } = {}) {
    if (disposed) return Promise.resolve(snapshot())
    if (inFlight !== undefined && !force) return inFlight
    if (state.phase === 'installing' || state.phase === 'restarting') return Promise.resolve(snapshot())
    if (state.currentVersion === undefined) {
      state.error = installation.error ?? '无法确定当前 dsh 版本，已跳过更新检查。'
      return Promise.resolve(snapshot())
    }
    state.checking = true
    inFlight = (async () => {
      try {
        const latest = await fetchLatestVersion({
          registryUrl: settings.registryUrl,
          packageName: settings.packageName,
          distTag: settings.distTag,
        })
        state.latestVersion = latest.version
        state.updateAvailable = isNewerVersion(latest.version, state.currentVersion ?? '', {
          allowPrereleaseUpdates: settings.allowPrereleaseUpdates,
        })
        state.lastCheckedAt = new Date().toISOString()
        state.error = undefined
      } catch (error) {
        const message = safeMessage(error)
        state.error = `检查更新失败：${message}`
        console.warn(`[dsh-web-update] update check failed: ${message}`)
      } finally {
        state.checking = false
        inFlight = undefined
      }
      return snapshot()
    })()
    return inFlight
  }

  function probeTarget() {
    const origin = safeOrigin(ctx)
    if (typeof origin === 'string') {
      try {
        const url = new URL(origin)
        const port = Number(url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : url.port)
        return { host: url.hostname, port }
      } catch {
        /* fall through */
      }
    }
    return { host: '127.0.0.1', port: 3080 }
  }

  function scheduleRestart(targetVersion) {
    const probe = probeTarget()
    const argv = Array.isArray(installation.argv) ? installation.argv.slice() : ['web']
    const cliPath = argv.shift()
    // The browser tab reconnects on its own; do not pop a second window.
    if (cliPath !== undefined && !argv.includes('--no-open')) argv.push('--no-open')
    const script = buildRestartScript({
      oldPid: process.pid,
      nodeBin: installation.execPath,
      cliPath,
      argv,
      cwd: installation.cwd ?? process.cwd(),
      host: probe.host,
      port: probe.port,
      oldVersion: state.currentVersion ?? '',
      newVersion: targetVersion,
      packageName: settings.packageName,
      npmCommand,
      rollbackArgs: settings.installArgs,
      logPath,
      statusPath,
      timeoutSeconds: settings.restartTimeoutSeconds,
    })
    try {
      const spawned = spawnRestartHelper({ stateDir, script })
      appendLog(`[dsh-web-update] restart helper: ${spawned.scriptPath} (pid ${String(spawned.child.pid)})`)
      return true
    } catch (error) {
      const message = safeMessage(error)
      state.phase = 'error'
      state.error = `无法启动自动重启：${message}`
      console.error(`[dsh-web-update] cannot start the restart helper: ${message}`)
      return false
    }
  }

  /** Install the offered version, then hand over to the restart helper. */
  async function startUpdate() {
    if (state.phase === 'installing' || state.phase === 'restarting') {
      return { ok: false, error: '更新正在进行中。' }
    }
    if (state.latestVersion === undefined || !state.updateAvailable) await checkNow({ force: true })
    if (state.latestVersion === undefined || !state.updateAvailable) {
      return { ok: false, error: state.error ?? '当前已是最新版本。' }
    }
    if (installation.globalInstall !== true) {
      return {
        ok: false,
        error: `当前 dsh 不是 npm 全局安装（${installation.packageDir ?? '未知路径'}），无法安全自动更新。请用安装它的包管理器手动更新。`,
      }
    }
    const target = state.latestVersion
    state.phase = 'installing'
    state.error = undefined
    state.installOutput = ''
    const args = expandTarget(settings.installArgs, `${settings.packageName}@${target}`)
    appendLog(`[dsh-web-update] running ${npmCommand} ${args.join(' ')}`)
    let result
    try {
      result = await runInstall({
        npmCommand,
        args,
        cwd: os.tmpdir(),
        onSpawn: (child) => {
          installChild = child
        },
      })
    } catch (error) {
      installChild = undefined
      state.phase = 'error'
      state.error = `无法运行 npm：${safeMessage(error)}`
      return { ok: false, error: state.error }
    }
    installChild = undefined
    appendLog(result.output)
    if (result.code !== 0) {
      state.phase = 'error'
      state.error = `安装失败（npm 退出码 ${String(result.code)}）。日志见 ${logPath}`
      return { ok: false, error: state.error }
    }
    const installed = versionAt(installation.packageDir)
    if (installed !== target) {
      state.phase = 'error'
      state.error = installed === undefined
        ? `安装命令已执行，但 ${String(installation.packageDir)} 下没有可读的 package.json；可能安装到了另一个 npm prefix。`
        : `安装后的版本是 ${installed}，不是期望的 ${target}；可能安装到了另一个 npm prefix。`
      return { ok: false, error: state.error }
    }
    appendLog(`[dsh-web-update] installed ${settings.packageName}@${String(installed)}`)
    state.phase = 'restarting'
    if (!scheduleRestart(target)) return { ok: false, error: state.error ?? '无法启动自动重启。' }
    // Give the HTTP response time to reach the browser, then let the helper respawn us.
    setTimeout(() => {
      try {
        process.exit(0)
      } catch {
        process.kill(process.pid, 'SIGTERM')
      }
    }, 900)
    return { ok: true, phase: 'restarting', targetVersion: target }
  }

  const routes = [
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/state`,
      handler: (req, res) => {
        if (!guarded(ctx, req, res)) return
        if (req.method === 'GET') {
          sendJson(res, 200, snapshot())
          return
        }
        sendJson(res, 405, { ok: false, error: 'GET only' })
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/check`,
      handler: async (req, res) => {
        if (!guarded(ctx, req, res)) return
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'POST only' })
          return
        }
        await checkNow({ force: true })
        sendJson(res, 200, snapshot())
      },
    },
    {
      kind: 'exact',
      path: `${ROUTE_PREFIX}/update`,
      handler: async (req, res) => {
        if (!guarded(ctx, req, res)) return
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'POST only' })
          return
        }
        try {
          const result = await startUpdate()
          sendJson(res, result.ok ? 200 : 409, { ...result, state: snapshot() })
        } catch (error) {
          const message = safeMessage(error)
          state.phase = 'error'
          state.error = message
          console.error(`[dsh-web-update] update failed: ${message}`)
          sendJson(res, 500, { ok: false, error: message, state: snapshot() })
        }
      },
    },
  ]

  for (const route of routes) {
    ctx.effect(() => ctx.webServer.register(route), `dsh-web-update route ${route.path}`)
  }

  // Startup check, then one periodic re-check while the Host keeps running.
  ctx.effect(() => {
    const timers = []
    if (settings.autoCheckOnStart) {
      timers.push(ctx.timeout(() => {
        void checkNow()
      }, 2500))
    }
    const intervalMs = Math.max(1, settings.checkIntervalHours) * 3600 * 1000
    timers.push(ctx.interval(() => {
      void checkNow()
    }, intervalMs))
    return () => {
      for (const dispose of timers) {
        try {
          dispose()
        } catch {
          /* already fired */
        }
      }
    }
  }, 'dsh-web-update timers')

  ctx.effect(() => () => {
    disposed = true
    installChild?.kill('SIGTERM')
  }, 'dsh-web-update lifetime')

  if (installation.globalInstall !== true) {
    console.warn(`[dsh-web-update] this dsh is not an npm global install (${String(installation.packageDir)}); updates will report an error instead of installing.`)
  }
}

/** Reject one request through the connection fence; send the refusal itself. */
function guarded(ctx, req, res) {
  const code = rejectionFor(ctx, req)
  if (code === undefined) return true
  sendText(res, typeof code === 'number' ? code : 403, 'dsh-web-update: request rejected\n')
  return false
}
