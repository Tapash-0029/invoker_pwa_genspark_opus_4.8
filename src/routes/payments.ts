import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { uid } from '../lib/crypto'
import { authRequired, requireCompany, requireRole, audit, publishSync } from '../lib/middleware'

const pay = new Hono<AppEnv>()
pay.use('*', authRequired, requireCompany)

// GET /api/payments
pay.get('/', async (c) => {
  const u = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, d.number AS doc_number, d.title AS doc_title
     FROM payments p LEFT JOIN documents d ON d.id = p.document_id
     WHERE p.company_id = ? ORDER BY p.created_at DESC LIMIT 200`
  ).bind(u.cid).all()
  return c.json({ payments: results })
})

// POST /api/payments — staff+
pay.post('/', requireRole('staff'), async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const { document_id, method, amount, tendered, reference } = body
  if (!['cash', 'bkash', 'nagad', 'card'].includes(method)) return c.json({ error: 'Invalid method' }, 400)
  const amt = Number(amount)
  if (!amt || amt <= 0) return c.json({ error: 'Invalid amount' }, 400)

  let change = 0
  if (method === 'cash' && tendered) change = Math.max(0, Number(tendered) - amt)

  const id = uid('pay')
  const status = method === 'card' || method === 'bkash' || method === 'nagad' ? 'completed' : 'completed'
  await c.env.DB.prepare(
    `INSERT INTO payments (id, company_id, document_id, method, amount, tendered, change_due, reference, status, created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).bind(id, u.cid, document_id || null, method, amt, tendered || null, change, reference || '', status, u.sub).run()

  // mark linked document as paid/due based on totals
  if (document_id) {
    const doc = await c.env.DB.prepare(`SELECT total FROM documents WHERE id = ? AND company_id = ?`).bind(document_id, u.cid).first<any>()
    if (doc) {
      const paidRow = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(amount),0) AS paid FROM payments WHERE document_id = ? AND status='completed'`
      ).bind(document_id).first<any>()
      const newStatus = (paidRow?.paid || 0) >= doc.total ? 'paid' : 'due'
      await c.env.DB.prepare(`UPDATE documents SET status = ?, updated_at=CURRENT_TIMESTAMP WHERE id = ?`).bind(newStatus, document_id).run()
      await publishSync(c, 'invoice.updated', { id: document_id, status: newStatus })
    }
  }

  await audit(c, 'payment', 'payment', id, { method, amount: amt })
  await publishSync(c, 'payment.created', { id, method, amount: amt, document_id })
  return c.json({ id, change_due: change, status }, 201)
})

// GET /api/payments/stats — quick dashboard numbers
pay.get('/stats', async (c) => {
  const u = c.get('user')
  const totals = await c.env.DB.prepare(
    `SELECT
       COALESCE(SUM(amount),0) AS total_collected,
       COUNT(*) AS txn_count
     FROM payments WHERE company_id = ? AND status='completed'`
  ).bind(u.cid).first<any>()
  const byMethod = await c.env.DB.prepare(
    `SELECT method, COALESCE(SUM(amount),0) AS amount FROM payments WHERE company_id=? AND status='completed' GROUP BY method`
  ).bind(u.cid).all()
  return c.json({ ...totals, by_method: byMethod.results })
})

export default pay
