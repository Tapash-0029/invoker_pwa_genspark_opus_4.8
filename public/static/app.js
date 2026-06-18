/* ============================================================
   INVOKER — PWA SPA Client
   ============================================================ */
'use strict'

/* ---------------- State ---------------- */
const State = {
  access: localStorage.getItem('inv_access') || null,
  refresh: localStorage.getItem('inv_refresh') || null,
  user: JSON.parse(localStorage.getItem('inv_user') || 'null'),
  companies: JSON.parse(localStorage.getItem('inv_companies') || '[]'),
  activeCompany: localStorage.getItem('inv_company') || null,
  activeRole: localStorage.getItem('inv_role') || null,
  theme: localStorage.getItem('inv_theme') || 'dark',
  route: 'dashboard',
  online: navigator.onLine,
  syncId: parseInt(localStorage.getItem('inv_sync_id') || '0'),
  dashboard: null,
  company: null,
}

function persist() {
  if (State.access) localStorage.setItem('inv_access', State.access); else localStorage.removeItem('inv_access')
  if (State.refresh) localStorage.setItem('inv_refresh', State.refresh); else localStorage.removeItem('inv_refresh')
  if (State.user) localStorage.setItem('inv_user', JSON.stringify(State.user)); else localStorage.removeItem('inv_user')
  localStorage.setItem('inv_companies', JSON.stringify(State.companies || []))
  if (State.activeCompany) localStorage.setItem('inv_company', State.activeCompany)
  if (State.activeRole) localStorage.setItem('inv_role', State.activeRole)
  localStorage.setItem('inv_theme', State.theme)
}

/* ---------------- API client ---------------- */
async function api(path, { method = 'GET', body, auth = true, retry = true } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (auth && State.access) headers.Authorization = 'Bearer ' + State.access
  let res
  try {
    res = await fetch('/api' + path, { method, headers, body: body ? JSON.stringify(body) : undefined })
  } catch (e) {
    throw { offline: true, message: 'Network unavailable' }
  }
  if (res.status === 401 && auth && retry && State.refresh) {
    const ok = await refreshToken()
    if (ok) return api(path, { method, body, auth, retry: false })
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw { status: res.status, message: data.error || 'Request failed', data }
  return data
}

async function refreshToken() {
  try {
    const r = await fetch('/api/auth/refresh', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: State.refresh, company_id: State.activeCompany }),
    })
    if (!r.ok) { logout(true); return false }
    const d = await r.json()
    State.access = d.access
    State.activeCompany = d.active_company
    State.activeRole = d.active_role
    if (d.companies) State.companies = d.companies
    persist(); return true
  } catch { return false }
}

/* ---------------- Offline queue (IndexedDB) ---------------- */
const IDB = {
  db: null,
  open() {
    return new Promise((resolve) => {
      const req = indexedDB.open('invoker', 1)
      req.onupgradeneeded = (e) => {
        const db = e.target.result
        if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true })
        if (!db.objectStoreNames.contains('cache')) db.createObjectStore('cache', { keyPath: 'key' })
      }
      req.onsuccess = (e) => { this.db = e.target.result; resolve(this.db) }
      req.onerror = () => resolve(null)
    })
  },
  async enqueue(item) {
    if (!this.db) await this.open()
    return new Promise((res) => {
      const tx = this.db.transaction('queue', 'readwrite')
      tx.objectStore('queue').add({ ...item, ts: Date.now() })
      tx.oncomplete = res
    })
  },
  async all() {
    if (!this.db) await this.open()
    return new Promise((res) => {
      const tx = this.db.transaction('queue', 'readonly')
      const r = tx.objectStore('queue').getAll()
      r.onsuccess = () => res(r.result || [])
    })
  },
  async clear(id) {
    if (!this.db) await this.open()
    const tx = this.db.transaction('queue', 'readwrite')
    tx.objectStore('queue').delete(id)
  },
  async setCache(key, value) {
    if (!this.db) await this.open()
    const tx = this.db.transaction('cache', 'readwrite')
    tx.objectStore('cache').put({ key, value, ts: Date.now() })
  },
  async getCache(key) {
    if (!this.db) await this.open()
    return new Promise((res) => {
      const tx = this.db.transaction('cache', 'readonly')
      const r = tx.objectStore('cache').get(key)
      r.onsuccess = () => res(r.result?.value || null)
    })
  },
}

async function replayQueue() {
  if (!State.online) return
  const items = await IDB.all()
  for (const it of items) {
    try {
      await api(it.path, { method: it.method, body: it.body })
      await IDB.clear(it.id)
    } catch (e) { /* keep in queue */ break }
  }
  if (items.length) { toast('Synced ' + items.length + ' offline change(s)', 'ok'); loadRoute(State.route) }
}

/* ---------------- UI helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s)
const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild }
const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
const curr = () => State.company?.currency || 'BDT'
const money = (n) => curr() + ' ' + fmt(n)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]))

function toast(msg, kind = 'info', icon) {
  const host = $('#toast-host')
  const ic = icon || (kind === 'ok' ? 'fa-circle-check' : kind === 'bad' ? 'fa-circle-exclamation' : 'fa-circle-info')
  const t = el(`<div class="toast ${kind}"><i class="fa-solid ${ic}"></i><span>${esc(msg)}</span></div>`)
  host.appendChild(t)
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300) }, 3200)
}

function ripple(e) {
  const btn = e.currentTarget
  const r = btn.getBoundingClientRect()
  const c = el('<span class="ripple"></span>')
  const size = Math.max(r.width, r.height)
  c.style.width = c.style.height = size + 'px'
  c.style.left = (e.clientX - r.left - size / 2) + 'px'
  c.style.top = (e.clientY - r.top - size / 2) + 'px'
  btn.appendChild(c)
  setTimeout(() => c.remove(), 600)
}
function bindRipples(root = document) {
  root.querySelectorAll('.btn:not([data-r])').forEach((b) => { b.dataset.r = 1; b.addEventListener('click', ripple) })
}

function confetti() {
  const colors = ['#6366f1', '#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ef4444']
  for (let i = 0; i < 60; i++) {
    const p = el('<div class="confetti-piece"></div>')
    p.style.background = colors[i % colors.length]
    p.style.left = (50 + (Math.random() - 0.5) * 30) + 'vw'
    p.style.top = '40vh'
    document.body.appendChild(p)
    const ang = Math.random() * Math.PI * 2, dist = 120 + Math.random() * 280
    p.animate([
      { transform: 'translate(0,0) rotate(0)', opacity: 1 },
      { transform: `translate(${Math.cos(ang) * dist}px, ${Math.sin(ang) * dist + 250}px) rotate(${Math.random() * 720}deg)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 600, easing: 'cubic-bezier(.2,.6,.4,1)' }).onfinish = () => p.remove()
  }
}

/* ---------------- Theme ---------------- */
function applyTheme() {
  document.body.setAttribute('data-theme', State.theme)
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', State.theme === 'dark' ? '#0b0f1a' : '#f6f1e8')
}
function toggleTheme() {
  State.theme = State.theme === 'dark' ? 'light' : 'dark'
  applyTheme(); persist()
}

/* ---------------- Modal ---------------- */
function modal(html) {
  const host = $('#modal-host')
  const ov = el(`<div class="modal-overlay"><div class="modal">${html}</div></div>`)
  ov.addEventListener('click', (e) => { if (e.target === ov) closeModal() })
  host.appendChild(ov); bindRipples(ov)
  return ov
}
function closeModal() { $('#modal-host').innerHTML = '' }

/* ============================================================
   AUTH SCREENS
   ============================================================ */
function renderAuth(mode = 'login') {
  const root = $('#app-root')
  const isLogin = mode === 'login'
  // floating magical motes
  const motes = Array.from({ length: 14 }).map(() => {
    const x = Math.random() * 100, dur = 9 + Math.random() * 12, delay = Math.random() * 12
    const col = ['#00d2ff', '#f5a623', '#8b5cf6'][Math.floor(Math.random() * 3)]
    return `<i style="left:${x}%;bottom:-10px;animation-duration:${dur}s;animation-delay:${delay}s;background:${col};box-shadow:0 0 8px ${col}"></i>`
  }).join('')

  const fields = isLogin ? `
      <div class="arc-field">
        <label>Username or Email</label>
        <div class="arc-input">
          <span class="ico"><i class="fa-solid fa-user"></i></span>
          <input type="email" name="email" placeholder="name@company.com" autocomplete="username" required>
          <span class="trail"><span class="avatar"><i class="fa-solid fa-user-astronaut"></i></span></span>
        </div>
      </div>
      <div class="arc-field">
        <label>Password</label>
        <div class="arc-input">
          <span class="ico"><i class="fa-solid fa-lock"></i></span>
          <input type="password" name="password" id="pw" placeholder="••••••••" autocomplete="current-password" required>
          <span class="trail"><i class="fa-solid fa-eye-slash eye" id="pw-eye"></i></span>
        </div>
      </div>
      <div class="arc-row">
        <div class="arc-check" id="remember"><span class="arc-box on" id="rem-box"><i class="fa-solid fa-check"></i></span> Remember me</div>
        <a class="arc-link" id="forgot">Forgot your password?</a>
      </div>` : `
      <div class="arc-field">
        <label>Full Name</label>
        <div class="arc-input">
          <span class="ico"><i class="fa-solid fa-user"></i></span>
          <input type="text" name="name" placeholder="e.g. John Doe" required>
        </div>
      </div>
      <div class="arc-field">
        <label>Email</label>
        <div class="arc-input">
          <span class="ico"><i class="fa-solid fa-envelope"></i></span>
          <input type="email" name="email" placeholder="name@company.com" autocomplete="email" required>
          <span class="trail"><span class="avatar"><i class="fa-solid fa-user-astronaut"></i></span></span>
        </div>
      </div>
      <div class="arc-field">
        <label>Password</label>
        <div class="arc-input">
          <span class="ico"><i class="fa-solid fa-lock"></i></span>
          <input type="password" name="password" id="pw" placeholder="••••••••" autocomplete="new-password" required>
          <span class="trail"><i class="fa-solid fa-eye-slash eye" id="pw-eye"></i></span>
        </div>
      </div>
      <div class="arc-field">
        <label>Company/Hospital Name</label>
        <div class="arc-input">
          <span class="ico"><i class="fa-solid fa-hospital"></i></span>
          <input type="text" name="company_name" placeholder="e.g. General Hospital">
        </div>
      </div>`

  root.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-motes">${motes}</div>
    <section class="auth-card">
      <div class="arc-frame">
        <span class="arc-corner tl"></span><span class="arc-corner tr"></span>
        <span class="arc-corner bl"></span><span class="arc-corner br"></span>
        <span class="arc-rune l"></span><span class="arc-rune r"></span>
        <div class="arc-crest"></div>
        <h1 class="arc-title">INVOKER</h1>
        <div class="arc-sub">PLATFORM ACCESS</div>
        <div class="arc-tabs">
          <button class="arc-tab ${isLogin ? 'active' : ''}" data-m="login"><i class="fa-solid fa-user"></i> SIGN IN</button>
          <button class="arc-tab ${!isLogin ? 'active' : ''}" data-m="register"><i class="fa-solid fa-user-plus"></i> REGISTER</button>
        </div>
        <form id="auth-form" class="arc-fields">${fields}</form>
        <div class="arc-gem"><i class="fa-solid fa-compass"></i></div>
        <button class="arc-cta" id="auth-submit" type="button">
          <span class="label"><i class="fa-solid fa-${isLogin ? 'right-to-bracket' : 'wand-magic-sparkles'}"></i> ${isLogin ? 'ACCESS YOUR DASHBOARD' : 'CREATE YOUR ACCOUNT'}</span>
          <span class="spinner"></span>
        </button>
        <div class="arc-cta-flare"></div>
        <div class="arc-demo">Demo: <b>admin@invoker.dev</b> / <b>password123</b></div>
      </div>
    </section>
    <i class="fa-solid fa-sparkles arc-spark"></i>
  </div>`

  // tab switching
  root.querySelectorAll('.arc-tab').forEach((t) => t.addEventListener('click', () => { if (t.dataset.m !== mode) renderAuth(t.dataset.m) }))
  // password eye
  const eye = $('#pw-eye')
  eye?.addEventListener('click', () => {
    const pw = $('#pw'); const show = pw.type === 'password'
    pw.type = show ? 'text' : 'password'
    eye.className = 'fa-solid eye ' + (show ? 'fa-eye' : 'fa-eye-slash')
  })
  // remember me
  let remember = true
  $('#remember')?.addEventListener('click', () => { remember = !remember; $('#rem-box').classList.toggle('on', remember) })
  $('#forgot')?.addEventListener('click', () => toast('Contact your administrator to reset your password', 'info', 'fa-key'))

  const submit = async () => {
    const f = new FormData($('#auth-form'))
    const data = Object.fromEntries(f)
    if (!data.email || !data.password || (!isLogin && !data.name)) { toast('Please fill all required fields', 'bad'); return }
    const btn = $('#auth-submit'); btn.classList.add('morph')
    try {
      const path = isLogin ? '/auth/login' : '/auth/register'
      const d = await api(path, { method: 'POST', auth: false, body: data })
      onAuth(d)
    } catch (err) {
      btn.classList.remove('morph')
      toast(err.message || 'Authentication failed', 'bad')
    }
  }
  $('#auth-submit').addEventListener('click', submit)
  $('#auth-form').addEventListener('submit', (e) => { e.preventDefault(); submit() })
}

function onAuth(d) {
  State.access = d.access; State.refresh = d.refresh; State.user = d.user
  State.companies = d.companies || []
  State.activeCompany = d.active_company
  State.activeRole = d.active_role || (State.companies[0] && State.companies[0].role)
  persist()
  toast('Welcome, ' + (d.user?.name || 'user') + '!', 'ok', 'fa-hand-sparkles')
  bootApp()
}

function logout(silent) {
  if (State.refresh && !silent) api('/auth/logout', { method: 'POST', auth: false, body: { refresh_token: State.refresh } }).catch(() => {})
  State.access = State.refresh = State.user = null; State.activeCompany = State.activeRole = null
  localStorage.clear()
  stopSync()
  renderAuth('login')
}

/* ============================================================
   APP SHELL
   ============================================================ */
function bootApp() {
  applyTheme()
  const root = $('#app-root')
  root.innerHTML = `
    <main id="view"></main>
    <div class="overlay" id="overlay"></div>
    <div class="drawer" id="drawer"></div>
    <nav class="bottom-nav">
      ${navItem('dashboard', 'fa-chart-line', 'Dashboard')}
      ${navItem('invoice', 'fa-file-invoice-dollar', 'Invoice')}
      <div class="nav-center"><button class="nav-logo" id="menu-btn" aria-label="Open menu"></button></div>
      ${navItem('certificate', 'fa-award', 'Certificate')}
      ${navItem('report', 'fa-chart-pie', 'Reports')}
    </nav>`
  root.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => loadRoute(n.dataset.route)))
  $('#menu-btn').addEventListener('click', openDrawer)
  $('#overlay').addEventListener('click', closeDrawer)
  startSync()
  loadRoute('dashboard')
}

function navItem(route, icon, label) {
  return `<button class="nav-item ${State.route === route ? 'active' : ''}" data-route="${route}">
    <i class="fa-solid ${icon}"></i><span>${label}</span></button>`
}

function setActiveNav() {
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.route === State.route))
}

/* ---------------- Drawer ---------------- */
function openDrawer() {
  const items = [
    { r: 'create', i: 'fa-plus', c: '#6366f1', t: 'New Document', s: 'Invoice / Cert / Report' },
    { r: 'payments', i: 'fa-credit-card', c: '#22c55e', t: 'Payments', s: 'Transactions & receipts' },
    { r: 'team', i: 'fa-users', c: '#f59e0b', t: 'Team & Roles', s: 'Manage members' },
    { r: 'storage', i: 'fa-cloud', c: '#06b6d4', t: 'Cloud Storage', s: 'Files & PDFs' },
    { r: 'company', i: 'fa-building', c: '#8b5cf6', t: 'Company', s: 'Branding & branches' },
    { r: 'settings', i: 'fa-gear', c: '#ef4444', t: 'Settings', s: 'Theme, account, sessions' },
  ]
  const d = $('#drawer')
  d.innerHTML = `<div class="drawer-handle"></div><h3>Menu</h3>
    <div class="drawer-grid">${items.map((x) => `
      <button class="drawer-item" data-route="${x.r}">
        <div class="di-ico" style="background:linear-gradient(135deg,${x.c},${x.c}cc)"><i class="fa-solid ${x.i}"></i></div>
        <span>${x.t}</span><small>${x.s}</small>
      </button>`).join('')}</div>`
  d.querySelectorAll('.drawer-item').forEach((b) => b.addEventListener('click', () => { closeDrawer(); loadRoute(b.dataset.route) }))
  $('#overlay').classList.add('open'); d.classList.add('open')
}
function closeDrawer() { $('#overlay').classList.remove('open'); $('#drawer').classList.remove('open') }

/* ---------------- Router ---------------- */
async function loadRoute(route) {
  State.route = route; setActiveNav()
  const view = $('#view')
  view.innerHTML = `<div class="screen slide"><div class="card skeleton" style="height:120px"></div></div>`
  try {
    switch (route) {
      case 'dashboard': return await screenDashboard()
      case 'invoice': return await screenDocs('invoice')
      case 'certificate': return await screenDocs('certificate')
      case 'report': return await screenDocs('report')
      case 'create': return screenCreate()
      case 'payments': return await screenPayments()
      case 'team': return await screenTeam()
      case 'storage': return await screenStorage()
      case 'company': return await screenCompany()
      case 'settings': return screenSettings()
      default: return screenDashboard()
    }
  } catch (e) {
    view.innerHTML = `<div class="screen"><div class="empty"><i class="fa-solid fa-triangle-exclamation"></i><p>${esc(e.message || 'Failed to load')}</p></div></div>`
  }
}

function topbar(title, sub) {
  const company = State.companies.find((c) => c.company_id === State.activeCompany)
  return `<header class="topbar">
    <div><h1>${title}</h1>${sub ? `<div class="sub">${sub}</div>` : ''}</div>
    <div style="display:flex;gap:8px;align-items:center">
      <button class="company-pill" id="company-switch">
        <i class="fa-solid fa-building" style="color:var(--accent)"></i>${esc(company?.company_name || 'Company')}
        <i class="fa-solid fa-chevron-down" style="font-size:10px"></i></button>
      <button class="icon-btn" id="theme-btn"><i class="fa-solid ${State.theme === 'dark' ? 'fa-sun' : 'fa-moon'}"></i></button>
    </div>
  </header>`
}
function bindTopbar() {
  $('#theme-btn')?.addEventListener('click', () => { toggleTheme(); loadRoute(State.route) })
  $('#company-switch')?.addEventListener('click', companySwitcher)
}

function companySwitcher() {
  const m = modal(`<div class="drawer-handle"></div><h3>Switch Company</h3>
    <div style="margin-top:8px">${State.companies.map((c) => `
      <button class="list-row" data-cid="${c.company_id}" style="width:100%;text-align:left">
        <div class="lr-ico" style="background:${c.brand_color || '#6366f1'}"><i class="fa-solid fa-building"></i></div>
        <div class="lr-main"><b>${esc(c.company_name)}</b><small>Role: ${esc(c.role)}</small></div>
        ${c.company_id === State.activeCompany ? '<i class="fa-solid fa-circle-check" style="color:var(--ok)"></i>' : ''}
      </button>`).join('')}</div>
    <button class="btn block" id="new-co" style="margin-top:8px"><i class="fa-solid fa-plus"></i> New Company</button>`)
  m.querySelectorAll('[data-cid]').forEach((b) => b.addEventListener('click', async () => {
    const cid = b.dataset.cid
    try {
      const d = await api('/auth/switch-company', { method: 'POST', body: { company_id: cid } })
      State.access = d.access; State.activeCompany = d.active_company; State.activeRole = d.active_role; persist()
      closeModal(); toast('Switched company', 'ok'); restartSync(); loadRoute('dashboard')
    } catch (e) { toast(e.message, 'bad') }
  }))
  $('#new-co')?.addEventListener('click', () => {
    closeModal()
    const m2 = modal(`<div class="drawer-handle"></div><h3>New Company</h3>
      <div class="field"><label>Name</label><input class="input" id="co-name" placeholder="New Hospital Ltd"></div>
      <div class="field"><label>Type</label><select class="input" id="co-type">
        <option value="hospital">Hospital</option><option value="clinic">Clinic</option><option value="corporate">Corporate</option><option value="other">Other</option></select></div>
      <button class="btn primary block" id="co-save">Create</button>`)
    $('#co-save').addEventListener('click', async () => {
      try {
        await api('/companies', { method: 'POST', body: { name: $('#co-name').value, type: $('#co-type').value } })
        const me = await api('/auth/me'); State.companies = me.companies; persist()
        closeModal(); toast('Company created', 'ok'); companySwitcher()
      } catch (e) { toast(e.message, 'bad') }
    })
  })
}

/* ============================================================
   DASHBOARD
   ============================================================ */
async function screenDashboard() {
  let d
  try { d = await api('/dashboard'); State.dashboard = d; IDB.setCache('dashboard', d) }
  catch (e) { d = await IDB.getCache('dashboard'); if (!d) throw e; toast('Showing cached data (offline)', 'info') }
  try { State.company = (await api('/companies/current')).company } catch {}

  const c = d.counts
  const view = $('#view')
  const first = esc(State.user?.name?.split(' ')[0] || 'there')
  const collected = c.collected || 0
  const due = c.due || 0
  const totalRev = collected + due
  const collRate = totalRev > 0 ? Math.round((collected / totalRev) * 100) : 0

  view.innerHTML = `<div class="screen dash">
    ${dashHeader()}
    <section class="dash-welcome">
      <div>
        <h1 class="dw-title">Welcome back, ${first}!</h1>
        <p class="dw-sub">Here's what's happening with your business.</p>
      </div>
      <button class="period-pill ripple" id="period-pill"><i class="fa-regular fa-calendar"></i> This Month <i class="fa-solid fa-chevron-down" style="font-size:9px;opacity:.7"></i></button>
    </section>

    <section class="stat-grid">
      ${statCard('fa-sack-dollar', 'green', money(c.revenue), 'Revenue (paid)', 12.5, 2.5, true)}
      ${statCard('fa-hourglass-half', 'amber', money(due), 'Outstanding Due', 8.3, 2.5, true)}
      ${statCard('fa-file-lines', 'blue', c.txns, 'Transactions', 5.7, 2.3, true)}
      ${statCard('fa-file-invoice', 'violet', c.invoices, 'Invoices', 11.1, -11.1, true)}
    </section>

    <section class="wide-grid">
      ${wideCard('fa-award', 'violet', c.certificates, 'Certificates', 15.4, 1.5, 'fa-certificate')}
      ${wideCard('fa-chart-pie', 'ember', c.reports, 'Reports', 3.2, 2.5, 'fa-chart-simple')}
    </section>

    <section class="chart-grid">
      <article class="card panel" id="sales-panel">
        <header class="panel-head">
          <h3>Sales Charts</h3>
          <div class="legend"><span class="lg"><i class="dot" style="background:var(--accent3)"></i>Service sales</span><span class="lg"><i class="dot" style="background:var(--accent2)"></i>Product sales</span></div>
        </header>
        <div class="chart-wrap"><canvas id="sales-chart" height="170"></canvas></div>
      </article>
      <article class="card panel" id="insights-panel">
        <header class="panel-head"><h3>Revenue Insights</h3></header>
        <div class="gauge-wrap">
          <div class="gauge" id="gauge" style="--p:${collRate}">
            <div class="gauge-center"><b>${collRate}%</b><small>Collection Rate</small></div>
          </div>
        </div>
        <div class="ins-bars">
          <div class="ins-row"><span class="ins-lbl"><i class="dot" style="background:var(--ok)"></i>Paid</span><div class="ins-track"><div class="ins-fill" style="--w:${totalRev?Math.round(collected/totalRev*100):0}%;background:var(--ok)"></div></div><b>${money(collected)}</b></div>
          <div class="ins-row"><span class="ins-lbl"><i class="dot" style="background:var(--accent2)"></i>Unpaid</span><div class="ins-track"><div class="ins-fill" style="--w:${totalRev?Math.round(due/totalRev*100):0}%;background:var(--accent2)"></div></div><b>${money(due)}</b></div>
        </div>
        <div class="ins-summary">
          <div><small>Total Revenue</small><b>${money(totalRev)}</b></div>
          <div><small>Projected (Q3)</small><b>${money(Math.round(totalRev * 1.28))}</b></div>
        </div>
      </article>
    </section>

    <section class="card panel activities">
      <header class="panel-head"><h3>Recent Activities</h3><a class="view-all" id="view-all">View all <i class="fa-solid fa-arrow-right"></i></a></header>
      <div id="recent">${(d.recent || []).length ? d.recent.map(actRow).join('') : emptyBlock('No activity yet')}</div>
    </section>
  </div>`

  bindDashHeader(); bindRipples(view)
  $('#period-pill')?.addEventListener('click', () => toast('Period filter coming soon', 'info', 'fa-calendar'))
  $('#view-all')?.addEventListener('click', () => loadRoute('invoice'))
  view.querySelectorAll('[data-doc]').forEach((r) => r.addEventListener('click', () => openDoc(r.dataset.doc)))
  // staggered reveal + animations
  view.querySelectorAll('.stat-card,.wide-card,.panel').forEach((el, i) => { el.style.animationDelay = (i * 70) + 'ms'; el.classList.add('reveal') })
  animateCounters(view)
  setTimeout(() => view.querySelectorAll('.ins-fill').forEach((f) => f.style.width = f.style.getPropertyValue('--w')), 300)
  setTimeout(() => { const g = $('#gauge'); if (g) g.classList.add('go') }, 200)
  drawSparklines(d.series || [])
  drawSalesChart(d.series || [])
}

/* ---- Dashboard ornate header (logo, search, theme, bell, avatar) ---- */
function dashHeader() {
  const initials = (State.user?.name || 'U').split(' ').map((s) => s[0]).slice(0, 2).join('').toUpperCase()
  const dark = State.theme === 'dark'
  return `<header class="dash-header">
    <div class="brand">
      <div class="brand-emblem"></div>
      <span class="brand-word">INVOKER</span>
    </div>
    <div class="search-bar"><i class="fa-solid fa-magnifying-glass"></i><input id="dash-search" placeholder="Search records, clients, invoices..." /></div>
    <div class="header-actions">
      <button class="theme-pills ${dark ? 'dark' : 'light'}" id="theme-pills" aria-label="Toggle theme">
        <span class="tp sun"><i class="fa-solid fa-sun"></i></span>
        <span class="tp moon"><i class="fa-solid fa-moon"></i></span>
      </button>
      <button class="bell-btn ripple" id="bell-btn"><i class="fa-regular fa-bell"></i><span class="bell-badge">3</span></button>
      <button class="avatar-btn" id="avatar-btn"><span class="av">${initials}</span><span class="online"></span></button>
    </div>
  </header>`
}
function bindDashHeader() {
  $('#theme-pills')?.addEventListener('click', () => { toggleTheme(); loadRoute(State.route) })
  $('#bell-btn')?.addEventListener('click', () => toast('No new notifications', 'info', 'fa-bell'))
  $('#avatar-btn')?.addEventListener('click', () => loadRoute('settings'))
  $('#dash-search')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { loadRoute('invoice') } })
}

function trendHtml(pct, target) {
  const up = pct >= 0
  const tcls = target >= 0 ? 'pos' : 'neg'
  return `<div class="trend ${up ? 'up' : 'down'}">
    <span class="tpct"><i class="fa-solid fa-arrow-${up ? 'up' : 'down'}"></i> ${Math.abs(pct)}%</span>
    <span class="ttar">vs. target: <b class="${tcls}">${target >= 0 ? '+' : ''}${target}%</b></span>
  </div>`
}

function statCard(icon, tone, val, lbl, pct, target, spark) {
  const isNum = typeof val === 'number'
  return `<article class="card stat-card tone-${tone} hover">
    <div class="sc-top">
      <div class="sc-ico"><i class="fa-solid ${icon}"></i></div>
      <i class="fa-solid ${icon} sc-watermark"></i>
    </div>
    <div class="sc-lbl">${lbl}</div>
    <div class="sc-val" ${isNum ? `data-count="${val}"` : ''}>${val}</div>
    ${trendHtml(pct, target)}
    ${spark ? `<div class="sc-spark"><canvas class="spark" height="40"></canvas></div>` : ''}
  </article>`
}

function wideCard(icon, tone, val, lbl, pct, target, wm) {
  const w = Math.min(100, Math.max(8, (val || 0) * 1.4 + 30))
  return `<article class="card wide-card tone-${tone} hover">
    <i class="fa-solid ${wm} wc-watermark"></i>
    <div class="wc-ico"><i class="fa-solid ${icon}"></i></div>
    <div class="wc-body">
      <div class="wc-lbl">${lbl}</div>
      <div class="wc-val" data-count="${val}">${val}</div>
      ${trendHtml(pct, target)}
      <div class="wc-track"><div class="wc-fill" style="width:${w}%"></div></div>
    </div>
  </article>`
}

function actRow(x) {
  const map = {
    invoice: { ic: 'fa-file-invoice', col: 'blue', badge: 'paid', word: 'Paid' },
    certificate: { ic: 'fa-award', col: 'violet', badge: 'issued', word: 'Issued' },
    report: { ic: 'fa-chart-pie', col: 'ember', badge: 'verified', word: 'Done' },
  }
  const m = map[x.type] || map.invoice
  const badge = x.status || m.badge
  const sub = x.client_name || x.title || ''
  return `<div class="act-row" data-doc="${x.id}">
    <div class="act-ico tone-${m.col}"><i class="fa-solid ${m.ic}"></i></div>
    <div class="act-main"><b>${esc(x.number || x.title || 'Document')}</b><small>${esc(sub)}</small></div>
    <div class="act-end"><span class="badge ${badge}">${esc(cap(badge))}</span><small class="act-time">${timeAgo(x.created_at)}</small></div>
    <i class="fa-solid fa-chevron-right act-arrow"></i>
  </div>`
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s }
function timeAgo(ts) {
  if (!ts) return ''
  const diff = Date.now() - new Date(ts.replace(' ', 'T') + 'Z').getTime()
  const h = Math.floor(diff / 3600000), dys = Math.floor(h / 24)
  if (dys > 0) return dys + 'd ago'
  if (h > 0) return h + 'h ago'
  const m = Math.floor(diff / 60000); return (m > 0 ? m + 'm' : 'just now') + (m > 0 ? ' ago' : '')
}
function animateCounters(root) {
  root.querySelectorAll('.val[data-count],.sc-val[data-count],.wc-val[data-count]').forEach((node) => {
    const target = parseFloat(node.dataset.count); if (!target) return
    let cur = 0; const step = target / 32
    const t = setInterval(() => { cur += step; if (cur >= target) { cur = target; clearInterval(t) } node.textContent = Math.round(cur).toLocaleString() }, 16)
  })
}
function recentRow(x) {
  const ic = x.type === 'invoice' ? 'fa-file-invoice-dollar' : x.type === 'certificate' ? 'fa-award' : 'fa-chart-pie'
  const col = x.type === 'invoice' ? '#6366f1' : x.type === 'certificate' ? '#8b5cf6' : '#ef4444'
  return `<div class="list-row" data-doc="${x.id}">
    <div class="lr-ico" style="background:${col}"><i class="fa-solid ${ic}"></i></div>
    <div class="lr-main"><b>${esc(x.number || x.title)}</b><small>${esc(x.client_name || x.title || '')}</small></div>
    <div style="text-align:right"><div style="font-weight:700;font-size:13px">${x.total ? money(x.total) : ''}</div>
    <span class="badge ${x.status}">${x.status}</span></div></div>`
}
function emptyBlock(t) { return `<div class="empty"><i class="fa-solid fa-inbox"></i><p>${t}</p></div>` }

/* Mini sparklines inside the 4 stat cards */
function drawSparklines(series) {
  if (!window.Chart) return
  const tones = ['#22c55e', '#f59e0b', '#4d8dff', '#8b5cf6']
  const base = (series && series.length ? series.map((s) => s.amt) : [4, 7, 5, 9, 6, 11, 8])
  document.querySelectorAll('.sc-spark canvas.spark').forEach((cv, i) => {
    const col = tones[i % tones.length]
    // jitter the base series per-card so each looks distinct
    const data = base.map((v, k) => Math.max(1, v * (0.6 + (i * 0.13) + Math.sin(k + i) * 0.18) + (i + 1) * 2))
    const ctx = cv.getContext('2d')
    const g = ctx.createLinearGradient(0, 0, 0, 40)
    g.addColorStop(0, col + '66'); g.addColorStop(1, col + '00')
    new Chart(cv, {
      type: 'line',
      data: { labels: data.map(() => ''), datasets: [{ data, fill: true, backgroundColor: g, borderColor: col, borderWidth: 2, tension: .45, pointRadius: 0 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false } }, animation: { duration: 1100, easing: 'easeOutQuart' }, elements: { line: { capBezierPoints: true } } },
    })
  })
}

/* Dual-layer Sales area chart */
let salesChart
function drawSalesChart(series) {
  const ctx = $('#sales-chart'); if (!ctx || !window.Chart) return
  const dark = State.theme === 'dark'
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']
  // derive two layered datasets from real series if available, else pleasant demo curve
  const amts = (series && series.length >= 3) ? series.map((s) => s.amt) : null
  const service = amts ? months.map((_, i) => (amts[i % amts.length] || 0) * 1.0 + 60 + i * 12) : [70, 90, 130, 210, 160, 200]
  const product = amts ? months.map((_, i) => (amts[i % amts.length] || 0) * 0.6 + 30 + i * 8) : [40, 60, 120, 150, 110, 170]
  const gA = ctx.getContext('2d').createLinearGradient(0, 0, 0, 170)
  gA.addColorStop(0, 'rgba(0,210,255,.42)'); gA.addColorStop(1, 'rgba(0,210,255,0)')
  const gB = ctx.getContext('2d').createLinearGradient(0, 0, 0, 170)
  gB.addColorStop(0, 'rgba(139,92,246,.45)'); gB.addColorStop(1, 'rgba(139,92,246,0)')
  if (salesChart) salesChart.destroy()
  salesChart = new Chart(ctx, {
    type: 'line',
    data: { labels: months, datasets: [
      { label: 'Service sales', data: service, fill: true, backgroundColor: gA, borderColor: '#00d2ff', borderWidth: 2.5, tension: .45, pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: '#00d2ff' },
      { label: 'Product sales', data: product, fill: true, backgroundColor: gB, borderColor: '#8b5cf6', borderWidth: 2.5, tension: .45, pointRadius: 0, pointHoverRadius: 5, pointBackgroundColor: '#8b5cf6' },
    ] },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } },
      animation: { duration: 1100, easing: 'easeOutQuart' },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { grid: { display: false }, ticks: { color: dark ? '#9aa4c4' : '#9b9384', font: { size: 11 } } },
        y: { beginAtZero: true, suggestedMax: 250, grid: { color: dark ? 'rgba(255,255,255,.06)' : 'rgba(120,100,70,.1)' }, ticks: { color: dark ? '#9aa4c4' : '#9b9384', stepSize: 50, font: { size: 10 } } },
      },
    },
  })
}

/* ============================================================
   DOCUMENT LISTS
   ============================================================ */
const DOC_META = {
  invoice: { t: 'Invoices', ic: 'fa-file-invoice-dollar', col: '#6366f1' },
  certificate: { t: 'Certificates', ic: 'fa-award', col: '#8b5cf6' },
  report: { t: 'Reports', ic: 'fa-chart-pie', col: '#ef4444' },
}
async function screenDocs(type) {
  const meta = DOC_META[type]
  let list = []
  try { list = (await api('/documents?type=' + type)).documents; IDB.setCache('docs_' + type, list) }
  catch (e) { list = await IDB.getCache('docs_' + type) || []; toast('Offline — cached list', 'info') }
  const view = $('#view')
  view.innerHTML = `<div class="screen">
    ${topbar(meta.t)}
    <div class="field"><input class="input" id="doc-search" placeholder="Search ${meta.t.toLowerCase()}..."></div>
    <div id="doc-list">${list.length ? list.map((x) => recentRow(x)).join('') : emptyBlock('No ' + meta.t.toLowerCase() + ' yet')}</div>
    <button class="btn primary block" id="new-doc" style="margin-top:16px"><i class="fa-solid fa-plus"></i> New ${type}</button>
  </div>`
  bindTopbar(); bindRipples(view)
  $('#new-doc').addEventListener('click', () => screenCreate(type))
  view.querySelectorAll('[data-doc]').forEach((r) => r.addEventListener('click', () => openDoc(r.dataset.doc)))
  $('#doc-search').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase()
    const f = list.filter((x) => (x.number + x.title + (x.client_name || '')).toLowerCase().includes(q))
    $('#doc-list').innerHTML = f.length ? f.map((x) => recentRow(x)).join('') : emptyBlock('No matches')
    $('#doc-list').querySelectorAll('[data-doc]').forEach((r) => r.addEventListener('click', () => openDoc(r.dataset.doc)))
  })
}

/* ============================================================
   CREATE / EDIT DOCUMENT
   ============================================================ */
function screenCreate(presetType = 'invoice', existing = null) {
  const view = $('#view')
  const data = existing?.data || { items: [{ name: '', qty: 1, price: 0 }], discount: 0, body: '', recipient: '', purpose: '' }
  let type = existing?.type || presetType
  let template = existing?.template || 'classic'
  let items = JSON.parse(JSON.stringify(data.items || [{ name: '', qty: 1, price: 0 }]))

  view.innerHTML = `<div class="screen slide">
    ${topbar(existing ? 'Edit Document' : 'Create Document')}
    <div class="card">
      <div class="field"><label>Document Type</label>
        <div class="pay-methods" id="type-pick">
          ${['invoice', 'certificate', 'report'].map((t) => `<div class="pay-method ${t === type ? 'sel' : ''}" data-type="${t}" style="grid-column:span 1">
            <i class="fa-solid ${DOC_META[t].ic}" style="color:${DOC_META[t].col}"></i><b style="font-size:12px;text-transform:capitalize">${t}</b></div>`).join('')}
        </div>
      </div>
      <div class="field"><label>Template Style</label>
        <div class="tpl-pick" id="tpl-pick">
          ${['classic', 'modern', 'elegant'].map((tp) => `<div class="tpl ${tp} ${tp === template ? 'sel' : ''}" data-tpl="${tp}"><div class="tpl-thumb"></div><small style="text-transform:capitalize">${tp}</small></div>`).join('')}
        </div>
      </div>
      <div class="field"><label>Title</label><input class="input" id="f-title" value="${esc(existing?.title || '')}" placeholder="e.g. Surgery Bill"></div>
      <div class="row">
        <div class="field"><label id="lbl-client">Client / Patient</label><input class="input" id="f-client" value="${esc(existing?.client_name || '')}"></div>
        <div class="field"><label>Email</label><input class="input" id="f-email" type="email" value="${esc(existing?.client_email || '')}"></div>
      </div>
      <div id="dyn-fields"></div>
    </div>
    <div id="preview-wrap"></div>
    <div class="row" style="margin-top:16px">
      <button class="btn" id="save-draft"><i class="fa-regular fa-floppy-disk"></i> Save Draft</button>
      <button class="btn primary" id="generate-btn"><span class="label"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</span><span class="spinner"></span></button>
    </div>
  </div>`
  bindTopbar(); bindRipples(view)

  const renderDyn = () => {
    const dyn = $('#dyn-fields')
    $('#lbl-client').textContent = type === 'certificate' ? 'Recipient Name' : 'Client / Patient'
    if (type === 'invoice') {
      dyn.innerHTML = `<label style="font-size:12.5px;font-weight:600;color:var(--text-dim)">Line Items</label>
        <div id="items"></div>
        <button class="btn sm ghost" id="add-item"><i class="fa-solid fa-plus"></i> Add item</button>
        <div class="row" style="margin-top:12px">
          <div class="field"><label>Discount (${curr()})</label><input class="input" id="f-discount" type="number" value="${data.discount || 0}"></div>
        </div>`
      renderItems()
      $('#add-item').addEventListener('click', () => { items.push({ name: '', qty: 1, price: 0 }); renderItems(); updatePreview() })
    } else if (type === 'certificate') {
      dyn.innerHTML = `<div class="field"><label>Purpose / Award</label><input class="input" id="f-purpose" value="${esc(data.purpose || '')}" placeholder="Certificate of Achievement"></div>
        <div class="field"><label>Body Text</label><textarea class="input" id="f-body" placeholder="This certifies that...">${esc(data.body || '')}</textarea></div>
        <div class="field"><label>Signatory</label><input class="input" id="f-sign" value="${esc(data.signatory || '')}" placeholder="Dr. John Smith, Director"></div>`
    } else {
      dyn.innerHTML = `<div class="field"><label>Report Summary</label><textarea class="input" id="f-body" placeholder="Executive summary...">${esc(data.body || '')}</textarea></div>
        <div class="field"><label>Period</label><input class="input" id="f-period" value="${esc(data.period || '')}" placeholder="Jan 2026 - Mar 2026"></div>`
    }
    bindFieldEvents()
  }
  const renderItems = () => {
    const wrap = $('#items'); if (!wrap) return
    wrap.innerHTML = items.map((it, i) => `<div class="row" style="margin-bottom:8px" data-i="${i}">
      <input class="input it-name" placeholder="Service" value="${esc(it.name)}" style="flex:2">
      <input class="input it-qty" type="number" placeholder="Qty" value="${it.qty}" style="flex:.6">
      <input class="input it-price" type="number" placeholder="Price" value="${it.price}" style="flex:1">
      <button class="btn sm" data-del="${i}" style="flex:0 0 auto"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('')
    wrap.querySelectorAll('[data-i]').forEach((row) => {
      const i = +row.dataset.i
      row.querySelector('.it-name').addEventListener('input', (e) => { items[i].name = e.target.value; updatePreview() })
      row.querySelector('.it-qty').addEventListener('input', (e) => { items[i].qty = +e.target.value; updatePreview() })
      row.querySelector('.it-price').addEventListener('input', (e) => { items[i].price = +e.target.value; updatePreview() })
      row.querySelector('[data-del]').addEventListener('click', () => { items.splice(i, 1); if (!items.length) items.push({ name: '', qty: 1, price: 0 }); renderItems(); updatePreview() })
    })
    bindRipples(wrap)
  }
  const collect = () => {
    const d = { items, discount: +($('#f-discount')?.value || 0) }
    if ($('#f-body')) d.body = $('#f-body').value
    if ($('#f-purpose')) d.purpose = $('#f-purpose').value
    if ($('#f-sign')) d.signatory = $('#f-sign').value
    if ($('#f-period')) d.period = $('#f-period').value
    return d
  }
  const totals = () => {
    const sub = items.reduce((s, it) => s + (it.qty || 0) * (it.price || 0), 0)
    const disc = +($('#f-discount')?.value || 0)
    const rate = State.company?.tax_rate || 0
    const tax = Math.max(0, sub - disc) * rate / 100
    return { sub, disc, tax, total: Math.max(0, sub - disc + tax) }
  }
  const updatePreview = () => {
    const t = totals()
    $('#preview-wrap').innerHTML = renderPreview(type, template, {
      title: $('#f-title')?.value, client: $('#f-client')?.value, items, ...collect(), totals: t,
    })
  }
  function bindFieldEvents() {
    ['f-title', 'f-client', 'f-discount', 'f-body', 'f-purpose', 'f-period'].forEach((id) => $('#' + id)?.addEventListener('input', updatePreview))
  }

  $('#type-pick').querySelectorAll('[data-type]').forEach((b) => b.addEventListener('click', () => {
    type = b.dataset.type; $('#type-pick').querySelectorAll('.pay-method').forEach((x) => x.classList.toggle('sel', x === b)); renderDyn(); updatePreview()
  }))
  $('#tpl-pick').querySelectorAll('[data-tpl]').forEach((b) => b.addEventListener('click', () => {
    template = b.dataset.tpl; $('#tpl-pick').querySelectorAll('.tpl').forEach((x) => x.classList.toggle('sel', x === b)); updatePreview()
  }))

  const save = async (genStatus) => {
    const body = {
      type, template, title: $('#f-title').value || (type + ' document'),
      client_name: $('#f-client').value, client_email: $('#f-email').value,
      data: collect(), status: genStatus || 'draft',
    }
    if (existing) {
      await apiOrQueue('/documents/' + existing.id, 'PUT', body)
    } else {
      await apiOrQueue('/documents', 'POST', body)
    }
  }
  $('#save-draft').addEventListener('click', async () => {
    try { await save('draft'); toast('Draft saved', 'ok'); loadRoute(type) } catch (e) { toast(e.message || 'Saved offline', 'info') }
  })
  $('#generate-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.classList.add('morph')
    try {
      await save('issued')
      await new Promise((r) => setTimeout(r, 700))
      btn.classList.remove('morph'); confetti(); toast('Document generated!', 'ok', 'fa-wand-magic-sparkles')
      // generate PDF client-side
      const t = totals()
      generatePDF(type, template, { title: $('#f-title').value, client: $('#f-client').value, email: $('#f-email').value, items, ...collect(), totals: t })
      setTimeout(() => loadRoute(type), 900)
    } catch (err) { btn.classList.remove('morph'); toast(err.message || 'Saved offline; will sync', 'info') }
  })

  renderDyn(); updatePreview()
}

async function apiOrQueue(path, method, body) {
  if (!State.online) { await IDB.enqueue({ path, method, body }); toast('Saved offline — will sync', 'info'); return { queued: true } }
  try { return await api(path, { method, body }) }
  catch (e) { if (e.offline) { await IDB.enqueue({ path, method, body }); return { queued: true } } throw e }
}

function renderPreview(type, template, d) {
  const elegant = template === 'elegant'
  const accentBar = elegant ? '#d4af37' : '#6366f1'
  const company = State.company || {}
  if (type === 'invoice') {
    return `<div class="section-title"><i class="fa-solid fa-eye" style="color:var(--accent)"></i> Live Preview</div>
    <div class="doc-paper" style="${elegant ? 'background:#fbf8f0' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${accentBar};padding-bottom:10px">
        <div><h2 style="margin:0">${esc(company.name || 'Your Company')}</h2><small style="color:#6b7494">${esc(company.address || '')}</small></div>
        <div style="text-align:right"><div style="font-size:20px;font-weight:800;color:${accentBar}">INVOICE</div></div>
      </div>
      <div style="margin-top:10px;font-size:12px"><b>Bill To:</b> ${esc(d.client || '—')}</div>
      <table class="doc-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th style="text-align:right">Amount</th></tr></thead>
      <tbody>${(d.items || []).map((it) => `<tr><td>${esc(it.name || '—')}</td><td>${it.qty}</td><td>${fmt(it.price)}</td><td style="text-align:right">${fmt((it.qty || 0) * (it.price || 0))}</td></tr>`).join('')}</tbody></table>
      <div style="margin-top:12px;text-align:right;font-size:13px">
        <div>Subtotal: ${money(d.totals.sub)}</div>
        ${d.totals.disc ? `<div>Discount: -${money(d.totals.disc)}</div>` : ''}
        <div>Tax: ${money(d.totals.tax)}</div>
        <div style="font-size:17px;font-weight:800;color:${accentBar};margin-top:4px">Total: ${money(d.totals.total)}</div>
      </div>
    </div>`
  }
  if (type === 'certificate') {
    return `<div class="section-title"><i class="fa-solid fa-eye" style="color:var(--accent)"></i> Live Preview</div>
    <div class="doc-paper" style="text-align:center;border:6px double ${accentBar};${elegant ? 'background:#fbf8f0' : ''}">
      <div style="font-size:11px;letter-spacing:.3em;color:${accentBar};font-weight:700">${esc((company.name || 'COMPANY').toUpperCase())}</div>
      <h2 style="font-family:serif;margin:14px 0 6px;color:${accentBar}">${esc(d.purpose || 'Certificate of Achievement')}</h2>
      <div style="font-size:12px;color:#6b7494">This is proudly presented to</div>
      <div style="font-family:serif;font-size:24px;font-weight:800;margin:6px 0">${esc(d.client || 'Recipient Name')}</div>
      <p style="font-size:12px;color:#444;max-width:80%;margin:8px auto">${esc(d.body || '')}</p>
      <div style="margin-top:18px;font-size:12px"><b>${esc(d.signatory || 'Authorized Signatory')}</b><div style="border-top:1px solid #888;width:140px;margin:4px auto 0"></div></div>
    </div>`
  }
  return `<div class="section-title"><i class="fa-solid fa-eye" style="color:var(--accent)"></i> Live Preview</div>
    <div class="doc-paper">
      <div style="border-bottom:3px solid ${accentBar};padding-bottom:8px"><h2 style="margin:0">${esc(d.title || 'Report')}</h2>
      <small style="color:#6b7494">${esc(company.name || '')} · ${esc(d.period || '')}</small></div>
      <p style="font-size:12.5px;line-height:1.6;margin-top:12px">${esc(d.body || 'Report summary...')}</p>
    </div>`
}

/* ---------------- PDF generation (client-side, offline-capable) ---------------- */
async function generatePDF(type, template, d) {
  if (!window.jspdf) { toast('PDF library loading...', 'info'); return }
  const { jsPDF } = window.jspdf
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const company = State.company || {}
  const accent = template === 'elegant' ? [212, 175, 55] : [99, 102, 241]
  let qrUrl = ''
  try { qrUrl = await QRCode.toDataURL((d.title || type) + '|' + Date.now(), { width: 120, margin: 0 }) } catch {}

  doc.setFillColor(...accent); doc.rect(0, 0, 210, 4, 'F')
  doc.setFontSize(20); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 35, 51)
  doc.text(company.name || 'Your Company', 14, 22)
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(110, 116, 148)
  doc.text(company.address || '', 14, 28)

  doc.setFontSize(24); doc.setTextColor(...accent); doc.setFont('helvetica', 'bold')
  doc.text(type.toUpperCase(), 196, 22, { align: 'right' })
  if (qrUrl) doc.addImage(qrUrl, 'PNG', 176, 26, 20, 20)

  let y = 50
  doc.setTextColor(30, 35, 51); doc.setFontSize(11)
  doc.text(type === 'certificate' ? 'Recipient: ' + (d.client || '') : 'Client: ' + (d.client || ''), 14, y)
  y += 8

  if (type === 'invoice') {
    doc.setFillColor(...accent); doc.rect(14, y, 182, 8, 'F')
    doc.setTextColor(255, 255, 255); doc.setFontSize(9)
    doc.text('ITEM', 16, y + 5.5); doc.text('QTY', 120, y + 5.5); doc.text('PRICE', 145, y + 5.5); doc.text('AMOUNT', 192, y + 5.5, { align: 'right' })
    y += 12; doc.setTextColor(40, 40, 40)
      ; (d.items || []).forEach((it) => {
        doc.text(String(it.name || '-').slice(0, 50), 16, y)
        doc.text(String(it.qty), 120, y); doc.text(fmt(it.price), 145, y)
        doc.text(fmt((it.qty || 0) * (it.price || 0)), 192, y, { align: 'right' }); y += 7
      })
    y += 4; doc.setDrawColor(220); doc.line(120, y, 196, y); y += 6
    doc.text('Subtotal: ' + money(d.totals.sub), 192, y, { align: 'right' }); y += 6
    if (d.totals.disc) { doc.text('Discount: -' + money(d.totals.disc), 192, y, { align: 'right' }); y += 6 }
    doc.text('Tax: ' + money(d.totals.tax), 192, y, { align: 'right' }); y += 8
    doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(...accent)
    doc.text('TOTAL: ' + money(d.totals.total), 192, y, { align: 'right' })
  } else if (type === 'certificate') {
    doc.setFontSize(28); doc.setFont('times', 'bold'); doc.setTextColor(...accent)
    doc.text(d.purpose || 'Certificate of Achievement', 105, y + 10, { align: 'center' })
    doc.setFontSize(11); doc.setTextColor(100); doc.setFont('helvetica', 'normal')
    doc.text('This is proudly presented to', 105, y + 22, { align: 'center' })
    doc.setFontSize(22); doc.setFont('times', 'bold'); doc.setTextColor(30, 35, 51)
    doc.text(d.client || 'Recipient', 105, y + 34, { align: 'center' })
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(60)
    doc.text(doc.splitTextToSize(d.body || '', 150), 105, y + 46, { align: 'center' })
    doc.text(d.signatory || 'Authorized Signatory', 105, y + 90, { align: 'center' })
    doc.line(75, y + 86, 135, y + 86)
  } else {
    doc.setFontSize(12); doc.setTextColor(60)
    doc.text(doc.splitTextToSize(d.body || 'Report summary', 180), 14, y)
  }
  doc.setFontSize(8); doc.setTextColor(150)
  doc.text('Generated by Invoker · ' + new Date().toLocaleString(), 14, 288)
  doc.save((d.title || type) + '.pdf')
  toast('PDF downloaded', 'ok', 'fa-file-pdf')
}

/* ---------------- Open doc detail ---------------- */
async function openDoc(id) {
  let doc
  try { doc = (await api('/documents/' + id)).document } catch (e) { toast(e.message, 'bad'); return }
  const canDelete = roleAtLeast('manager')
  const t = { sub: doc.subtotal, disc: doc.discount, tax: doc.tax, total: doc.total }
  const m = modal(`<div class="drawer-handle"></div>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h3>${esc(doc.number || doc.title)}</h3><span class="badge ${doc.status}">${doc.status}</span></div>
    <p style="color:var(--text-dim);font-size:13px;margin:2px 0 14px">${esc(doc.title)} · ${esc(doc.client_name || '')}</p>
    ${doc.type === 'invoice' ? `<div class="card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between"><span>Total</span><b>${money(doc.total)}</b></div></div>` : ''}
    <div class="grid cols-2">
      <button class="btn" id="d-edit"><i class="fa-solid fa-pen"></i> Edit</button>
      <button class="btn" id="d-pdf"><i class="fa-solid fa-file-pdf"></i> PDF</button>
      ${doc.type === 'invoice' ? `<button class="btn success" id="d-pay"><i class="fa-solid fa-credit-card"></i> Pay</button>` : ''}
      <button class="btn" id="d-email"><i class="fa-solid fa-envelope"></i> Email</button>
      ${canDelete ? `<button class="btn" id="d-del" style="grid-column:span 2;color:var(--bad)"><i class="fa-solid fa-trash"></i> Delete</button>` : ''}
    </div>`)
  $('#d-edit').addEventListener('click', () => { closeModal(); screenCreate(doc.type, doc) })
  $('#d-pdf').addEventListener('click', () => generatePDF(doc.type, doc.template, { title: doc.title, client: doc.client_name, email: doc.client_email, items: doc.data.items || [], ...doc.data, totals: t }))
  $('#d-pay')?.addEventListener('click', () => { closeModal(); payModal(doc) })
  $('#d-email').addEventListener('click', () => { closeModal(); emailModal(doc) })
  $('#d-del')?.addEventListener('click', async () => {
    try { await api('/documents/' + id, { method: 'DELETE' }); closeModal(); toast('Deleted', 'ok'); loadRoute(State.route) }
    catch (e) { toast(e.message, 'bad') }
  })
}

/* ============================================================
   PAYMENTS
   ============================================================ */
async function screenPayments() {
  let pays = [], stats = {}
  try { const d = await api('/payments'); pays = d.payments; stats = await api('/payments/stats') } catch (e) { toast(e.message, 'bad') }
  const view = $('#view')
  view.innerHTML = `<div class="screen">
    ${topbar('Payments', 'Transactions & receipts')}
    <div class="grid cols-2">
      ${statCard('fa-money-bill-trend-up', '#22c55e', money(stats.total_collected || 0), 'Total collected')}
      ${statCard('fa-receipt', '#6366f1', stats.txn_count || 0, 'Transactions')}
    </div>
    <button class="btn primary block" id="new-pay" style="margin:14px 0"><i class="fa-solid fa-plus"></i> Record Payment</button>
    <div class="section-title"><i class="fa-solid fa-list" style="color:var(--accent)"></i> History</div>
    <div>${pays.length ? pays.map(payRow).join('') : emptyBlock('No payments yet')}</div>
  </div>`
  bindTopbar(); bindRipples(view)
  view.querySelectorAll('.stat').forEach((s, i) => setTimeout(() => s.classList.add('shimmer'), i * 90))
  animateCounters(view)
  $('#new-pay').addEventListener('click', () => payModal(null))
}
function payRow(p) {
  const icons = { cash: 'fa-money-bill', bkash: 'fa-mobile-screen', nagad: 'fa-wallet', card: 'fa-credit-card' }
  const cols = { cash: '#22c55e', bkash: '#e2136e', nagad: '#f60', card: '#6366f1' }
  return `<div class="list-row">
    <div class="lr-ico" style="background:${cols[p.method]}"><i class="fa-solid ${icons[p.method]}"></i></div>
    <div class="lr-main"><b>${money(p.amount)}</b><small>${esc(p.method)} · ${esc(p.doc_number || 'direct')}</small></div>
    <span class="badge paid">${esc(p.status)}</span></div>`
}
function payModal(doc) {
  let method = 'cash'
  const amt = doc?.total || 0
  const m = modal(`<div class="drawer-handle"></div><h3>${doc ? 'Pay ' + esc(doc.number) : 'Record Payment'}</h3>
    <div class="pay-methods" id="pm">
      ${[['cash', 'fa-money-bill', '#22c55e', 'Cash'], ['bkash', 'fa-mobile-screen', '#e2136e', 'bKash'], ['nagad', 'fa-wallet', '#f60', 'Nagad'], ['card', 'fa-credit-card', '#6366f1', 'Card']].map(([k, i, c, l]) =>
    `<div class="pay-method ${k === 'cash' ? 'sel' : ''}" data-m="${k}"><i class="fa-solid ${i}" style="color:${c}"></i><b style="font-size:13px">${l}</b></div>`).join('')}
    </div>
    <div class="field"><label>Amount (${curr()})</label><input class="input" id="pay-amt" type="number" value="${amt}"></div>
    <div id="cash-extra" class="field"><label>Cash Tendered</label><input class="input" id="pay-tendered" type="number" placeholder="0">
      <div id="change-due" style="margin-top:6px;font-size:13px;color:var(--ok);font-weight:700"></div></div>
    <div class="field" id="ref-extra" style="display:none"><label>Transaction Reference</label><input class="input" id="pay-ref" placeholder="TXN ID"></div>
    <button class="btn primary block" id="pay-go"><span class="label"><i class="fa-solid fa-check"></i> Confirm Payment</span><span class="spinner"></span></button>`)
  bindRipples(m)
  const upd = () => {
    $('#cash-extra').style.display = method === 'cash' ? 'block' : 'none'
    $('#ref-extra').style.display = method !== 'cash' ? 'block' : 'none'
  }
  m.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => {
    method = b.dataset.m; m.querySelectorAll('.pay-method').forEach((x) => x.classList.toggle('sel', x === b)); upd()
  }))
  $('#pay-tendered')?.addEventListener('input', () => {
    const change = (+$('#pay-tendered').value || 0) - (+$('#pay-amt').value || 0)
    $('#change-due').textContent = change > 0 ? 'Change due: ' + money(change) : ''
  })
  $('#pay-go').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.classList.add('morph')
    try {
      const body = { document_id: doc?.id, method, amount: +$('#pay-amt').value, tendered: method === 'cash' ? +($('#pay-tendered').value || 0) : null, reference: $('#pay-ref')?.value }
      const r = await api('/payments', { method: 'POST', body })
      btn.classList.remove('morph'); closeModal(); confetti()
      toast('Payment recorded' + (r.change_due ? ' · change ' + money(r.change_due) : ''), 'ok', 'fa-circle-check')
      loadRoute(State.route === 'payments' ? 'payments' : 'invoice')
    } catch (err) { btn.classList.remove('morph'); toast(err.message, 'bad') }
  })
  upd()
}

/* ============================================================
   EMAIL
   ============================================================ */
function emailModal(doc) {
  const m = modal(`<div class="drawer-handle"></div><h3>Send via Email</h3>
    <div class="field"><label>Recipient</label><input class="input" id="em-to" type="email" value="${esc(doc?.client_email || '')}" placeholder="patient@email.com"></div>
    <div class="field"><label>Subject</label><input class="input" id="em-subj" value="${esc((doc?.number || 'Document') + ' from ' + (State.company?.name || 'us'))}"></div>
    <div class="field"><label>Message</label><textarea class="input" id="em-msg" placeholder="Please find your document attached.">Please find your ${esc(doc?.type || 'document')} attached.</textarea></div>
    <button class="btn primary block" id="em-go"><span class="label"><i class="fa-solid fa-paper-plane"></i> Send</span><span class="spinner"></span></button>`)
  bindRipples(m)
  $('#em-go').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.classList.add('morph')
    try {
      const r = await api('/email/send', { method: 'POST', body: { document_id: doc?.id, recipient: $('#em-to').value, subject: $('#em-subj').value, message: $('#em-msg').value } })
      btn.classList.remove('morph'); closeModal()
      toast(r.note || 'Email sent', r.provider === 'log' ? 'info' : 'ok', 'fa-paper-plane')
    } catch (err) { btn.classList.remove('morph'); toast(err.message, 'bad') }
  })
}

/* ============================================================
   TEAM
   ============================================================ */
async function screenTeam() {
  if (!roleAtLeast('manager')) { return notAllowed('Team management requires Manager role') }
  let members = []
  try { members = (await api('/companies/members')).members } catch (e) { toast(e.message, 'bad') }
  const view = $('#view')
  view.innerHTML = `<div class="screen">
    ${topbar('Team & Roles')}
    ${roleAtLeast('admin') ? `<button class="btn primary block" id="add-mem" style="margin-bottom:14px"><i class="fa-solid fa-user-plus"></i> Add Member</button>` : ''}
    <div>${members.map(memberRow).join('')}</div>
  </div>`
  bindTopbar(); bindRipples(view)
  view.querySelectorAll('[data-mid]').forEach((r) => r.addEventListener('click', () => { if (roleAtLeast('admin')) editRole(r.dataset.mid, r.dataset.role) }))
  $('#add-mem')?.addEventListener('click', addMember)
}
function memberRow(m) {
  const cols = { admin: '#ef4444', manager: '#f59e0b', staff: '#6366f1', viewer: '#6b7494' }
  return `<div class="list-row" data-mid="${m.membership_id}" data-role="${m.role}">
    <div class="lr-ico" style="background:${cols[m.role]}"><i class="fa-solid fa-user"></i></div>
    <div class="lr-main"><b>${esc(m.name)}</b><small>${esc(m.email)}</small></div>
    <span class="chip" style="text-transform:capitalize">${esc(m.role)}</span></div>`
}
function editRole(mid, current) {
  const m = modal(`<div class="drawer-handle"></div><h3>Change Role</h3>
    <div class="field"><label>Role</label><select class="input" id="role-sel">
      ${['admin', 'manager', 'staff', 'viewer'].map((r) => `<option ${r === current ? 'selected' : ''}>${r}</option>`).join('')}</select></div>
    <button class="btn primary block" id="role-save">Save</button>`)
  $('#role-save').addEventListener('click', async () => {
    try { await api('/companies/members/' + mid, { method: 'PUT', body: { role: $('#role-sel').value } }); closeModal(); toast('Role updated', 'ok'); loadRoute('team') }
    catch (e) { toast(e.message, 'bad') }
  })
}
function addMember() {
  const m = modal(`<div class="drawer-handle"></div><h3>Add Member</h3>
    <div class="field"><label>Name (new users)</label><input class="input" id="mn"></div>
    <div class="field"><label>Email</label><input class="input" id="me" type="email"></div>
    <div class="field"><label>Temp Password (new users)</label><input class="input" id="mp" type="password"></div>
    <div class="field"><label>Role</label><select class="input" id="mr"><option>staff</option><option>manager</option><option>admin</option><option>viewer</option></select></div>
    <button class="btn primary block" id="ms"><span class="label">Add</span><span class="spinner"></span></button>`)
  bindRipples(m)
  $('#ms').addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.classList.add('morph')
    try { await api('/companies/members', { method: 'POST', body: { name: $('#mn').value, email: $('#me').value, password: $('#mp').value, role: $('#mr').value } }); btn.classList.remove('morph'); closeModal(); toast('Member added', 'ok'); loadRoute('team') }
    catch (err) { btn.classList.remove('morph'); toast(err.message, 'bad') }
  })
}

/* ============================================================
   STORAGE
   ============================================================ */
async function screenStorage() {
  let usage = { files: 0, bytes: 0, objects: [] }
  try { usage = await api('/storage/usage') } catch (e) { toast(e.message, 'bad') }
  const view = $('#view')
  view.innerHTML = `<div class="screen">
    ${topbar('Cloud Storage', 'R2 object storage')}
    <div class="grid cols-2">
      ${statCard('fa-folder', '#06b6d4', usage.files, 'Stored files')}
      ${statCard('fa-hard-drive', '#8b5cf6', (usage.bytes / 1024).toFixed(1) + ' KB', 'Usage')}
    </div>
    <div class="section-title"><i class="fa-solid fa-file" style="color:var(--accent)"></i> Files</div>
    <div>${(usage.objects || []).length ? usage.objects.map((o) => `<div class="list-row"><div class="lr-ico" style="background:#06b6d4"><i class="fa-solid fa-file-pdf"></i></div><div class="lr-main"><b>${esc(o.key.split('/').pop())}</b><small>${(o.size / 1024).toFixed(1)} KB</small></div></div>`).join('') : emptyBlock('No files yet — generate a document to upload its PDF')}</div>
  </div>`
  bindTopbar(); bindRipples(view); animateCounters(view)
}

/* ============================================================
   COMPANY SETTINGS
   ============================================================ */
async function screenCompany() {
  let data
  try { data = await api('/companies/current'); State.company = data.company } catch (e) { toast(e.message, 'bad'); return }
  const c = data.company; const canEdit = roleAtLeast('admin')
  const view = $('#view')
  view.innerHTML = `<div class="screen">
    ${topbar('Company')}
    <div class="card">
      <div class="field"><label>Company Name</label><input class="input" id="c-name" value="${esc(c.name)}" ${canEdit ? '' : 'disabled'}></div>
      <div class="field"><label>Type</label><select class="input" id="c-type" ${canEdit ? '' : 'disabled'}>
        ${['hospital', 'clinic', 'corporate', 'other'].map((t) => `<option ${t === c.type ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="row">
        <div class="field"><label>Currency</label><input class="input" id="c-curr" value="${esc(c.currency)}" ${canEdit ? '' : 'disabled'}></div>
        <div class="field"><label>Tax Rate (%)</label><input class="input" id="c-tax" type="number" value="${c.tax_rate}" ${canEdit ? '' : 'disabled'}></div>
      </div>
      <div class="field"><label>Brand Color</label><input class="input" id="c-color" type="color" value="${c.brand_color || '#6366f1'}" ${canEdit ? '' : 'disabled'} style="height:48px"></div>
      <div class="field"><label>Address</label><textarea class="input" id="c-addr" ${canEdit ? '' : 'disabled'}>${esc(c.address || '')}</textarea></div>
      ${canEdit ? `<button class="btn primary block" id="c-save"><span class="label">Save Changes</span><span class="spinner"></span></button>` : '<p style="color:var(--text-dim);font-size:12px">Admin role required to edit.</p>'}
    </div>
    <div class="section-title"><i class="fa-solid fa-code-branch" style="color:var(--accent)"></i> Branches</div>
    <div>${(data.branches || []).map((b) => `<div class="list-row"><div class="lr-ico" style="background:#8b5cf6"><i class="fa-solid fa-location-dot"></i></div><div class="lr-main"><b>${esc(b.name)}</b><small>${esc(b.address || '')}</small></div></div>`).join('') || emptyBlock('No branches')}</div>
    ${roleAtLeast('manager') ? `<button class="btn block" id="add-branch"><i class="fa-solid fa-plus"></i> Add Branch</button>` : ''}
  </div>`
  bindTopbar(); bindRipples(view)
  $('#c-save')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget; btn.classList.add('morph')
    try {
      await api('/companies/current', { method: 'PUT', body: { name: $('#c-name').value, type: $('#c-type').value, currency: $('#c-curr').value, tax_rate: +$('#c-tax').value, brand_color: $('#c-color').value, address: $('#c-addr').value } })
      btn.classList.remove('morph'); toast('Company updated', 'ok')
      const me = await api('/auth/me'); State.companies = me.companies; persist()
    } catch (err) { btn.classList.remove('morph'); toast(err.message, 'bad') }
  })
  $('#add-branch')?.addEventListener('click', () => {
    const m = modal(`<div class="drawer-handle"></div><h3>Add Branch</h3>
      <div class="field"><label>Name</label><input class="input" id="b-name"></div>
      <div class="field"><label>Address</label><input class="input" id="b-addr"></div>
      <button class="btn primary block" id="b-save">Add</button>`)
    $('#b-save').addEventListener('click', async () => {
      try { await api('/companies/branches', { method: 'POST', body: { name: $('#b-name').value, address: $('#b-addr').value } }); closeModal(); toast('Branch added', 'ok'); loadRoute('company') }
      catch (e) { toast(e.message, 'bad') }
    })
  })
}

/* ============================================================
   SETTINGS
   ============================================================ */
function screenSettings() {
  const view = $('#view')
  view.innerHTML = `<div class="screen">
    ${topbar('Settings')}
    <div class="card" style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
      <div class="lr-ico" style="background:linear-gradient(135deg,var(--accent),var(--accent2));width:52px;height:52px;font-size:20px"><i class="fa-solid fa-user"></i></div>
      <div class="lr-main"><b style="font-size:16px">${esc(State.user?.name)}</b><small>${esc(State.user?.email)}</small><br><span class="chip" style="text-transform:capitalize;margin-top:4px">${esc(State.activeRole)}</span></div>
    </div>
    <div class="card" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><b>Dark Mode</b><br><small style="color:var(--text-dim)">Premium neon theme</small></div>
        <div class="toggle ${State.theme === 'dark' ? 'on' : ''}" id="theme-toggle"><div class="knob"></div></div>
      </div>
    </div>
    <button class="btn block" id="sessions-btn" style="margin-bottom:10px"><i class="fa-solid fa-laptop"></i> Active Sessions & Devices</button>
    <button class="btn block" id="logout-all-btn" style="margin-bottom:10px;color:var(--warn)"><i class="fa-solid fa-right-from-bracket"></i> Logout All Devices</button>
    <button class="btn block" id="logout-btn" style="color:var(--bad)"><i class="fa-solid fa-power-off"></i> Logout</button>
    <p style="text-align:center;color:var(--text-faint);font-size:11px;margin-top:24px">Invoker v1.0 · Edge PWA · Hono + Cloudflare</p>
  </div>`
  bindTopbar(); bindRipples(view)
  $('#theme-toggle').addEventListener('click', (e) => { e.currentTarget.classList.toggle('on'); toggleTheme() })
  $('#logout-btn').addEventListener('click', () => logout())
  $('#logout-all-btn').addEventListener('click', async () => { try { await api('/auth/logout-all', { method: 'POST' }); toast('Logged out all devices', 'ok'); logout() } catch (e) { toast(e.message, 'bad') } })
  $('#sessions-btn').addEventListener('click', async () => {
    try {
      const d = await api('/auth/sessions')
      modal(`<div class="drawer-handle"></div><h3>Active Sessions</h3>
        <div>${d.sessions.map((s) => `<div class="list-row"><div class="lr-ico" style="background:${s.revoked ? '#6b7494' : '#22c55e'}"><i class="fa-solid fa-laptop"></i></div>
          <div class="lr-main"><b>${esc(s.device || 'Device')}</b><small>${esc((s.user_agent || '').slice(0, 40))} · ${esc(s.ip || '')}</small></div>
          ${s.revoked ? '<span class="chip">revoked</span>' : '<span class="badge paid">active</span>'}</div>`).join('')}</div>`)
    } catch (e) { toast(e.message, 'bad') }
  })
}

function notAllowed(msg) {
  $('#view').innerHTML = `<div class="screen">${topbar('Access Denied')}<div class="empty"><i class="fa-solid fa-lock"></i><p>${esc(msg)}</p></div></div>`
  bindTopbar()
}

/* ---------------- RBAC helper ---------------- */
const ROLE_RANK = { viewer: 1, staff: 2, manager: 3, admin: 4 }
function roleAtLeast(min) { return (ROLE_RANK[State.activeRole] || 0) >= ROLE_RANK[min] }

/* ============================================================
   REAL-TIME SYNC (SSE + polling fallback)
   ============================================================ */
let sse = null, pollTimer = null, hbTimer = null

function startSync() {
  if (!State.access || !State.activeCompany) return
  // Try SSE; fall back to polling.
  try {
    sse = new EventSource('/api/sync/stream?token=' + encodeURIComponent(State.access) + '&since=' + State.syncId)
    sse.onmessage = (e) => {
      const d = JSON.parse(e.data)
      if (d.type === 'event') handleSyncEvent(d)
      if (d.type === 'reconnect') { State.syncId = d.last_id || State.syncId; localStorage.setItem('inv_sync_id', State.syncId) }
    }
    sse.onerror = () => { /* EventSource auto-reconnects; also keep polling alive */ }
  } catch { startPolling() }
  startPolling()
}
function startPolling() {
  clearInterval(pollTimer)
  pollTimer = setInterval(async () => {
    if (!State.online || !State.access) return
    try {
      const d = await api('/sync/poll?since=' + State.syncId)
      if (d.events?.length) { d.events.forEach(handleSyncEvent); State.syncId = d.last_id; localStorage.setItem('inv_sync_id', String(d.last_id)) }
    } catch {}
  }, 8000)
}
function handleSyncEvent(d) {
  if (d.id) { State.syncId = Math.max(State.syncId, d.id); localStorage.setItem('inv_sync_id', String(State.syncId)) }
  if (d.self) return // ignore our own actions
  const labels = { 'invoice.created': 'New invoice created', 'payment.created': 'New payment received', 'document.generated': 'Document generated', 'invoice.updated': 'Invoice updated', 'certificate.created': 'New certificate', 'report.created': 'New report' }
  toast(labels[d.event] || 'Update: ' + d.event, 'info', 'fa-bolt')
  if (['dashboard', State.route].includes(State.route)) {
    // refresh current view softly
    if (['dashboard', 'invoice', 'certificate', 'report', 'payments'].includes(State.route)) loadRoute(State.route)
  }
}
function stopSync() { sse?.close(); sse = null; clearInterval(pollTimer); clearInterval(hbTimer) }
function restartSync() { stopSync(); startSync() }

/* ---------------- Online/offline ---------------- */
window.addEventListener('online', () => { State.online = true; const i = $('#sync-ind'); i?.classList.remove('off'); toast('Back online', 'ok', 'fa-wifi'); replayQueue() })
window.addEventListener('offline', () => { State.online = false; $('#sync-ind')?.classList.add('off'); toast('You are offline', 'info', 'fa-plane') })

/* ============================================================
   BOOT
   ============================================================ */
async function init() {
  await IDB.open()
  applyTheme()
  // hide splash
  setTimeout(() => $('#splash')?.classList.add('hide'), 1100)
  if (State.access) {
    try { const me = await api('/auth/me'); State.user = me.user; State.companies = me.companies; State.activeCompany = me.active_company; State.activeRole = me.active_role; persist(); bootApp(); replayQueue() }
    catch (e) {
      if (State.refresh && await refreshToken()) { bootApp() } else { renderAuth('login') }
    }
  } else {
    renderAuth('login')
  }
}
window.addEventListener('DOMContentLoaded', init)
