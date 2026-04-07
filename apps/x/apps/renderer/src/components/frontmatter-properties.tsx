import { useState, useCallback, useRef, useEffect } from 'react'
import { ChevronRight, X, Plus } from 'lucide-react'
import { extractAllFrontmatterValues, buildFrontmatter } from '@/lib/frontmatter'

interface FrontmatterPropertiesProps {
  raw: string | null
  onRawChange: (raw: string | null) => void
  editable?: boolean
}

type FieldEntry = { key: string; value: string | string[] }

function fieldsFromRaw(raw: string | null): FieldEntry[] {
  const record = extractAllFrontmatterValues(raw)
  return Object.entries(record).map(([key, value]) => ({ key, value }))
}

function fieldsToRaw(fields: FieldEntry[]): string | null {
  const record: Record<string, string | string[]> = {}
  for (const { key, value } of fields) {
    if (key.trim()) record[key.trim()] = value
  }
  return buildFrontmatter(record)
}

export function FrontmatterProperties({ raw, onRawChange, editable = true }: FrontmatterPropertiesProps) {
  const [expanded, setExpanded] = useState(false)
  const [fields, setFields] = useState<FieldEntry[]>(() => fieldsFromRaw(raw))
  const [editingNewKey, setEditingNewKey] = useState(false)
  const newKeyRef = useRef<HTMLInputElement>(null)
  const lastCommittedRaw = useRef(raw)

  // Sync local fields when raw changes externally (e.g. tab switch)
  useEffect(() => {
    if (raw !== lastCommittedRaw.current) {
      setFields(fieldsFromRaw(raw))
      lastCommittedRaw.current = raw
    }
  }, [raw])

  useEffect(() => {
    if (editingNewKey && newKeyRef.current) {
      newKeyRef.current.focus()
    }
  }, [editingNewKey])

  const commit = useCallback((updated: FieldEntry[]) => {
    const newRaw = fieldsToRaw(updated)
    lastCommittedRaw.current = newRaw
    onRawChange(newRaw)
  }, [onRawChange])

  // For scalar fields: update local state immediately, commit on blur
  const updateLocalValue = useCallback((index: number, newValue: string) => {
    setFields(prev => {
      const next = [...prev]
      next[index] = { ...next[index], value: newValue }
      return next
    })
  }, [])

  const commitField = useCallback((_index: number) => {
    setFields(prev => {
      commit(prev)
      return prev
    })
  }, [commit])

  // For array fields and structural changes: update + commit immediately
  const updateAndCommit = useCallback((updater: (prev: FieldEntry[]) => FieldEntry[]) => {
    setFields(prev => {
      const next = updater(prev)
      commit(next)
      return next
    })
  }, [commit])

  const removeField = useCallback((index: number) => {
    updateAndCommit(prev => prev.filter((_, i) => i !== index))
  }, [updateAndCommit])

  const addField = useCallback((key: string) => {
    const trimmed = key.trim()
    if (!trimmed) return
    if (fields.some(f => f.key === trimmed)) return
    updateAndCommit(prev => [...prev, { key: trimmed, value: '' }])
    setEditingNewKey(false)
  }, [fields, updateAndCommit])

  const count = fields.length

  return (
    <div className="frontmatter-properties">
      <button
        className="frontmatter-toggle"
        onClick={() => setExpanded(!expanded)}
        type="button"
      >
        <ChevronRight
          size={14}
          className={`frontmatter-chevron ${expanded ? 'expanded' : ''}`}
        />
        <span className="frontmatter-label">
          Properties{count > 0 ? ` (${count})` : ''}
        </span>
      </button>

      {expanded && (
        <div className="frontmatter-fields">
          {fields.map((field, index) => (
            <div key={`${field.key}-${index}`} className="frontmatter-row">
              <span className="frontmatter-key" title={field.key}>
                {field.key}
              </span>
              <div className="frontmatter-value-area">
                {Array.isArray(field.value) ? (
                  <ArrayField
                    value={field.value}
                    editable={editable}
                    onChange={(v) => updateAndCommit(prev => {
                      const next = [...prev]
                      next[index] = { ...next[index], value: v }
                      return next
                    })}
                  />
                ) : (
                  <input
                    className="frontmatter-input"
                    value={field.value}
                    readOnly={!editable}
                    onChange={(e) => updateLocalValue(index, e.target.value)}
                    onBlur={() => commitField(index)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur()
                      }
                    }}
                  />
                )}
              </div>
              {editable && (
                <button
                  className="frontmatter-remove"
                  onClick={() => removeField(index)}
                  type="button"
                  title="Remove property"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          ))}

          {editable && (
            editingNewKey ? (
              <div className="frontmatter-row frontmatter-new-row">
                <input
                  ref={newKeyRef}
                  className="frontmatter-input frontmatter-new-key-input"
                  placeholder="Property name"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addField(e.currentTarget.value)
                    } else if (e.key === 'Escape') {
                      setEditingNewKey(false)
                    }
                  }}
                  onBlur={(e) => {
                    if (e.currentTarget.value.trim()) {
                      addField(e.currentTarget.value)
                    } else {
                      setEditingNewKey(false)
                    }
                  }}
                />
              </div>
            ) : (
              <button
                className="frontmatter-add"
                onClick={() => setEditingNewKey(true)}
                type="button"
              >
                <Plus size={12} />
                <span>Add property</span>
              </button>
            )
          )}
        </div>
      )}
    </div>
  )
}

function ArrayField({
  value,
  editable,
  onChange,
}: {
  value: string[]
  editable: boolean
  onChange: (v: string[]) => void
}) {
  const removeItem = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const addItem = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) return
    onChange([...value, trimmed])
  }

  return (
    <div className="frontmatter-array">
      {value.map((item, i) => (
        <span key={i} className="frontmatter-chip">
          <span className="frontmatter-chip-text">{item}</span>
          {editable && (
            <button
              className="frontmatter-chip-remove"
              onClick={() => removeItem(i)}
              type="button"
            >
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {editable && (
        <input
          className="frontmatter-chip-input"
          placeholder="Add..."
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault()
              addItem(e.currentTarget.value)
              e.currentTarget.value = ''
            } else if (e.key === 'Backspace' && !e.currentTarget.value && value.length > 0) {
              removeItem(value.length - 1)
            }
          }}
          onBlur={(e) => {
            if (e.currentTarget.value.trim()) {
              addItem(e.currentTarget.value)
              e.currentTarget.value = ''
            }
          }}
        />
      )}
    </div>
  )
}
