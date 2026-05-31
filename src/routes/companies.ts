import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { uid, hashPassword } from '../lib/crypto'
import { authRequired, requireCompany, requireRole, audit } from '../lib/middleware'

const co = new Hono<AppEnv>()
co.use('*', authRequired)

// GET /api/companies/current
co.get('/current', requireCompany, async (c) => {
  const u = c.get('user')
  const company = await c.env.DB.prepare(`SELECT * FROM companies WHERE id = ?`).bind(u.cid).first<any>()
  if (!company) return c.json({ error: 'Not found' }, 404)
  company.features = JSON.parse(company.features_json || '{}')
  const branches = await c.env.DB.prepare(`SELECT * FROM branches WHERE company_id = ?`).bind(u.cid).all()
  return c.json({ company, branches: branches.results })
})

// PUT /api/companies/current — admin only (branding, tax, features)
co.put('/current', requireCompany, requireRole('admin'), async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const cur = await c.env.DB.prepare(`SELECT * FROM companies WHERE id = ?`).bind(u.cid).first<any>()
  if (!cur) return c.json({ error: 'Not found' }, 404)
  await c.env.DB.prepare(
    `UPDATE companies SET name=?, type=?, logo_url=?, brand_color=?, address=?, phone=?, email=?,
       currency=?, tax_rate=?, features_json=? WHERE id=?`
  ).bind(
    body.name ?? cur.name, body.type ?? cur.type, body.logo_url ?? cur.logo_url,
    body.brand_color ?? cur.brand_color, body.address ?? cur.address, body.phone ?? cur.phone,
    body.email ?? cur.email, body.currency ?? cur.currency, body.tax_rate ?? cur.tax_rate,
    JSON.stringify(body.features ?? JSON.parse(cur.features_json || '{}')), u.cid
  ).run()
  await audit(c, 'update', 'company', u.cid, {})
  return c.json({ ok: true })
})

// POST /api/companies — create another company (becomes admin)
co.post('/', async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  if (!body.name) return c.json({ error: 'name required' }, 400)
  const cid = uid('co')
  const slug = String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + cid.slice(-4)
  await c.env.DB.prepare(`INSERT INTO companies (id, name, slug, type) VALUES (?,?,?,?)`)
    .bind(cid, body.name, slug, body.type || 'corporate').run()
  await c.env.DB.prepare(`INSERT INTO memberships (id, user_id, company_id, role) VALUES (?,?,?,?)`)
    .bind(uid('mem'), u.sub, cid, 'admin').run()
  return c.json({ id: cid, name: body.name }, 201)
})

// ---- Team management ----
// GET /api/companies/members — manager+
co.get('/members', requireCompany, requireRole('manager'), async (c) => {
  const u = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS membership_id, m.role, u.id, u.name, u.email, u.avatar_url, m.created_at
     FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.company_id = ? ORDER BY m.created_at`
  ).bind(u.cid).all()
  return c.json({ members: results })
})

// POST /api/companies/members — admin: invite/create staff
co.post('/members', requireCompany, requireRole('admin'), async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const { name, email, password, role } = body
  if (!email || !role) return c.json({ error: 'email and role required' }, 400)
  if (!['admin', 'manager', 'staff', 'viewer'].includes(role)) return c.json({ error: 'Invalid role' }, 400)

  let user = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email.toLowerCase()).first<any>()
  if (!user) {
    if (!password || !name) return c.json({ error: 'New user needs name and password' }, 400)
    const id = uid('usr')
    await c.env.DB.prepare(`INSERT INTO users (id, email, name, password_hash) VALUES (?,?,?,?)`)
      .bind(id, email.toLowerCase(), name, await hashPassword(password)).run()
    user = { id }
  }
  const exists = await c.env.DB.prepare(`SELECT id FROM memberships WHERE user_id=? AND company_id=?`).bind(user.id, u.cid).first()
  if (exists) return c.json({ error: 'Already a member' }, 409)
  await c.env.DB.prepare(`INSERT INTO memberships (id, user_id, company_id, role) VALUES (?,?,?,?)`)
    .bind(uid('mem'), user.id, u.cid, role).run()
  await audit(c, 'add_member', 'membership', user.id, { role })
  return c.json({ ok: true }, 201)
})

// PUT /api/companies/members/:membershipId — admin: change role
co.put('/members/:mid', requireCompany, requireRole('admin'), async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  if (!['admin', 'manager', 'staff', 'viewer'].includes(body.role)) return c.json({ error: 'Invalid role' }, 400)
  await c.env.DB.prepare(`UPDATE memberships SET role=? WHERE id=? AND company_id=?`).bind(body.role, c.req.param('mid'), u.cid).run()
  return c.json({ ok: true })
})

// POST /api/companies/branches — manager+
co.post('/branches', requireCompany, requireRole('manager'), async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  if (!body.name) return c.json({ error: 'name required' }, 400)
  const id = uid('br')
  await c.env.DB.prepare(`INSERT INTO branches (id, company_id, name, address) VALUES (?,?,?,?)`)
    .bind(id, u.cid, body.name, body.address || '').run()
  return c.json({ id }, 201)
})

export default co
