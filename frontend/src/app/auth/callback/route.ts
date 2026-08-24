import { NextResponse } from 'next/server'

/** OAuth legacy: la app usa login JWT en FastAPI. Redirige al destino seguro. */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const next = searchParams.get('next') ?? '/sales-dashboard'
  const safe = next.startsWith('/') && !next.startsWith('//') ? next : '/sales-dashboard'
  return NextResponse.redirect(`${origin}${safe}`)
}
