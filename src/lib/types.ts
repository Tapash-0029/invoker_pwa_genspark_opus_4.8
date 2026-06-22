import type { JwtPayload } from './crypto'

export type Bindings = {
  DB: D1Database
  R2: R2Bucket
  JWT_SECRET: string
  APP_NAME: string
  SES_ACCESS_KEY?: string
  SES_SECRET_KEY?: string
  SES_REGION?: string
  SES_FROM?: string
}

export type Variables = {
  user: JwtPayload
}

export type AppEnv = { Bindings: Bindings; Variables: Variables }

export type Role = 'admin' | 'manager' | 'staff' | 'viewer'

// Role capability matrix
export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  staff: 2,
  manager: 3,
  admin: 4,
}

export function roleAtLeast(role: string | undefined, min: Role): boolean {
  if (!role) return false
  return (ROLE_RANK[role as Role] ?? 0) >= ROLE_RANK[min]
}
