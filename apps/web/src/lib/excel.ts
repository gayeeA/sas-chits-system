import { COMPANY } from '../chit'
import { Column, downloadFile } from './data'

/** SheetJS is loaded only when someone exports or imports, keeping the app itself small. */
const loadXlsx = () => import('xlsx')

// Indian digit grouping: 1,23,45,678.00
const RUPEE_FORMAT = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00'
/** Columns labelled "... (₹)" hold rupee amounts and are written as numbers. */
const isMoney = (label: string) => label.endsWith('(₹)')

export type Sheet<T = any> = { name: string; rows: T[]; columns: Column<T>[] }

function cellValue(label: string, v: unknown) {
  if (v == null || v === '') return null
  if (isMoney(label)) {
    const n = Number(v)
    return Number.isFinite(n) ? n : v
  }
  return v
}

export async function downloadXlsx(filename: string, sheets: Sheet[]) {
  const XLSX = await loadXlsx()
  const book = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const header = sheet.columns.map(c => c.label)
    const data = sheet.rows.map(r => sheet.columns.map(c => cellValue(c.label, c.value(r))))
    const ws = XLSX.utils.aoa_to_sheet([header, ...data])
    sheet.columns.forEach((c, ci) => {
      if (!isMoney(c.label)) return
      for (let ri = 1; ri <= data.length; ri++) {
        const cell = ws[XLSX.utils.encode_cell({ r: ri, c: ci })]
        if (cell && cell.t === 'n') cell.z = RUPEE_FORMAT
      }
    })
    ws['!cols'] = header.map((h, ci) => ({
      wch: Math.min(40, Math.max(h.length, ...data.slice(0, 200).map(r => String(r[ci] ?? '').length)) + 2),
    }))
    ws['!freeze'] = { xSplit: 0, ySplit: 1 }
    // Sheet names: max 31 chars, no []:*?/\
    XLSX.utils.book_append_sheet(book, ws, sheet.name.replace(/[[\]:*?/\\]/g, ' ').slice(0, 31) || 'Sheet')
  }
  XLSX.writeFile(book, filename.endsWith('.xlsx') ? filename : filename + '.xlsx', { compression: true })
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } as any)[c])
const inr = (n: number) => '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** A Word document (Word opens HTML saved as .doc), with a heading, the table and totals for rupee columns. */
export function downloadWord<T>(filename: string, title: string, subtitle: string, rows: T[], columns: Column<T>[]) {
  const values = rows.map(r => columns.map(c => c.value(r)))
  const totals = columns.map((c, ci) => isMoney(c.label) ? values.reduce((s, r) => s + (Number(r[ci]) || 0), 0) : null)
  const cell = (label: string, v: unknown) => isMoney(label) && v !== '' && v != null && Number.isFinite(Number(v))
    ? `<td style="text-align:right">${inr(Number(v))}</td>` : `<td>${esc(v)}</td>`
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8">
<style>@page{size:A4 landscape;margin:1.5cm}body{font-family:Arial,sans-serif;font-size:10pt}h1{font-size:15pt;color:#2B1A6B;margin:0}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:3px 5px;font-size:9pt}th{background:#eee}tfoot td{font-weight:bold}</style></head><body>
<p><b>${esc(COMPANY.name)}</b><br><small>${esc(COMPANY.addr)}</small></p><h1>${esc(title)}</h1><p>${esc(subtitle)}</p>
<table><thead><tr>${columns.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead>
<tbody>${values.map(r => `<tr>${r.map((v, ci) => cell(columns[ci].label, v)).join('')}</tr>`).join('')}</tbody>
${totals.some(t => t != null) ? `<tfoot><tr>${totals.map((t, ci) => ci === 0 ? `<td>Total (${rows.length})</td>` : t != null ? `<td style="text-align:right">${inr(t)}</td>` : '<td></td>').join('')}</tr></tfoot>` : ''}
</table></body></html>`
  downloadFile(filename.endsWith('.doc') ? filename : filename + '.doc', '﻿' + html, 'application/msword')
}

/** Reads the first sheet of an .xlsx/.xls/.csv file into header names + row objects (dates come back as Date). */
export async function readSheet(file: File): Promise<{ headers: string[]; rows: Record<string, unknown>[] }> {
  const XLSX = await loadXlsx()
  const book = XLSX.read(await file.arrayBuffer(), { cellDates: true })
  const ws = book.Sheets[book.SheetNames[0]]
  if (!ws) return { headers: [], rows: [] }
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, blankrows: false, raw: true })
  const headerIndex = matrix.findIndex(r => (r ?? []).filter(v => v != null && String(v).trim()).length >= 1)
  if (headerIndex < 0) return { headers: [], rows: [] }
  const headers = (matrix[headerIndex] as unknown[]).map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`)
  const rows = matrix.slice(headerIndex + 1)
    .filter(r => (r ?? []).some(v => v != null && String(v).trim() !== ''))
    .map(r => Object.fromEntries(headers.map((h, i) => [h, (r as unknown[])[i] ?? null])))
  return { headers, rows }
}
