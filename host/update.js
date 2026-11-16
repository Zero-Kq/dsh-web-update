/**
 * Version detection, registry lookup and npm install for dsh-web-update.
 *
 * Everything here is plain Node (no Host services) so it can be unit-tested
 * from a shell without booting a Harness.
 */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

/** Package this updater manages when no config overrides it. */
export const DEFAULT_PACKAGE = '@deepseek-ai/dsh'
/** Default npm dist-tag asked of the registry. */
export const DEFAULT_DIST_TAG = 'latest'

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** Parse a semver-ish version string.
 * @param {string} value candidate version
 * @returns {{major:number,minor:number,patch:number,prerelease:string[]}|undefined}
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return undefined
  const match = SEMVER_RE.exec(value.trim())
  if (match === null) return undefined
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Compare two semantic versions the way npm dist-tags resolve.
 * @param {string} left version
 * @param {string} right version
 * @returns {number} negative when left is older, 0 when equal, positive when newer
 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) return String(left).localeCompare(String(right))
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  if (a.prerelease.length === 0 && b.prerelease.length === 0) return 0
  // A release outranks any prerelease of the same triple.
  if (a.prerelease.length === 0) return 1
  if (b.prerelease.length === 0) return -1
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const one = a.prerelease[index]
    const two = b.prerelease[index]
    if (one === undefined) return -1
    if (two === undefined) return 1
    const oneNumeric = /^\d+$/.test(one)
    const twoNumeric = /^\d+$/.test(two)
    if (oneNumeric && twoNumeric) {
      const delta = Number(one) - Number(two)
      if (delta !== 0) return delta < 0 ? -1 : 1
      continue
    }
    if (oneNumeric !== twoNumeric) return oneNumeric ? -1 : 1
    if (one !== two) return one < two ? -1 : 1
  }
  return 0
}

/** Whether `candidate` should be offered over `current`.
 * @param {string} candidate version reported by the registry
 * @param {string} current version of the running installation
 * @param {{allowPrereleaseUpdates?: boolean}} options behavior switches
 * @returns {boolean} true only for a genuinely newer, admissible version
 */
export function isNewerVersion(candidate, current, options = {}) {
  const allowPrerelease = options.allowPrereleaseUpdates !== false
  const parsed = parseVersion(candidate)
  if (parsed === undefined) return false
  if (parsed.prerelease.length > 0 && !allowPrerelease) return false
  return compareVersions(candidate, current) > 0
}

function readPackageJson(directory) {
  try {
    return JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/** Walk up from a file until the package manifest with this name is found. */
function packageAbove(file, packageName) {
  let directory
  try {
    directory = path.dirname(realpathSync(file))
  } catch {
    return undefined
  }
  for (let depth = 0; depth < 12; depth += 1) {
    const manifest = readPackageJson(directory)
    if (manifest !== undefined && manifest.name === packageName) {
      return { packageDir: directory, version: manifest.version, manifest }
    }
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

/**
 * Describe the installation this Host process runs from.
 *
 * `argv` is what a restart must replay; `prefix` (when the package sits under a
 * `<prefix>/lib/node_modules` tree, which is what npm global installs produce)
 * locates the npm that owns this installation.
 * @param {{packageName?: string}} config package to detect
 * @returns {object} installation facts, or `{error}` when it cannot be detected
 */
export function detectInstallation(config = {}) {
  const packageName = config.packageName ?? DEFAULT_PACKAGE
  const execPath = process.execPath
  const argv = process.argv.slice(1)
  const cwd = (() => {
    try {
      return process.cwd()
    } catch {
      return undefined
    }
  })()
  const entry = argv[0]
  const found = typeof entry === 'string' ? packageAbove(entry, packageName) : undefined
  if (found === undefined) {
    return {
      packageName,
      version: undefined,
      packageDir: undefined,
      prefix: undefined,
      npmCommand: undefined,
      execPath,
      argv,
      cwd,
      error: `cannot locate the ${packageName} package manifest from ${String(entry)}`,
    }
  }
  const normalized = found.packageDir.split(path.sep).join('/')
  const marker = `/lib/node_modules/${packageName}`
  const prefix = normalized.endsWith(marker) ? normalized.slice(0, -marker.length) : undefined
  let npmCommand = 'npm'
  if (prefix !== undefined) {
    const candidate = path.join(prefix, 'bin', 'npm')
    try {
      if (existsSync(candidate) && statSync(candidate).isFile()) npmCommand = candidate
    } catch {
      /* keep the PATH lookup */
    }
  }
  return {
    packageName,
    version: typeof found.version === 'string' ? found.version : undefined,
    packageDir: found.packageDir,
    prefix,
    npmCommand,
    execPath,
    argv,
    cwd,
    globalInstall: prefix !== undefined,
  }
}

/**
 * Ask the npm registry for the version behind one dist-tag.
 * @param {{registryUrl?: string, packageName?: string, distTag?: string, timeoutMs?: number}} options lookup
 * @returns {Promise<{version: string, publishedAt?: string}>} resolved tag
 */
export async function fetchLatestVersion(options = {}) {
  const registry = (options.registryUrl ?? 'https://registry.npmjs.org').replace(/\/+$/u, '')
  const packageName = options.packageName ?? DEFAULT_PACKAGE
  const distTag = options.distTag ?? DEFAULT_DIST_TAG
  const timeoutMs = options.timeoutMs ?? 15000
  const url = `${registry}/${encodeURIComponent(packageName)}/${encodeURIComponent(distTag)}`
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'dsh-web-update' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) throw new Error(`registry answered HTTP ${String(response.status)} for ${url}`)
  const body = await response.json()
  if (typeof body?.version !== 'string' || parseVersion(body.version) === undefined) {
    throw new Error(`registry returned no usable version for ${packageName}@${distTag}`)
  }
  return { version: body.version, publishedAt: typeof body.time === 'string' ? body.time : undefined }
}

/** Read the version of `packageDir`'s installed package manifest.
 * @param {string} packageDir installed package directory
 * @returns {string|undefined} version string
 */
export function versionAt(packageDir) {
  const manifest = readPackageJson(packageDir)
  return typeof manifest?.version === 'string' ? manifest.version : undefined
}

/**
 * Run the npm install that replaces the installed package.
 *
 * The child's stdout/stderr are folded into one rolling log tail. `onSpawn`
 * receives the child handle so the caller can kill an abandoned install.
 * @param {{npmCommand: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv, onSpawn?: (child: import('node:child_process').ChildProcess) => void, logLimit?: number}} request install request
 * @returns {Promise<{code: number|null, signal: string|null, output: string}>} finished install
 */
export function runInstall(request) {
  const limit = request.logLimit ?? 16384
  let output = ''
  let settled = false
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(request.npmCommand, request.args, {
        cwd: request.cwd ?? process.env.HOME ?? '/',
        env: request.env ?? process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      reject(error)
      return
    }
    request.onSpawn?.(child)
    const append = (chunk) => {
      output += chunk.toString('utf8')
      if (output.length > limit) output = output.slice(output.length - limit)
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    child.once('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      resolve({ code, signal, output })
    })
  })
}
