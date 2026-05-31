import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { hashPassword, verifyPassword, signJwt, verifyJwt, uid, randomToken } from '../lib/crypto'
import { authRequired } from '../lib/middleware'

const ACCESS_TTL = 60 * 15 // 15 min
const REFRESH_TTL = 60 * 60 * 24 * 30 // 30 days

const auth = new Hono<AppEnv>()

async function membershipsFor(c: any, userId: string) {
  const { results } = await c.env.DB.prepare(
    `SELECT m.company_id, m.role, co.name AS company_name, co.slug, co.brand_color, co.type
     FROM memberships m JOIN companies co ON co.id = m.company_id
     WHERE m.user_id = ? ORDER BY m.created_at ASC`
  )
    .bind(userId)
    .all()
  return results || []
}

async function issueTokens(c: any, user: any, cid?: string, role?: string) {
  const access = await signJwt(
    { sub: user.id, email: user.email, name: user.name, cid, role, type: 'access' },
    c.env.JWT_SECRET,
    ACCESS_TTL
  )
  const refresh = randomToken()
  const sid = uid('ses')
  const expires = new Date(Date.now() + REFRESH_TTL * 1000).toISOString()
  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, refresh_token, device, ip, user_agent, expires_at)
     VALUES (?,?,?,?,?,?,?)`
  )
    .bind(
      sid,
      user.id,
      refresh,
      c.req.header('sec-ch-ua-platform') || 'unknown',
      c.req.header('cf-connecting-ip') || c.req.header('x-forwarded-for') || '',
      c.req.header('user-agent') || '',
      expires
    )
    .run()
  return { access, refresh, access_expires_in: ACCESS_TTL }
}

// POST /api/auth/register  { name, email, password, company_name? }
auth.post('/register', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { name, email, password, company_name } = body
  if (!name || !email || !password) return c.json({ error: 'name, email, password required' }, 400)
  if (String(password).length < 6) return c.json({ error: 'Password must be at least 6 chars' }, 400)

  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email.toLowerCase()).first()
  if (existing) return c.json({ error: 'Email already registered' }, 409)

  const userId = uid('usr')
  const ph = await hashPassword(password)
  await c.env.DB.prepare(`INSERT INTO users (id, email, name, password_hash) VALUES (?,?,?,?)`)
    .bind(userId, email.toLowerCase(), name, ph)
    .run()

  // Create a default company + admin membership
  const cid = uid('co')
  const cname = company_name || `${name}'s Company`
  const slug = cname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + cid.slice(-4)
  await c.env.DB.prepare(
    `INSERT INTO companies (id, name, slug, type) VALUES (?,?,?,?)`
  ).bind(cid, cname, slug, 'hospital').run()
  await c.env.DB.prepare(`INSERT INTO memberships (id, user_id, company_id, role) VALUES (?,?,?,?)`)
    .bind(uid('mem'), userId, cid, 'admin')
    .run()

  const user = { id: userId, email: email.toLowerCase(), name }
  const tokens = await issueTokens(c, user, cid, 'admin')
  const companies = await membershipsFor(c, userId)
  return c.json({ user, companies, active_company: cid, ...tokens })
})

// POST /api/auth/login { email, password, company_id? }
auth.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { email, password, company_id } = body
  if (!email || !password) return c.json({ error: 'email and password required' }, 400)

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE email = ?`).bind(email.toLowerCase()).first<any>()
  if (!user) return c.json({ error: 'Invalid credentials' }, 401)
  const ok = await verifyPassword(password, user.password_hash)
  if (!ok) return c.json({ error: 'Invalid credentials' }, 401)

  const companies = await membershipsFor(c, user.id)
  const active = companies.find((m: any) => m.company_id === company_id) || companies[0]
  const cid = active?.company_id
  const role = active?.role
  const tokens = await issueTokens(c, user, cid, role)
  return c.json({
    user: { id: user.id, email: user.email, name: user.name, avatar_url: user.avatar_url },
    companies,
    active_company: cid,
    active_role: role,
    ...tokens,
  })
})

// POST /api/auth/refresh { refresh_token, company_id? }
auth.post('/refresh', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const { refresh_token, company_id } = body
  if (!refresh_token) return c.json({ error: 'refresh_token required' }, 400)

  const session = await c.env.DB.prepare(
    `SELECT * FROM sessions WHERE refresh_token = ? AND revoked = 0`
  ).bind(refresh_token).first<any>()
  if (!session) return c.json({ error: 'Invalid refresh token' }, 401)
  if (new Date(session.expires_at) < new Date()) return c.json({ error: 'Refresh token expired' }, 401)

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(session.user_id).first<any>()
  if (!user) return c.json({ error: 'User not found' }, 401)

  const companies = await membershipsFor(c, user.id)
  const active = companies.find((m: any) => m.company_id === company_id) || companies[0]
  const access = await signJwt(
    { sub: user.id, email: user.email, name: user.name, cid: active?.company_id, role: active?.role, type: 'access' },
    c.env.JWT_SECRET,
    ACCESS_TTL
  )
  await c.env.DB.prepare(`UPDATE sessions SET last_seen = CURRENT_TIMESTAMP WHERE id = ?`).bind(session.id).run()
  return c.json({ access, access_expires_in: ACCESS_TTL, active_company: active?.company_id, active_role: active?.role, companies })
})

// POST /api/auth/switch-company { refresh_token, company_id } -> new access token in that company
auth.post('/switch-company', authRequired, async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const { company_id } = body
  const m = await c.env.DB.prepare(`SELECT role FROM memberships WHERE user_id = ? AND company_id = ?`)
    .bind(u.sub, company_id).first<any>()
  if (!m) return c.json({ error: 'Not a member of this company' }, 403)
  const access = await signJwt(
    { sub: u.sub, email: u.email, name: u.name, cid: company_id, role: m.role, type: 'access' },
    c.env.JWT_SECRET,
    ACCESS_TTL
  )
  return c.json({ access, access_expires_in: ACCESS_TTL, active_company: company_id, active_role: m.role })
})

// GET /api/auth/me
auth.get('/me', authRequired, async (c) => {
  const u = c.get('user')
  const user = await c.env.DB.prepare(`SELECT id, email, name, avatar_url FROM users WHERE id = ?`).bind(u.sub).first()
  const companies = await membershipsFor(c, u.sub)
  return c.json({ user, companies, active_company: u.cid, active_role: u.role })
})

// GET /api/auth/sessions  (device list)
auth.get('/sessions', authRequired, async (c) => {
  const u = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT id, device, ip, user_agent, revoked, last_seen, created_at FROM sessions
     WHERE user_id = ? ORDER BY last_seen DESC`
  ).bind(u.sub).all()
  return c.json({ sessions: results })
})

// POST /api/auth/logout { refresh_token }
auth.post('/logout', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (body.refresh_token) {
    await c.env.DB.prepare(`UPDATE sessions SET revoked = 1 WHERE refresh_token = ?`).bind(body.refresh_token).run()
  }
  return c.json({ ok: true })
})

// POST /api/auth/logout-all
auth.post('/logout-all', authRequired, async (c) => {
  const u = c.get('user')
  await c.env.DB.prepare(`UPDATE sessions SET revoked = 1 WHERE user_id = ?`).bind(u.sub).run()
  return c.json({ ok: true })
})

export default auth
