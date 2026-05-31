import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { serveStatic } from 'hono/cloudflare-workers'
import type { AppEnv } from './lib/types'
import { renderApp } from './app'

import auth from './routes/auth'
import documents from './routes/documents'
import payments from './routes/payments'
import companies from './routes/companies'
import sync from './routes/sync'
import misc from './routes/misc'

const app = new Hono<AppEnv>()

app.use('*', logger())
app.use('/api/*', cors())

// ---- API ----
const api = new Hono<AppEnv>()
api.get('/health', (c) => c.json({ ok: true, app: c.env.APP_NAME || 'Invoker', time: Date.now() }))
api.route('/auth', auth)
api.route('/documents', documents)
api.route('/payments', payments)
api.route('/companies', companies)
api.route('/sync', sync)
api.route('/', misc)
app.route('/api', api)

// ---- Static assets ----
app.use('/static/*', serveStatic({ root: './public' }))
app.use('/manifest.webmanifest', serveStatic({ path: './public/manifest.webmanifest' }))
app.use('/sw.js', serveStatic({ path: './public/sw.js' }))
app.use('/icon-192.png', serveStatic({ path: './public/icon-192.png' }))
app.use('/icon-512.png', serveStatic({ path: './public/icon-512.png' }))

// ---- PWA shell (SPA) ----
app.get('*', (c) => c.html(renderApp()))

export default app
