import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { errorText, fetchAll } from '../lib/data'

export function useQueryRows(table: string, select = '*', order?: string) {
  const [rows, setRows] = useState<any[]>([])
  const [error, setError] = useState('')
  const load = async () => {
    try {
      const data = await fetchAll(() => {
        let query: any = supabase.from(table).select(select)
        if (order) query = query.order(order, { ascending: false })
        return query
      })
      setRows(data)
      setError('')
    } catch (e) {
      setError(errorText(e))
    }
  }
  useEffect(() => { void load() }, [table, select, order])
  return { rows, load, error }
}

type Values = Record<string, any>

export function Field({ label, name, values, setValues, type = 'text', placeholder, required, hint, min, step, disabled }: {
  label: string
  name: string
  values: Values
  setValues: (values: Values) => void
  type?: string
  placeholder?: string
  required?: boolean
  hint?: string
  min?: number
  step?: string
  disabled?: boolean
}) {
  return <label><span>{label}{required && <i className="req"> *</i>}</span><input type={type} value={values[name] ?? ''} placeholder={placeholder} disabled={disabled}
    min={min} step={step ?? (type === 'number' ? 'any' : undefined)} inputMode={type === 'number' ? 'decimal' : undefined}
    onChange={event => setValues({ ...values, [name]: event.target.value })} />{hint && <small className="muted">{hint}</small>}</label>
}

export function TextArea({ label, name, values, setValues }: { label: string; name: string; values: Values; setValues: (values: Values) => void }) {
  return <label className="span-2">{label}<textarea rows={2} value={values[name] ?? ''}
    onChange={event => setValues({ ...values, [name]: event.target.value })} /></label>
}

export function SelectField({ label, name, values, setValues, options, required, placeholder = 'Select…', hint }: {
  label: string
  name: string
  values: Values
  setValues: (values: Values) => void
  options: Array<[string, string]>
  required?: boolean
  placeholder?: string | null
  hint?: string
}) {
  return <label><span>{label}{required && <i className="req"> *</i>}</span><select value={values[name] ?? ''}
    onChange={event => setValues({ ...values, [name]: event.target.value })}>
    {placeholder !== null && <option value="">{placeholder}</option>}
    {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
  </select>{hint && <small className="muted">{hint}</small>}</label>
}

export function ErrorMessage({ children }: { children?: string }) {
  return children ? <span className="er" role="alert">{children}</span> : null
}

export function SuccessMessage({ children }: { children?: string }) {
  return children ? <span className="ok" role="status">{children}</span> : null
}
