import type { MiddlewareHandler } from 'hono'
import type { AppEnv, Role } from './types'
import { roleAtLeast } from './types'
import { verifyJwt } from './crypto'

// Requires a valid access token. Populates c.var.user.
export const authRequired: MiddlewareHandler<AppEnv> = async (c, next) => {
  const header = c.req.header('Authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return c.json({ error: 'Unauthorized' }, 401)
  const payload = await verifyJwt(token, c.env.JWT_SECRET)
  if (!payload || payload.type !== 'access') return c.json({ error: 'Invalid or expired token' }, 401)
  c.set('user', payload)
  await next()
}

// Requires an active company context in the token.
export const requireCompany: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user')
  if (!user?.cid) return c.json({ error: 'No active company selected' }, 403)
  await next()
}

// Requires a minimum role within the active company.
export function requireRole(min: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user')
    if (!roleAtLeast(user?.role, min)) return c.json({ error: 'Insufficient permissions' }, 403)
    await next()
  }
}

export async function audit(
  c: any,
  action: string,
  entity: string,
  entityId: string,
  meta: Record<string, unknown> = {}
) {
  try {
    const user = c.get('user')
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (id, company_id, user_id, action, entity, entity_id, meta_json)
       VALUES (?,?,?,?,?,?,?)`
    )
      .bind(
        crypto.randomUUID(),
        user?.cid || null,
        user?.sub || null,
        action,
        entity,
        entityId,
        JSON.stringify(meta)
      )
      .run()
  } catch (e) {
    console.error('audit error', e)
  }
}

// Publish a sync event for SSE/polling consumers.
export async function publishSync(
  c: any,
  event: string,
  payload: Record<string, unknown>
) {
  try {
    const user = c.get('user')
    await c.env.DB.prepare(
      `INSERT INTO sync_events (company_id, event, payload_json, actor_id) VALUES (?,?,?,?)`
    )
      .bind(user?.cid || null, event, JSON.stringify(payload), user?.sub || null)
      .run()
  } catch (e) {
    console.error('sync publish error', e)
  }
}
