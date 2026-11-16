/**
 * dsh-web-update — Client half.
 *
 * Draws the light-green "update available" pill at the right edge of the account
 * row in the sidebar foot (the row with your avatar and name), and the confirm
 * dialog that shows the running version, the published version and one final
 * confirmation. The Host half does the check, the install and the auto-restart.
 *
 * The pill is contributed through `sidebar.footer.action`, the additive slot at
 * the sidebar foot. Its own box is `position: fixed` (out of flow, so the slot
 * row keeps its height) and is anchored from the measured footer container, so
 * it follows the sidebar width and never guesses at host CSS.
 */
window.__ModuleLoader__.load({
  id: 'dsh-web-update',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } = React

    const NS = 'dsh-web-update'
    const API_STATE = '/dsh-web-update/state'
    const API_UPDATE = '/dsh-web-update/update'

    const DICTS = {
      zh: {
        pill: '有更新',
        pillInstalling: '更新中',
        pillRestarting: '重启中',
        tooltip: (latest, current) => `发现新版本 ${latest}（当前 ${current}）`,
        tooltipBusy: '正在更新 dsh web',
        title: '更新 DeepSeek Harness',
        current: '当前版本',
        latest: '最新版本',
        updating: (version) => `正在下载并安装 ${version}…`,
        updatingHint: '安装完成后会自动重启 dsh web，页面会自动刷新，无需手动刷新或启动。',
        restarting: '正在重启 dsh web…',
        restartingHint: '新服务恢复后页面会自动刷新，请稍候。',
        updated: (version) => `已更新到 ${version}`,
        updatedHint: 'dsh web 已重启完成，当前运行的就是新版本。',
        upToDate: (version) => `已是最新版本 ${version}`,
        failed: '更新失败',
        retry: '重试',
        confirm: '立即更新',
        cancel: '取消',
        close: '关闭',
        log: '安装日志',
        unknown: '未知',
      },
      en: {
        pill: 'Update',
        pillInstalling: 'Updating',
        pillRestarting: 'Restarting',
        tooltip: (latest, current) => `New version ${latest} available (current ${current})`,
        tooltipBusy: 'Updating dsh web',
        title: 'Update DeepSeek Harness',
        current: 'Current version',
        latest: 'Latest version',
        updating: (version) => `Downloading and installing ${version}…`,
        updatingHint: 'dsh web restarts automatically when the install finishes; this page refreshes itself, no manual reload needed.',
        restarting: 'Restarting dsh web…',
        restartingHint: 'This page refreshes itself as soon as the new server answers.',
        updated: (version) => `Updated to ${version}`,
        updatedHint: 'dsh web restarted and now runs the new version.',
        upToDate: (version) => `Already up to date (${version})`,
        failed: 'Update failed',
        retry: 'Retry',
        confirm: 'Update now',
        cancel: 'Cancel',
        close: 'Close',
        log: 'Install log',
        unknown: 'unknown',
      },
    }

    const CSS = `
.dshWebUpdate_pill{box-sizing:border-box;display:inline-flex;align-items:center;gap:4px;height:20px;padding:0 8px;border-radius:999px;border:0;cursor:pointer;font-family:inherit;font-size:11px;font-weight:500;line-height:17px;white-space:nowrap;color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 72%,#052e16);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);transition:background .15s ease}
[data-ds-dark-theme] .dshWebUpdate_pill{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 62%,#ffffff);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 24%,transparent)}
.dshWebUpdate_pill:hover{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 26%,transparent)}
[data-ds-dark-theme] .dshWebUpdate_pill:hover{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 34%,transparent)}
.dshWebUpdate_pill:focus-visible{outline:2px solid var(--dsw-alias-state-success-primary);outline-offset:2px}
.dshWebUpdate_pill[data-busy=true]{cursor:default}
.dshWebUpdate_pill svg{flex:none;display:block}
.dshWebUpdate_spinner{flex:none;width:10px;height:10px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--dsw-alias-state-success-primary) 30%,transparent);border-top-color:var(--dsw-alias-state-success-primary);animation:dshWebUpdate_spin .8s linear infinite}
@keyframes dshWebUpdate_spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.dshWebUpdate_spinner{animation:none}}
.dshWebUpdate_backdrop{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:24px;background:var(--dsw-alias-bg-mask-1)}
.dshWebUpdate_modal{box-sizing:border-box;width:min(420px,100%);padding:20px 20px 16px;border-radius:14px;border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-shadow-lv3,0 16px 48px rgba(0,0,0,.28));font-size:13px;line-height:1.5}
.dshWebUpdate_title{margin:0 0 12px;font-size:15px;font-weight:600;line-height:22px}
.dshWebUpdate_rows{display:flex;flex-direction:column;gap:8px;margin:0 0 12px}
.dshWebUpdate_row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.dshWebUpdate_label{color:var(--dsw-alias-label-secondary)}
.dshWebUpdate_value{font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:12px}
.dshWebUpdate_valueNew{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 72%,var(--dsw-alias-label-primary))}
.dshWebUpdate_note{margin:0 0 16px;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.55}
.dshWebUpdate_progress{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-weight:500}
.dshWebUpdate_progress .dshWebUpdate_spinner{width:14px;height:14px;border-width:2px}
.dshWebUpdate_log{margin:8px 0 16px;padding:8px 10px;max-height:120px;overflow:auto;border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
.dshWebUpdate_error{margin:0 0 16px;padding:8px 10px;border-radius:8px;color:var(--dsw-alias-state-error-primary);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);font-size:12px;line-height:1.5;word-break:break-word}
.dshWebUpdate_actions{display:flex;justify-content:flex-end;gap:8px}
.dshWebUpdate_button{box-sizing:border-box;height:32px;padding:0 14px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:13px;font-weight:500;cursor:pointer}
.dshWebUpdate_button:hover{background:var(--dsw-alias-bg-layer-2)}
.dshWebUpdate_button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dshWebUpdate_primary{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 72%,#052e16);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 42%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent)}
.dshWebUpdate_primary:hover{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 24%,transparent)}
.dshWebUpdate_primary[disabled]{opacity:.5;cursor:default}
[data-ds-dark-theme] .dshWebUpdate_primary{color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 62%,#ffffff);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 46%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 22%,transparent)}
[data-ds-dark-theme] .dshWebUpdate_primary:hover{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 32%,transparent)}
`

    async function readState() {
      const response = await fetch(API_STATE, { cache: 'no-store', headers: { accept: 'application/json' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    async function postUpdate() {
      const response = await fetch(API_UPDATE, { method: 'POST', cache: 'no-store', headers: { accept: 'application/json' } })
      let body
      try {
        body = await response.json()
      } catch {
        body = undefined
      }
      return { ok: response.ok, status: response.status, body }
    }

    function stripVersion(value) {
      return typeof value === 'string' && value !== '' ? value : undefined
    }

    /** Facts shared by the React entry and the module-level auto-refresh watchdog. */
    const runtime = { updateStartedAt: 0 }

    return {
      inject: ['slots'],
      apply(ctx) {
        const style = document.createElement('style')
        style.dataset.dshWebUpdate = '1'
        style.textContent = CSS
        document.head.appendChild(style)
        ctx.effect(() => () => {
          style.remove()
        })

        const localeApi = ctx.get('locale')

        /**
         * Auto-refresh watchdog for a dsh self-update.
         *
         * Installing a new release changes the whole client release: this page
         * keeps the release it booted from and DSH intentionally refuses to
         * apply the new Host's plugin graphs until the page reloads, so its root
         * can go empty and stay empty until a manual refresh. This watcher is
         * owned by the plugin context — not by the React tree — so it survives
         * that empty root and reloads the page exactly once per new Host release.
         */
        ctx.effect(() => {
          const RELOAD_GUARD = 'dsh-web-update:auto-reload'
          const MAX_ATTEMPTS = 3
          const pageReleaseVersion = () => {
            try {
              const version = window.__DSH_BOOT__?.release?.version
              return typeof version === 'string' && version !== '' ? version : undefined
            } catch {
              return undefined
            }
          }
          const readGuard = () => {
            try {
              const parsed = JSON.parse(window.sessionStorage.getItem(RELOAD_GUARD) ?? 'null')
              return parsed !== null && typeof parsed === 'object' ? parsed : undefined
            } catch {
              return undefined
            }
          }
          const writeGuard = (value) => {
            try {
              if (value === undefined) window.sessionStorage.removeItem(RELOAD_GUARD)
              else window.sessionStorage.setItem(RELOAD_GUARD, JSON.stringify(value))
            } catch {
              /* storage can be unavailable in private modes */
            }
          }
          let timer
          const tick = async () => {
            let reachableNow = false
            let hostVersion
            try {
              const response = await fetch(API_STATE, { cache: 'no-store', headers: { accept: 'application/json' } })
              if (response.ok) {
                hostVersion = stripVersion((await response.json())?.currentVersion)
                reachableNow = true
              }
            } catch {
              reachableNow = false
            }
            const pageVersion = pageReleaseVersion()
            if (reachableNow && pageVersion !== undefined && hostVersion !== undefined) {
              if (pageVersion === hostVersion) {
                if (readGuard() !== undefined) writeGuard(undefined)
              } else {
                const guard = readGuard()
                const attempts = guard !== undefined && guard.version === hostVersion ? Number(guard.attempts ?? 0) : 0
                if (attempts < MAX_ATTEMPTS) {
                  writeGuard({ version: hostVersion, attempts: attempts + 1, at: Date.now() })
                  console.info(`[dsh-web-update] page release ${pageVersion} differs from host release ${hostVersion}; reloading the page`)
                  window.location.reload()
                  return
                }
              }
            }
            // Poll tightly through the install/restart window an update opened.
            const updating = runtime.updateStartedAt !== 0 && Date.now() - runtime.updateStartedAt < 10 * 60 * 1000
            const delay = !reachableNow ? 1500 : updating ? 1200 : 8000
            timer = window.setTimeout(tick, delay)
          }
          timer = window.setTimeout(tick, 3000)
          return () => window.clearTimeout(timer)
        }, 'dsh-web-update auto reload')

        function useLang() {
          const subscribe = useCallback((notify) => {
            if (localeApi === undefined || typeof localeApi.subscribe !== 'function') return () => {}
            return localeApi.subscribe(notify)
          }, [])
          const snapshot = useCallback(() => {
            let id = ''
            try {
              id = String(localeApi?.getLocale?.()?.id ?? '')
            } catch {
              id = ''
            }
            if (id === '' && typeof navigator !== 'undefined') id = String(navigator.language ?? '')
            return id.toLowerCase().startsWith('zh') ? 'zh' : 'en'
          }, [])
          return useSyncExternalStore(subscribe, snapshot, snapshot)
        }

        function UpdateEntry(props) {
          const lang = useLang()
          const dict = DICTS[lang] ?? DICTS.en
          const t = (key) => dict[key] ?? key
          const wide = props?.wide !== false

          const [data, setData] = useState(undefined)
          const [reachable, setReachable] = useState(true)
          const [refresh, setRefresh] = useState(0)
          const [open, setOpen] = useState(false)
          const [submitting, setSubmitting] = useState(false)
          const [actionError, setActionError] = useState(undefined)
          const sawRestart = useRef(false)
          const prevBusy = useRef(false)
          const [justUpdated, setJustUpdated] = useState(false)
          const wrapRef = useRef(null)
          const dialogRef = useRef(null)
          const [anchor, setAnchor] = useState({ right: 12, bottom: 22 })

          const phase = data?.phase ?? 'idle'
          const installing = phase === 'installing'
          const restarting = phase === 'restarting' || (!reachable && sawRestart.current && !installing)
          const busy = installing || restarting
          const currentVersion = stripVersion(data?.currentVersion)
          const latestVersion = stripVersion(data?.latestVersion)
          const updateAvailable = data?.updateAvailable === true

          // Track the restart window so a page that loses its connection still
          // reports "restarting" instead of silently hiding the badge.
          useEffect(() => {
            if (phase === 'installing' || phase === 'restarting') sawRestart.current = true
            if (reachable && phase === 'idle' && data !== undefined && data.updateAvailable === false) sawRestart.current = false
            if (prevBusy.current && !busy && reachable && data !== undefined && data.updateAvailable === false) setJustUpdated(true)
            prevBusy.current = busy
          }, [phase, reachable, data, busy])

          useEffect(() => {
            if (!open) setJustUpdated(false)
          }, [open])

          useEffect(() => {
            let cancelled = false
            let timer
            const tick = async () => {
              let next
              try {
                next = await readState()
                if (cancelled) return
                setData(next)
                setReachable(true)
              } catch {
                if (cancelled) return
                setReachable(false)
              }
              if (cancelled) return
              const activePhase = next?.phase
              // Poll tightly through an install/restart window, and slowly
              // while the Host only reports an already-known version.
              const delay = next === undefined ? 1500
                : activePhase === 'installing' || activePhase === 'restarting' ? 1200
                  : 60000
              timer = setTimeout(tick, delay)
            }
            void tick()
            return () => {
              cancelled = true
              if (timer !== undefined) clearTimeout(timer)
            }
          }, [refresh])

          const bump = useCallback(() => setRefresh((value) => value + 1), [])

          useLayoutEffect(() => {
            if (!wide) return undefined
            const element = wrapRef.current
            if (!element) return undefined
            // The slot wrapper is zero-height inside the sidebar foot; anchor on
            // the first ancestor that actually owns a box (the foot column).
            let box = element
            for (let depth = 0; depth < 6 && box !== null; depth += 1) {
              // The slot wrapper and the footer action row are zero-height; the
              // first ancestor that owns a real box is the sidebar foot column,
              // whose bottom edge carries the account row.
              if (box.offsetHeight > 0) break
              box = box.parentElement
            }
            if (box === null) box = element
            const measure = () => {
              const rect = box.getBoundingClientRect()
              setAnchor({
                right: Math.max(0, Math.round(window.innerWidth - rect.right) + 2),
                bottom: Math.max(8, Math.round(window.innerHeight - rect.bottom) + 16),
              })
            }
            measure()
            // The sidebar animates in on boot; re-read once it has settled.
            const settle = window.setTimeout(measure, 250)
            const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined
            observer?.observe(box)
            window.addEventListener('resize', measure)
            return () => {
              window.clearTimeout(settle)
              observer?.disconnect()
              window.removeEventListener('resize', measure)
            }
          }, [wide])

          useEffect(() => {
            if (!open) return undefined
            const onKeyDown = (event) => {
              if (event.key !== 'Escape') return
              if (busy || submitting) return
              setOpen(false)
            }
            document.addEventListener('keydown', onKeyDown)
            return () => document.removeEventListener('keydown', onKeyDown)
          }, [open, busy, submitting])

          useEffect(() => {
            if (!open) return
            const button = dialogRef.current?.querySelector('[data-autofocus=true]')
            button?.focus?.()
          }, [open, phase, submitting])

          const startUpdate = useCallback(async () => {
            setSubmitting(true)
            setActionError(undefined)
            try {
              const result = await postUpdate()
              if (!result.ok) {
                setActionError(result.body?.error ?? `HTTP ${result.status}`)
              } else {
                sawRestart.current = true
                runtime.updateStartedAt = Date.now()
              }
            } catch (error) {
              setActionError(error instanceof Error ? error.message : String(error))
            } finally {
              setSubmitting(false)
              bump()
            }
          }, [bump])

          if (!wide) return null

          const showPill = updateAvailable || busy
          const pillLabel = restarting ? t('pillRestarting') : installing ? t('pillInstalling') : t('pill')
          const tooltip = busy
            ? t('tooltipBusy')
            : updateAvailable && latestVersion !== undefined
              ? t('tooltip')(latestVersion, currentVersion ?? t('unknown'))
              : pillLabel

          const renderBody = () => {
            if (installing || submitting) {
              return [h('h2', { className: 'dshWebUpdate_title', key: 'title' }, t('title')),
                h('div', { className: 'dshWebUpdate_progress', key: 'progress' },
                  h('span', { className: 'dshWebUpdate_spinner', 'aria-hidden': 'true' }),
                  h('span', null, t('updating')(latestVersion ?? t('unknown')))),
                h('p', { className: 'dshWebUpdate_note', key: 'note' }, t('updatingHint')),
                data?.installOutput
                  ? h('pre', { className: 'dshWebUpdate_log', key: 'log', 'aria-label': t('log') }, String(data.installOutput).slice(-1600))
                  : null,
                actionError !== undefined ? h('p', { className: 'dshWebUpdate_error', key: 'error' }, actionError) : null,
                h('div', { className: 'dshWebUpdate_actions', key: 'actions' },
                  h('button', { className: 'dshWebUpdate_button', type: 'button', onClick: () => setOpen(false) }, t('close')))]
            }
            if (restarting) {
              return [h('h2', { className: 'dshWebUpdate_title', key: 'title' }, t('title')),
                h('div', { className: 'dshWebUpdate_progress', key: 'progress' },
                  h('span', { className: 'dshWebUpdate_spinner', 'aria-hidden': 'true' }),
                  h('span', null, t('restarting'))),
                h('p', { className: 'dshWebUpdate_note', key: 'note' }, t('restartingHint')),
                actionError !== undefined ? h('p', { className: 'dshWebUpdate_error', key: 'error' }, actionError) : null,
                h('div', { className: 'dshWebUpdate_actions', key: 'actions' },
                  h('button', { className: 'dshWebUpdate_button', type: 'button', onClick: () => setOpen(false) }, t('close')))]
            }
            if (actionError !== undefined || phase === 'error') {
              return [h('h2', { className: 'dshWebUpdate_title', key: 'title' }, t('failed')),
                h('p', { className: 'dshWebUpdate_error', key: 'error' }, actionError ?? data?.error ?? t('failed')),
                h('div', { className: 'dshWebUpdate_actions', key: 'actions' },
                  updateAvailable
                    ? h('button', { className: 'dshWebUpdate_button dshWebUpdate_primary', type: 'button', 'data-autofocus': 'true', onClick: () => { void startUpdate() }, disabled: submitting }, t('retry'))
                    : null,
                  h('button', { className: 'dshWebUpdate_button', type: 'button', onClick: () => setOpen(false) }, t('close')))]
            }
            if (updateAvailable) {
              return [h('h2', { className: 'dshWebUpdate_title', key: 'title' }, t('title')),
                h('div', { className: 'dshWebUpdate_rows', key: 'rows' },
                  h('div', { className: 'dshWebUpdate_row' },
                    h('span', { className: 'dshWebUpdate_label' }, t('current')),
                    h('span', { className: 'dshWebUpdate_value' }, currentVersion ?? t('unknown'))),
                  h('div', { className: 'dshWebUpdate_row' },
                    h('span', { className: 'dshWebUpdate_label' }, t('latest')),
                    h('span', { className: 'dshWebUpdate_value dshWebUpdate_valueNew' }, latestVersion ?? t('unknown')))),
                h('p', { className: 'dshWebUpdate_note', key: 'note' }, t('updatingHint')),
                h('div', { className: 'dshWebUpdate_actions', key: 'actions' },
                  h('button', { className: 'dshWebUpdate_button', type: 'button', onClick: () => setOpen(false) }, t('cancel')),
                  h('button', {
                    className: 'dshWebUpdate_button dshWebUpdate_primary',
                    type: 'button',
                    'data-autofocus': 'true',
                    disabled: submitting,
                    onClick: () => { void startUpdate() },
                  }, t('confirm')))]
            }
            const success = data !== undefined && !updateAvailable && reachable && justUpdated
            return [h('h2', { className: 'dshWebUpdate_title', key: 'title' },
              success ? t('updated')(currentVersion ?? t('unknown')) : t('title')),
              h('p', { className: 'dshWebUpdate_note', key: 'note' },
                success ? t('updatedHint') : t('upToDate')(currentVersion ?? t('unknown'))),
              h('div', { className: 'dshWebUpdate_actions', key: 'actions' },
                h('button', { className: 'dshWebUpdate_button', type: 'button', 'data-autofocus': 'true', onClick: () => setOpen(false) }, t('close')))]
          }

          const dialog = open
            ? h('div', {
                className: 'dshWebUpdate_backdrop',
                onMouseDown: (event) => {
                  if (event.target === event.currentTarget && !busy && !submitting) setOpen(false)
                },
              }, h('div', {
                className: 'dshWebUpdate_modal',
                ref: dialogRef,
                role: 'dialog',
                'aria-modal': 'true',
                'aria-label': t('title'),
              }, renderBody()))
            : null

          return h('div', {
            ref: wrapRef,
            style: { boxSizing: 'border-box', width: '100%', height: 0, minHeight: 0, overflow: 'visible' },
            'data-dsh-web-update': 'anchor',
          },
          showPill
            ? h('button', {
                type: 'button',
                className: 'dshWebUpdate_pill',
                'data-busy': busy ? 'true' : 'false',
                'aria-label': tooltip,
                title: tooltip,
                style: { position: 'fixed', right: `${anchor.right}px`, bottom: `${anchor.bottom}px`, zIndex: 60 },
                onClick: () => setOpen(true),
              },
              busy
                ? h('span', { className: 'dshWebUpdate_spinner', 'aria-hidden': 'true' })
                : h('svg', { viewBox: '0 0 12 12', width: 11, height: 11, 'aria-hidden': 'true' },
                    h('path', { d: 'M6 1.8v5.4M3.7 5 6 7.3 8.3 5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', strokeLinejoin: 'round' }),
                    h('path', { d: 'M2.3 8.4v.8c0 .5.4.9.9.9h5.6c.5 0 .9-.4.9-.9v-.8', fill: 'none', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })),
              h('span', null, pillLabel))
            : null,
          dialog)
        }

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: NS,
          order: 100,
          label: () => 'DSH Web Update',
        }, UpdateEntry))
      },
    }
  },
})
