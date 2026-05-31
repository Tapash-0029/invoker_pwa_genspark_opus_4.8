import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { uid } from '../lib/crypto'
import { authRequired, requireCompany, requireRole, audit, publishSync } from '../lib/middleware'

const docs = new Hono<AppEnv>()
docs.use('*', authRequired, requireCompany)

function computeTotals(data: any, taxRate = 0) {
  const items = Array.isArray(data?.items) ? data.items : []
  const subtotal = items.reduce((s: number, it: any) => s + (Number(it.qty) || 0) * (Number(it.price) || 0), 0)
  const discount = Number(data?.discount) || 0
  const tax = Math.max(0, (subtotal - discount)) * (Number(data?.tax_rate ?? taxRate) / 100)
  const total = Math.max(0, subtotal - discount + tax)
  return { subtotal, discount, tax, total }
}

// GET /api/documents?type=invoice&status=&q=
docs.get('/', async (c) => {
  const u = c.get('user')
  const type = c.req.query('type')
  const status = c.req.query('status')
  const q = c.req.query('q')
  let sql = `SELECT id, type, number, template, title, client_name, client_email, status,
             subtotal, tax, discount, total, created_at, updated_at FROM documents WHERE company_id = ?`
  const binds: any[] = [u.cid]
  if (type) { sql += ` AND type = ?`; binds.push(type) }
  if (status) { sql += ` AND status = ?`; binds.push(status) }
  if (q) { sql += ` AND (title LIKE ? OR client_name LIKE ? OR number LIKE ?)`; binds.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  sql += ` ORDER BY created_at DESC LIMIT 200`
  const { results } = await c.env.DB.prepare(sql).bind(...binds).all()
  return c.json({ documents: results })
})

// GET /api/documents/:id
docs.get('/:id', async (c) => {
  const u = c.get('user')
  const doc = await c.env.DB.prepare(`SELECT * FROM documents WHERE id = ? AND company_id = ?`)
    .bind(c.req.param('id'), u.cid).first<any>()
  if (!doc) return c.json({ error: 'Not found' }, 404)
  doc.data = JSON.parse(doc.data_json || '{}')
  return c.json({ document: doc })
})

// POST /api/documents  (create) — staff+
docs.post('/', requireRole('staff'), async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const { type, template, title, client_name, client_email, client_phone, data, status } = body
  if (!['invoice', 'certificate', 'report'].includes(type)) return c.json({ error: 'Invalid type' }, 400)

  const company = await c.env.DB.prepare(`SELECT tax_rate FROM companies WHERE id = ?`).bind(u.cid).first<any>()
  const totals = computeTotals(data || {}, company?.tax_rate || 0)

  // auto number
  const prefix = type === 'invoice' ? 'INV' : type === 'certificate' ? 'CRT' : 'RPT'
  const cnt = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM documents WHERE company_id = ? AND type = ?`)
    .bind(u.cid, type).first<any>()
  const number = `${prefix}-${String((cnt?.n || 0) + 1).padStart(4, '0')}`

  const id = uid('doc')
  await c.env.DB.prepare(
    `INSERT INTO documents (id, company_id, type, number, template, title, client_name, client_email, client_phone,
       data_json, subtotal, tax, discount, total, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).bind(
    id, u.cid, type, number, template || 'classic', title || number, client_name || '', client_email || '',
    client_phone || '', JSON.stringify(data || {}), totals.subtotal, totals.tax, totals.discount, totals.total,
    status || 'draft', u.sub
  ).run()

  await audit(c, 'create', type, id, { number })
  await publishSync(c, `${type}.created`, { id, number, title: title || number })
  return c.json({ id, number, ...totals }, 201)
})

// PUT /api/documents/:id (update) — staff+
docs.put('/:id', requireRole('staff'), async (c) => {
  const u = c.get('user')
  const id = c.req.param('id')
  const doc = await c.env.DB.prepare(`SELECT * FROM documents WHERE id = ? AND company_id = ?`).bind(id, u.cid).first<any>()
  if (!doc) return c.json({ error: 'Not found' }, 404)
  const body = await c.req.json().catch(() => ({}))
  const data = body.data ?? JSON.parse(doc.data_json || '{}')
  const company = await c.env.DB.prepare(`SELECT tax_rate FROM companies WHERE id = ?`).bind(u.cid).first<any>()
  const totals = computeTotals(data, company?.tax_rate || 0)

  await c.env.DB.prepare(
    `UPDATE documents SET template=?, title=?, client_name=?, client_email=?, client_phone=?,
       data_json=?, subtotal=?, tax=?, discount=?, total=?, status=?, updated_at=CURRENT_TIMESTAMP
     WHERE id=? AND company_id=?`
  ).bind(
    body.template ?? doc.template, body.title ?? doc.title, body.client_name ?? doc.client_name,
    body.client_email ?? doc.client_email, body.client_phone ?? doc.client_phone,
    JSON.stringify(data), totals.subtotal, totals.tax, totals.discount, totals.total,
    body.status ?? doc.status, id, u.cid
  ).run()

  await audit(c, 'update', doc.type, id, {})
  await publishSync(c, `${doc.type}.updated`, { id })
  return c.json({ ok: true, ...totals })
})

// DELETE /api/documents/:id — manager+
docs.delete('/:id', requireRole('manager'), async (c) => {
  const u = c.get('user')
  const id = c.req.param('id')
  const doc = await c.env.DB.prepare(`SELECT type FROM documents WHERE id = ? AND company_id = ?`).bind(id, u.cid).first<any>()
  if (!doc) return c.json({ error: 'Not found' }, 404)
  await c.env.DB.prepare(`DELETE FROM documents WHERE id = ? AND company_id = ?`).bind(id, u.cid).run()
  await audit(c, 'delete', doc.type, id, {})
  await publishSync(c, `${doc.type}.deleted`, { id })
  return c.json({ ok: true })
})

export default docs
