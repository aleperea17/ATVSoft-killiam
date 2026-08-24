import { NextResponse } from 'next/server'

function expectedPassword(): string | null {
  const value = process.env.CALL_REPORTS_VIEW_PASSWORD?.trim()
  return value ? value : null
}

/** Fallback si no hay sesión contra CompanyConfig. Vacío = gate off en este route. */
export async function GET() {
  return NextResponse.json({ gateEnabled: Boolean(expectedPassword()) })
}

export async function POST(request: Request) {
  const expected = expectedPassword()
  if (!expected) {
    return NextResponse.json({ ok: true, gate: 'disabled' })
  }

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null
  const password = typeof body?.password === 'string' ? body.password.trim() : ''
  if (password !== expected) {
    return NextResponse.json({ error: 'Contraseña incorrecta.' }, { status: 401 })
  }
  return NextResponse.json({ ok: true })
}
