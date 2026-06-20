# Invoker — Document Suite (PWA)

> **UI**: Arcane/mystical theme — ornate gold-engraved login frame on a navy starfield, Cinzel serif "INVOKER" wordmark, official fire/water gear emblem logo, and a rich analytics dashboard (ornate header, sparkline stat cards, sales area chart, collection-rate donut gauge, activity feed) in both **dark** and **warm-parchment light** modes, with full micro-animations.

## Project Overview
- **Name**: Invoker
- **Goal**: A high-performance, mobile-first Progressive Web App for **Invoice, Report & Certificate** management — built for hospitals but adaptable to any company. Multi-company SaaS with secure auth, RBAC, real-time sync, offline-first support, payments, email, and cloud storage.
- **Stack**: Hono (edge runtime) + Cloudflare Pages/Workers + D1 (SQLite) + KV + R2 · Vanilla PWA frontend with Chart.js, jsPDF, QRCode.

## 🔑 Demo Login
| Email | Password | Role |
|---|---|---|
| `admin@invoker.dev` | `password123` | Admin (2 companies) |
| `staff@invoker.dev` | `password123` | Staff (City General) |

## Live URLs
- **Sandbox (dev)**: see the service URL provided in chat (port 3000)
- **Production**: _not yet deployed_ — run `npm run deploy` after `setup_cloudflare_api_key`
- **API base**: `/api`

## ✅ Currently Completed Features
### Authentication & Accounts
- Email/password **register & login** (PBKDF2-SHA256 hashing via Web Crypto — edge-safe)
- **JWT access tokens** (15 min) + **refresh tokens** (30 days, stored in D1 sessions)
- **Multi-role RBAC**: admin / manager / staff / viewer (enforced server + client side)
- **Multi-company**: switch active company, create new companies, per-company role
- **Session/device tracking**, logout, logout-all-devices

### Documents (Invoice / Certificate / Report)
- Create, Edit, Delete (RBAC-gated), List with search
- **3 template styles**: classic / modern / elegant
- **Live preview** that updates as you type
- Auto numbering (INV-/CRT-/RPT-), auto subtotal/tax/discount/total
- Draft auto-save + "Generate" morph button with **confetti** success
- **Real client-side PDF generation** (jsPDF) with company branding, **QR code embed**, multi-section layouts, print-ready — works offline

### Payments
- Methods: **Cash** (change calculation), **bKash**, **Nagad**, **Card**
- Animated payment modal, transaction history, invoice status auto-update (paid/due)
- Payment stats + audit logs + real-time sync

### Real-time Sync
- **SSE stream** (`/api/sync/stream`) + **polling fallback** (`/api/sync/poll`)
- Multi-device updates, self-event filtering, toast notifications, online/offline indicator
- Offline **IndexedDB queue + replay** on reconnect

### PWA / Offline
- Installable (manifest + icons), **service worker** (cache-first shell, network-first API)
- IndexedDB cache for dashboard/lists, offline mutation queue

### UI / Animation
- Light/Dark theme with smooth interpolation + persistence
- Bottom nav (Dashboard/Invoice/Menu/Certificate/Reports) with center logo drawer toggle
- Micro-animations: ripples, glow, morph buttons, staggered drawer items, shimmer cards, animated counters, toast/modal motion, confetti, toggle switches — 60fps, hardware-accelerated

### Company, Team & Storage
- Company branding (color, currency, tax rate, address), branches
- Team management (invite, change roles) — admin/manager gated
- Cloud storage dashboard (R2 usage, file list, PDF upload endpoint)
- Email send (SES-ready, logs to D1; activates when SES secrets are set)

## 📡 Functional API Endpoints
### Auth (`/api/auth`)
- `POST /register` `{name,email,password,company_name?}`
- `POST /login` `{email,password,company_id?}`
- `POST /refresh` `{refresh_token,company_id?}`
- `POST /switch-company` `{company_id}` (auth)
- `GET /me` · `GET /sessions` · `POST /logout` · `POST /logout-all`

### Documents (`/api/documents`) — auth + company
- `GET /?type=&status=&q=` · `GET /:id`
- `POST /` (staff+) · `PUT /:id` (staff+) · `DELETE /:id` (manager+)

### Payments (`/api/payments`) — auth + company
- `GET /` · `GET /stats` · `POST /` (staff+) `{document_id?,method,amount,tendered?,reference?}`

### Companies (`/api/companies`) — auth
- `GET /current` · `PUT /current` (admin) · `POST /` (new company)
- `GET /members` (manager+) · `POST /members` (admin) · `PUT /members/:mid` (admin)
- `POST /branches` (manager+)

### Sync (`/api/sync`) — auth + company
- `GET /poll?since=` · `GET /stream?token=&since=` (SSE)

### Misc (`/api`) — auth + company
- `GET /dashboard` · `POST /email/send` (staff+) · `GET /email/logs` (manager+)
- `POST /storage/upload` (staff+) · `GET /storage/file/*` · `GET /storage/usage`
- `GET /health`

## Data Architecture
- **Storage**: Cloudflare **D1** (relational), **KV** (cache-ready), **R2** (PDF/object storage)
- **Models**: companies, branches, users, memberships (RBAC), sessions, documents, payments, email_logs, audit_logs, sync_events
- **Multi-tenant isolation**: every business row carries `company_id`; queries are scoped to the JWT's active company.

## User Guide
1. Open the app → Register or use the demo login.
2. **Dashboard**: revenue/due/counts, 7-day chart, recent activity, quick create.
3. Tap **Menu** (center logo) → New Document, Payments, Team, Storage, Company, Settings.
4. **Create**: pick type + template, fill fields, watch live preview, hit **Generate** → confetti + PDF download.
5. **Pay** an invoice from its detail sheet; status flips to Paid/Due automatically.
6. **Switch company** via the top-right company pill. **Toggle theme** with the sun/moon button.
7. Go **offline** → changes queue in IndexedDB and replay when you reconnect.

## ⚠️ Architecture Notes (Cloudflare Edge)
- **Real-time** uses SSE + polling. True persistent WebSockets on Cloudflare require **Durable Objects (Workers Paid)**; the client API is WS-equivalent and upgrades cleanly.
- **PDF** is generated client-side (jsPDF) — headless Chrome cannot run on the edge. Generated PDFs can be uploaded to R2 via `/api/storage/upload`.
- **Email** is SES-ready via HTTP SigV4 (Web Crypto); without secrets it logs sends. Set `SES_ACCESS_KEY`/`SES_SECRET_KEY`/`SES_REGION`/`SES_FROM` as secrets to activate.
- **Passwords** use PBKDF2-SHA256 (bcrypt/argon2 native binaries don't run on the edge).
- **PostgreSQL** requested → edge-native **D1 (SQLite)** is used. To use Postgres, swap the data layer for an HTTP driver (Neon/Supabase).

## 🚧 Not Yet Implemented / Next Steps
- Durable Objects WebSocket upgrade (Workers Paid) for sub-second push
- Live bKash/Nagad/Stripe payment gateway callbacks (currently tracked, not charged)
- SES SigV4 request signing body (scaffolded; needs secrets + final wiring)
- Server-side PDF rendering via Browser Rendering API
- Push notifications (Web Push), CSV/Excel export, advanced report builder

## Local Development
```bash
npm run build
npm run db:migrate:local && npm run db:seed   # first time
pm2 start ecosystem.config.cjs
curl http://localhost:3000/api/health
```

## Deployment
- **Platform**: Cloudflare Pages + Workers (D1/KV/R2)
- **Status**: ✅ Running locally (sandbox) · ⏳ Production deploy pending Cloudflare API key
- **Last Updated**: 2026-05-31
