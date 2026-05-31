import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { authRequired, requireCompany } from '../lib/middleware'

// Edge-compatible real-time sync.
// True WebSockets on Cloudflare require Durable Objects (Workers Paid plan).
// On Pages we provide an SSE stream + a polling fallback (?since=) that work
// identically for the client: long-poll for new sync_events.

const sync = new Hono<AppEnv>()

// GET /api/sync/poll?since=<eventId>&token=<access>  (EventSource can't set headers,
// so we accept the access token via query for the stream variant; the poll variant
// uses the Authorization header.)
sync.get('/poll', authRequired, requireCompany, async (c) => {
  const u = c.get('user')
  const since = Number(c.req.query('since') || '0')
  const { results } = await c.env.DB.prepare(
    `SELECT id, event, payload_json, actor_id, created_at FROM sync_events
     WHERE company_id = ? AND id > ? ORDER BY id ASC LIMIT 100`
  ).bind(u.cid, since).all()
  const events = (results || []).map((r: any) => ({
    id: r.id, event: r.event, payload: JSON.parse(r.payload_json || '{}'),
    actor_id: r.actor_id, created_at: r.created_at,
    self: r.actor_id === u.sub,
  }))
  const lastId = events.length ? events[events.length - 1].id : since
  return c.json({ events, last_id: lastId, server_time: Date.now() })
})

// GET /api/sync/stream?token=...&since=...  Server-Sent Events stream
sync.get('/stream', async (c) => {
  // EventSource cannot send Authorization header → accept token via query.
  const token = c.req.query('token') || ''
  const { verifyJwt } = await import('../lib/crypto')
  const payload = await verifyJwt(token, c.env.JWT_SECRET)
  if (!payload || payload.type !== 'access' || !payload.cid) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  const cid = payload.cid
  let since = Number(c.req.query('since') || '0')

  const encoder = new TextEncoder()
  const db = c.env.DB
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: any) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`))
      send({ type: 'connected', server_time: Date.now() })
      let alive = true
      let ticks = 0
      // Poll the events table on the edge worker for up to ~50s, then let the
      // client reconnect (EventSource auto-reconnects). Heartbeat every 30s.
      while (alive && ticks < 25) {
        ticks++
        try {
          const { results } = await db.prepare(
            `SELECT id, event, payload_json, actor_id, created_at FROM sync_events
             WHERE company_id = ? AND id > ? ORDER BY id ASC LIMIT 50`
          ).bind(cid, since).all()
          for (const r of results || []) {
            since = (r as any).id
            send({
              type: 'event',
              id: (r as any).id,
              event: (r as any).event,
              payload: JSON.parse((r as any).payload_json || '{}'),
              self: (r as any).actor_id === payload.sub,
              created_at: (r as any).created_at,
            })
          }
          if (ticks % 15 === 0) send({ type: 'heartbeat', t: Date.now() })
        } catch (e) {
          send({ type: 'error', message: String(e) })
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
      send({ type: 'reconnect', last_id: since })
      controller.close()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
})

export default sync
