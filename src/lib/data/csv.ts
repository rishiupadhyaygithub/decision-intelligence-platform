// Minimal RFC 4180 CSV parser: quoted fields, escaped quotes (""), commas and
// newlines inside quotes, CRLF or LF line endings, optional UTF-8 BOM.
// Returns header-keyed records. No dependency: the import path is small and the
// format is fixed, so a 40-line parser beats pulling in a library.

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

export function parseCsv(input: string): ParsedCsv {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const records: string[][] = []
  let field = ''
  let record: string[] = []
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') inQuotes = true
    else if (c === ',') {
      record.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      record.push(field)
      records.push(record)
      record = []
      field = ''
    } else field += c
  }
  if (field !== '' || record.length) {
    record.push(field)
    records.push(record)
  }

  const nonEmpty = records.filter((r) => r.some((v) => v.trim() !== ''))
  if (!nonEmpty.length) return { headers: [], rows: [] }
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase())
  const rows = nonEmpty.slice(1).map((r) => {
    const row: Record<string, string> = {}
    headers.forEach((h, i) => (row[h] = (r[i] ?? '').trim()))
    return row
  })
  return { headers, rows }
}

// Serialize rows back to CSV (used by the export/backup endpoint).
export function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\n') + '\n'
}
