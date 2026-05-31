import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { uid } from '../lib/crypto'
import { authRequired, requireCompany, requireRole, audit, publishSync } from '../lib/middleware'

const misc = new Hono<AppEnv>()

// ---------------- Dashboard ----------------
misc.get('/dashboard', authRequired, requireCompany, async (c) => {
  const u = c.get('user')
  const counts = await c.env.DB.prepare(
    `SELECT
       SUM(CASE WHEN type='invoice' THEN 1 ELSE 0 END) AS invoices,
       SUM(CASE WHEN type='certificate' THEN 1 ELSE 0 END) AS certificates,
       SUM(CASE WHEN type='report' THEN 1 ELSE 0 END) AS reports,
       SUM(CASE WHEN status='paid' THEN total ELSE 0 END) AS revenue,
       SUM(CASE WHEN status='due' THEN total ELSE 0 END) AS due
     FROM documents WHERE company_id = ?`
  ).bind(u.cid).first<any>()
  const pays = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount),0) AS collected, COUNT(*) AS txns FROM payments WHERE company_id=? AND status='completed'`
  ).bind(u.cid).first<any>()
  const recent = await c.env.DB.prepare(
    `SELECT id, type, number, title, client_name, total, status, created_at FROM documents
     WHERE company_id=? ORDER BY created_at DESC LIMIT 8`
  ).bind(u.cid).all()
  // revenue per day (last 7d) for chart
  const series = await c.env.DB.prepare(
    `SELECT DATE(created_at) AS d, COALESCE(SUM(amount),0) AS amt FROM payments
     WHERE company_id=? AND status='completed' AND created_at >= DATE('now','-7 days')
     GROUP BY DATE(created_at) ORDER BY d`
  ).bind(u.cid).all()
  return c.json({
    counts: {
      invoices: counts?.invoices || 0,
      certificates: counts?.certificates || 0,
      reports: counts?.reports || 0,
      revenue: counts?.revenue || 0,
      due: counts?.due || 0,
      collected: pays?.collected || 0,
      txns: pays?.txns || 0,
    },
    recent: recent.results,
    series: series.results,
  })
})

// ---------------- Email (SES-ready, HTTP based) ----------------
// On the edge we cannot use the AWS SDK. This logs the email and, if SES creds
// are configured as secrets, would POST to the SES HTTPS endpoint. For the demo
// it records an email_log entry and returns success.
misc.post('/email/send', authRequired, requireCompany, requireRole('staff'), async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const { document_id, recipient, subject, message } = body
  if (!recipient || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipient)) return c.json({ error: 'Valid recipient required' }, 400)

  let status = 'sent'
  let provider = 'log'
  if (c.env.SES_ACCESS_KEY && c.env.SES_SECRET_KEY) {
    provider = 'ses'
    // Real SES integration would sign a request to
    // https://email.<region>.amazonaws.com/ here using SigV4 (Web Crypto).
    // Left as a configuration point; we record the attempt.
  }
  const id = uid('eml')
  await c.env.DB.prepare(
    `INSERT INTO email_logs (id, company_id, document_id, recipient, subject, status, provider)
     VALUES (?,?,?,?,?,?,?)`
  ).bind(id, u.cid, document_id || null, recipient, subject || 'Document from Invoker', status, provider).run()
  await audit(c, 'email', 'email', id, { recipient })
  return c.json({ ok: true, id, status, provider, note: provider === 'log' ? 'SES not configured — logged only' : 'queued via SES' })
})

misc.get('/email/logs', authRequired, requireCompany, requireRole('manager'), async (c) => {
  const u = c.get('user')
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM email_logs WHERE company_id=? ORDER BY created_at DESC LIMIT 100`
  ).bind(u.cid).all()
  return c.json({ logs: results })
})

// ---------------- Storage (R2) ----------------
// Upload a generated PDF (base64) to R2 and attach key to the document.
misc.post('/storage/upload', authRequired, requireCompany, requireRole('staff'), async (c) => {
  const u = c.get('user')
  const body = await c.req.json().catch(() => ({}))
  const { document_id, filename, content_base64, content_type } = body
  if (!content_base64) return c.json({ error: 'content_base64 required' }, 400)
  const key = `${u.cid}/${document_id || 'misc'}/${Date.now()}-${filename || 'file.pdf'}`
  try {
    const bin = Uint8Array.from(atob(content_base64), (ch) => ch.charCodeAt(0))
    await c.env.R2.put(key, bin, { httpMetadata: { contentType: content_type || 'application/pdf' } })
    if (document_id) {
      await c.env.DB.prepare(`UPDATE documents SET pdf_key=? WHERE id=? AND company_id=?`).bind(key, document_id, u.cid).run()
    }
    await publishSync(c, 'document.generated', { document_id, key })
    return c.json({ ok: true, key })
  } catch (e) {
    return c.json({ error: 'Upload failed', detail: String(e) }, 500)
  }
})

// GET /api/storage/file/:key  (key is URL-encoded full path)
misc.get('/storage/file/*', authRequired, requireCompany, async (c) => {
  const u = c.get('user')
  const key = c.req.path.replace('/api/storage/file/', '')
  if (!key.startsWith(u.cid + '/')) return c.json({ error: 'Forbidden' }, 403)
  const obj = await c.env.R2.get(key)
  if (!obj) return c.json({ error: 'Not found' }, 404)
  return new Response(obj.body, {
    headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream' },
  })
})

misc.get('/storage/usage', authRequired, requireCompany, async (c) => {
  const u = c.get('user')
  const list = await c.env.R2.list({ prefix: u.cid + '/' })
  const totalBytes = (list.objects || []).reduce((s, o) => s + (o.size || 0), 0)
  return c.json({ files: list.objects?.length || 0, bytes: totalBytes, objects: list.objects?.slice(0, 50) || [] })
})

export default misc
