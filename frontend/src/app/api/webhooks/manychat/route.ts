import { NextResponse } from 'next/server'
import { getBackendInternalUrl } from '@/shared/lib/backend-internal-url'

/** POST /api/webhooks/manychat — proxy al backend FastAPI (lógica real). */
export async function POST(request: Request) {
  try {
    const body = await request.text()
    const url = new URL(request.url)
    const target = `${getBackendInternalUrl()}/webhooks/manychat${url.search}`

    const headers = new Headers()
    const contentType = request.headers.get('content-type')
    if (contentType) headers.set('content-type', contentType)
    const webhookToken = request.headers.get('X-Webhook-Token')
    if (webhookToken) headers.set('X-Webhook-Token', webhookToken)

    const res = await fetch(target, { method: 'POST', headers, body })
    const text = await res.text()
    let data: unknown = text
    try {
      data = text ? JSON.parse(text) : {}
    } catch {
      data = { detail: text }
    }
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'manychat-webhook' })
}
