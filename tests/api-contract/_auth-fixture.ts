import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

export const supabaseAvailable = Boolean(url && serviceRole && anonKey)

export interface TestUser {
  email: string
  password: string
  userId: string
  accessToken: string
  cookieHeader: string
  cleanup: () => Promise<void>
}

export async function createTestUser(): Promise<TestUser> {
  if (!supabaseAvailable) {
    throw new Error(
      'Supabase env not loaded — need NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local',
    )
  }

  const admin = createClient(url!, serviceRole!, { auth: { persistSession: false } })
  const anon = createClient(url!, anonKey!, { auth: { persistSession: false } })

  const stamp = Date.now()
  const email = `test+contract-${stamp}@mandystest.local`
  const password = `pwd-${stamp}-${Math.random().toString(36).slice(2, 10)}`

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (createErr || !created.user) {
    throw new Error(`createUser failed: ${createErr?.message}`)
  }
  const userId = created.user.id

  const { data: session, error: signErr } = await anon.auth.signInWithPassword({ email, password })
  if (signErr || !session.session) {
    await admin.auth.admin.deleteUser(userId).catch(() => undefined)
    throw new Error(`signInWithPassword failed: ${signErr?.message}`)
  }
  const accessToken = session.session.access_token

  const projectRef = url!.match(/https:\/\/(.+?)\.supabase\.co/)?.[1] ?? 'unknown'
  const cookieName = `sb-${projectRef}-auth-token`
  const cookieValue = JSON.stringify([
    session.session.access_token,
    session.session.refresh_token,
    null,
    null,
    null,
  ])
  const cookieHeader = `${cookieName}=${encodeURIComponent(cookieValue)}`

  return {
    email,
    password,
    userId,
    accessToken,
    cookieHeader,
    cleanup: async () => {
      await admin.auth.admin.deleteUser(userId).catch(() => undefined)
    },
  }
}
