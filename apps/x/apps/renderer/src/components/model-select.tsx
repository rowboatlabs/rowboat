import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { modelKey, parseModelKey, type ModelOption } from '@/hooks/use-model-options'

// Pure renderer for a model picker: options come in via props (load them
// with useModelOptions), the value is a "provider::model" key or "" for
// the default. No data loading in here — that keeps this testable-by-hook
// and reusable across every model-selector surface.

export const providerDisplayNames: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Gemini',
  ollama: 'Ollama',
  openrouter: 'OpenRouter',
  aigateway: 'AI Gateway',
  'openai-compatible': 'OpenAI-Compatible',
  rowboat: 'Rowboat',
}

export function ModelSelect({
  label,
  value,
  onChange,
  options,
  defaultLabel,
  labelClassName = 'text-sm font-medium',
}: {
  label: string
  // "provider::model" key, or "" meaning the default choice.
  value: string
  onChange: (key: string) => void
  options: ModelOption[]
  // What "" means on this surface (e.g. "Rowboat default", "Same as
  // conversation model").
  defaultLabel: string
  labelClassName?: string
}) {
  // A configured value can reference a model outside the options list
  // (tier set on another surface, model dropped from the catalog). Render
  // it as a selectable item instead of a blank control.
  const valueInOptions = !value || options.some((o) => modelKey(o.provider, o.model) === value)
  const currentRef = !valueInOptions ? parseModelKey(value) : null

  return (
    <div className="space-y-2">
      <label className={labelClassName}>{label}</label>
      <Select value={value || '__default__'} onValueChange={(v) => onChange(v === '__default__' ? '' : v)}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={defaultLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">{defaultLabel}</SelectItem>
          {currentRef && (
            <SelectItem value={value}>
              {currentRef.model}
              <span className="ml-2 text-xs text-muted-foreground">
                {providerDisplayNames[currentRef.provider] || currentRef.provider}
              </span>
            </SelectItem>
          )}
          {options.map((o) => {
            const key = modelKey(o.provider, o.model)
            return (
              <SelectItem key={key} value={key}>
                {o.label}
                <span className="ml-2 text-xs text-muted-foreground">
                  {providerDisplayNames[o.provider] || o.provider}
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
    </div>
  )
}
