const BASE_URL = process.env.CONTRACT_TEST_BASE_URL ?? 'http://localhost:3000'

export interface ApiCallOpts {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  cookie?: string
  bearer?: string
}

export interface ApiResponse {
  status: number
  ok: boolean
  body: unknown
  text: string
  headers: Record<string, string>
}

export async function apiCall(path: string, opts: ApiCallOpts = {}): Promise<ApiResponse> {
  const { method = 'GET', body, headers = {}, cookie, bearer } = opts

  const reqHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  }
  if (body !== undefined) reqHeaders['Content-Type'] = 'application/json'
  if (cookie) reqHeaders.Cookie = cookie
  if (bearer) reqHeaders.Authorization = `Bearer ${bearer}`

  let res: Response
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: reqHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new Error(
      `Network error hitting ${BASE_URL}${path} — is dev server running? (npm run dev)\n${(e as Error).message}`,
    )
  }

  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = null
  }

  return {
    status: res.status,
    ok: res.ok,
    body: parsed,
    text,
    headers: Object.fromEntries(res.headers.entries()),
  }
}

export async function expectDevServerUp(): Promise<void> {
  try {
    const res = await fetch(BASE_URL, { method: 'HEAD' })
    if (res.status >= 500) {
      throw new Error(`Dev server returned ${res.status}`)
    }
  } catch {
    throw new Error(
      `Dev server not reachable at ${BASE_URL}.\n` +
        `Start it first: cd ~/Github/mandys_bubble_tea && npm run dev`,
    )
  }
}
