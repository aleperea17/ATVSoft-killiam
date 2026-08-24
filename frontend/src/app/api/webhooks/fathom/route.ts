import { NextResponse } from 'next/server'
import {
  verifyFathomWebhook,
  isTimestampValid,
  getExternalEmail,
  getCallDate,
  getFathomTranscript,
  type FathomWebhookPayload,
} from '@/features/leads/services/fathom-service'
import { analyzeTranscript } from '@/features/leads/services/fathom-transcript-analyzer'

function envOrNull(name: string): string | null {
  const value = process.env[name]?.trim()
  return value ? value : null
}

function missingEnvResponse(name: string) {
  return NextResponse.json(
    {
      error: `Falta la variable de entorno ${name}. Configurala en .env.local; no hay valor por defecto.`,
    },
    { status: 503 },
  )
}

export async function POST(request: Request) {
  try {
    const webhookSecret = envOrNull('FATHOM_WEBHOOK_SECRET')
    const fathomApiKey = envOrNull('FATHOM_API_KEY')
    if (!webhookSecret) return missingEnvResponse('FATHOM_WEBHOOK_SECRET')
    if (!fathomApiKey) return missingEnvResponse('FATHOM_API_KEY')

    const rawBody = await request.text()
    const webhookId = request.headers.get('webhook-id') || ''
    const webhookTimestamp = request.headers.get('webhook-timestamp') || ''
    const webhookSignature = request.headers.get('webhook-signature') || ''

    if (webhookId && webhookTimestamp && webhookSignature) {
      if (!isTimestampValid(webhookTimestamp)) {
        return NextResponse.json({ error: 'Timestamp too old' }, { status: 401 })
      }
      if (
        !verifyFathomWebhook(rawBody, webhookId, webhookTimestamp, webhookSignature, webhookSecret)
      ) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    }

    const payload: FathomWebhookPayload = JSON.parse(rawBody)

    if (!payload.url && !payload.share_url) {
      return NextResponse.json({ error: 'Invalid Fathom payload' }, { status: 400 })
    }

    const email = getExternalEmail(payload)
    const callDate = getCallDate(payload)
    const callLink = payload.share_url || payload.url

    console.log('[Fathom] email:', email, 'date:', callDate, 'link:', callLink)

    let transcript = ''
    if (payload.transcript?.length) {
      transcript = payload.transcript.map(t => `${t.speaker_name}: ${t.text}`).join('\n')
    } else {
      try {
        transcript = await getFathomTranscript(payload.url, fathomApiKey)
      } catch {
        return NextResponse.json({ success: true, lead_id: null, action: 'link_updated_no_transcript' })
      }
    }

    if (transcript) {
      const analysis = await analyzeTranscript(transcript)
      console.log('[Fathom] Analysis status:', analysis.status)
    }

    return NextResponse.json({ success: true, lead_id: null, action: 'fully_analyzed' })
  } catch {
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({ status: 'ok', service: 'fathom-webhook' })
}
