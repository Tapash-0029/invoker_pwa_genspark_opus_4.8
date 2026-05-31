// Edge-safe cryptography using Web Crypto API (no Node native deps).
// Password hashing: PBKDF2-SHA256. JWT: HS256.

const enc = new TextEncoder()
const dec = new TextDecoder()

function bufToB64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let str = ''
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i])
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function b64UrlToBuf(b64: string): Uint8Array {
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/')
  while (b64.length % 4) b64 += '='
  const str = atob(b64)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i)
  return bytes
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16)
  return out
}

const PBKDF2_ITERS = 100_000

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
    key,
    256
  )
  return `pbkdf2$${PBKDF2_ITERS}$${toHex(salt.buffer)}$${toHex(bits)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [scheme, itersStr, saltHex, hashHex] = stored.split('$')
    if (scheme !== 'pbkdf2') return false
    const iters = parseInt(itersStr, 10)
    const salt = fromHex(saltHex)
    const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt, iterations: iters, hash: 'SHA-256' },
      key,
      256
    )
    const computed = toHex(bits)
    // constant-time-ish compare
    if (computed.length !== hashHex.length) return false
    let diff = 0
    for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hashHex.charCodeAt(i)
    return diff === 0
  } catch {
    return false
  }
}

// ---------------- JWT (HS256) ----------------
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export interface JwtPayload {
  sub: string // user id
  email: string
  name: string
  cid?: string // active company id
  role?: string // active role
  type?: 'access' | 'refresh'
  iat: number
  exp: number
  [k: string]: unknown
}

export async function signJwt(payload: Omit<JwtPayload, 'iat' | 'exp'>, secret: string, ttlSeconds: number): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' }
  const now = Math.floor(Date.now() / 1000)
  const full = { ...payload, iat: now, exp: now + ttlSeconds }
  const h = bufToB64Url(enc.encode(JSON.stringify(header)))
  const p = bufToB64Url(enc.encode(JSON.stringify(full)))
  const data = `${h}.${p}`
  const key = await hmacKey(secret)
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return `${data}.${bufToB64Url(sig)}`
}

export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const [h, p, s] = token.split('.')
    if (!h || !p || !s) return null
    const key = await hmacKey(secret)
    const valid = await crypto.subtle.verify('HMAC', key, b64UrlToBuf(s), enc.encode(`${h}.${p}`))
    if (!valid) return null
    const payload = JSON.parse(dec.decode(b64UrlToBuf(p))) as JwtPayload
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}

export function uid(prefix = ''): string {
  return (prefix ? prefix + '_' : '') + crypto.randomUUID().replace(/-/g, '').slice(0, 20)
}

export function randomToken(): string {
  return bufToB64Url(crypto.getRandomValues(new Uint8Array(32)))
}
