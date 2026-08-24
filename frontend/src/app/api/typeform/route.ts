import { NextResponse } from 'next/server'

const EMPTY = {
  total: 0,
  totalAll: 0,
  avgConviction: 0,
  programs: [] as string[],
  data: {} as Record<string, { label: string; count: number }[]>,
}

function parseFieldMap(): Record<string, string> {
  const raw = process.env.TYPEFORM_FIELD_MAP?.trim()
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim()
    }
    return out
  } catch {
    return {}
  }
}

function knownPrograms(): string[] {
  const raw = process.env.TYPEFORM_PROGRAMS?.trim()
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

// GET /api/typeform?month=2026-03&programa=Nombre
export async function GET(request: Request) {
  const token = process.env.TYPEFORM_API_KEY?.trim()
  const formId = process.env.TYPEFORM_FORM_ID?.trim()
  if (!token || !formId) {
    return NextResponse.json(EMPTY)
  }

  const url = new URL(request.url)
  const month = url.searchParams.get('month')
  const programaFilter = url.searchParams.get('programa')
  const fieldMap = parseFieldMap()
  const catalog = knownPrograms()
  const convictionFieldId = process.env.TYPEFORM_CONVICTION_FIELD_ID?.trim() || ''

  try {
    let apiUrl = `https://api.typeform.com/forms/${formId}/responses?page_size=200`
    if (month) {
      const [y, m] = month.split('-').map(Number)
      const since = new Date(y, m - 1, 1).toISOString()
      const until = new Date(y, m, 0, 23, 59, 59).toISOString()
      apiUrl += `&since=${since}&until=${until}`
    }

    const res = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) return NextResponse.json({ error: 'Typeform API error' }, { status: 500 })
    const data = await res.json()

    const counts: Record<string, Record<string, number>> = {}
    for (const key of Object.values(fieldMap)) counts[key] = {}

    const convictionScores: number[] = []
    const programsFound = new Set<string>()
    let filteredTotal = 0

    const matchesCatalog = (label: string) => {
      if (catalog.length === 0) return false
      const low = label.toLowerCase()
      return catalog.some((p) => low.includes(p.toLowerCase()))
    }

    for (const item of data.items || []) {
      let responseProgram: string | null = null
      for (const ans of item.answers || []) {
        if (ans.type === 'choice') {
          const label = ans.choice?.label || ''
          if (matchesCatalog(label)) {
            responseProgram = label
            programsFound.add(label)
          }
        }
      }

      if (programaFilter && responseProgram !== programaFilter) continue
      filteredTotal++

      for (const ans of item.answers || []) {
        if (convictionFieldId && ans.field?.id === convictionFieldId && ans.type === 'number') {
          convictionScores.push(Number(ans.number) || 0)
          continue
        }

        const key = fieldMap[ans.field?.id]
        if (!key) continue
        if (ans.type === 'choice') {
          const label = ans.choice?.label || ''
          if (label) counts[key][label] = (counts[key][label] || 0) + 1
        } else if (ans.type === 'choices') {
          for (const c of (ans.choices?.labels || [])) {
            if (c) counts[key][c] = (counts[key][c] || 0) + 1
          }
        }
      }
    }

    if (programaFilter) {
      for (const item of data.items || []) {
        for (const ans of item.answers || []) {
          if (ans.type === 'choice') {
            const label = ans.choice?.label || ''
            if (matchesCatalog(label)) programsFound.add(label)
          }
        }
      }
    }

    const result: Record<string, { label: string; count: number }[]> = {}
    for (const [key, val] of Object.entries(counts)) {
      result[key] = Object.entries(val).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count)
    }

    const avgConviction = convictionScores.length > 0
      ? Math.round((convictionScores.reduce((s, v) => s + v, 0) / convictionScores.length) * 10) / 10
      : 0

    return NextResponse.json({
      total: filteredTotal,
      totalAll: data.items?.length || 0,
      avgConviction,
      programs: Array.from(programsFound).sort(),
      data: result,
    })
  } catch (e) {
    return NextResponse.json({ error: `Typeform error: ${(e as Error).message}` }, { status: 500 })
  }
}
