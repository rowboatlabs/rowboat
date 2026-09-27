import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { HarnessSettings } from '@x/shared/src/code-mode'
import type { CodeAgentModelOptions } from '@x/shared/src/code-sessions'
import { Button } from './ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem } from './ui/dropdown-menu'
import { DropdownMenuTrigger } from './ui/dropdown-menu'
import { fetchCodeAgentOptions, withDefault } from './code/code-agent-options'
import { AGENT_LABEL, fetchCodeAgentsStatus, isAgentReady, type CodeAgentsStatus } from './code/code-agent-status'
import { toast } from 'sonner'

export function HarnessControls({ value, onChange }: { value: HarnessSettings; onChange: (value: HarnessSettings) => void | Promise<void> }) {
  const [options, setOptions] = useState<CodeAgentModelOptions>({ models: [], efforts: [] })
  const [status, setStatus] = useState<CodeAgentsStatus | null>(null)
  useEffect(() => {
    let cancelled = false
    setOptions({ models: [], efforts: [] })
    if (value.enabled) void fetchCodeAgentOptions(value.agent).then((result) => { if (!cancelled) setOptions(result) }).catch(() => {})
    return () => { cancelled = true }
  }, [value.agent, value.enabled])
  useEffect(() => {
    let cancelled = false
    void fetchCodeAgentsStatus().then((result) => { if (!cancelled) setStatus(result) }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const update = (patch: Partial<HarnessSettings>) => {
    void Promise.resolve(onChange({ ...value, ...patch })).catch((error) => toast.error(error instanceof Error ? error.message : 'Could not update Harness'))
  }
  return <div className="flex shrink-0 items-center gap-1.5">
    <Button type="button" variant={value.enabled ? 'secondary' : 'ghost'} size="sm" className="h-7 rounded-full text-xs" aria-pressed={value.enabled} onClick={() => update({ enabled: !value.enabled })}>Harness</Button>
    {value.enabled && <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="sm" className="h-7 gap-1 text-xs" aria-label="Harness agent settings">{AGENT_LABEL[value.agent]}<ChevronDown className="size-3" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 w-64 overflow-y-auto">
        <DropdownMenuLabel>Harness agent</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value.agent} onValueChange={(agent) => update({ agent: agent as HarnessSettings['agent'], model: undefined, effort: undefined })}>
          {(['claude', 'codex'] as const).map((agent) => <DropdownMenuRadioItem key={agent} value={agent} disabled={status !== null && !isAgentReady(status, agent)}>{AGENT_LABEL[agent]}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator /><DropdownMenuLabel>Harness model</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value.model ?? 'default'} onValueChange={(model) => update({ model })}>
          {withDefault(options.models).map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        {options.efforts.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Reasoning effort</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value.effort ?? 'default'} onValueChange={(effort) => update({ effort })}>
            {withDefault(options.efforts).map((option) => <DropdownMenuRadioItem key={option.value} value={option.value}>{option.label}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup></>}
        <DropdownMenuSeparator /><DropdownMenuLabel>Harness approvals</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={value.policy ?? 'default'} onValueChange={(policy) => update({ policy: policy === 'default' ? undefined : policy as HarnessSettings['policy'] })}>
          <DropdownMenuRadioItem value="default">Use default</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="ask">Ask every time</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="auto-approve-reads">Auto-approve reads</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="yolo">Auto-approve everything</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>}
  </div>
}
