import * as React from "react"
import { Check, ChevronDown, Cpu } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useModelsList } from "@/hooks/useModelsList"
import { useActiveModel } from "@/hooks/useActiveModel"
import { toast } from "sonner"

export function QuickModelSelector() {
    const { modelsCatalog, isLoading } = useModelsList()
    const { modelName, flavor, refresh: refreshActiveModel } = useActiveModel()

    const handleSelectModel = async (providerId: string, modelId: string) => {
        try {
            const providerConfig = {
                provider: { flavor: providerId as "openai" | "anthropic" | "google" | "antigravity" | "ollama" | "openrouter" | "aigateway" | "openai-compatible" },
                model: modelId,
            }
            const result = await window.ipc.invoke("models:test", providerConfig)
            if (result.success) {
                await window.ipc.invoke("models:saveConfig", providerConfig)
                window.dispatchEvent(new Event('models-changed'))
                refreshActiveModel()
                toast.success(`Switched to ${modelId}`)
            } else {
                toast.error(result.error || `Failed to switch to ${modelId}`)
            }
        } catch {
            toast.error(`Error switching to ${modelId}`)
        }
    }

    // Define the ordered layout of providers
    const providers = [
        { id: 'openai', name: 'OpenAI' },
        { id: 'anthropic', name: 'Anthropic' },
        { id: 'google', name: 'Gemini' },
        { id: 'antigravity', name: 'Antigravity' },
        { id: 'ollama', name: 'Local' },
    ]

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button className="titlebar-no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors max-w-[150px]">
                    <Cpu className="size-3.5" />
                    <span className="truncate">{modelName || "Select Model"}</span>
                    <ChevronDown className="size-3 opacity-50" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[240px] max-h-[60vh] overflow-y-auto">
                {isLoading ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">Loading models...</div>
                ) : (
                    providers.map((p) => {
                        const models = modelsCatalog[p.id]
                        if (!models || models.length === 0) return null

                        return (
                            <React.Fragment key={p.id}>
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground">
                                        {p.name}
                                    </DropdownMenuLabel>
                                    {models.map((m) => {
                                        const isActive = flavor === p.id && modelName === m.id
                                        return (
                                            <DropdownMenuItem
                                                key={m.id}
                                                className="flex items-center justify-between text-xs cursor-pointer py-1.5"
                                                onClick={() => handleSelectModel(p.id, m.id)}
                                            >
                                                <span className="truncate pr-2">{m.name || m.id}</span>
                                                {isActive && <Check className="size-3.5 text-primary" />}
                                            </DropdownMenuItem>
                                        )
                                    })}
                                </DropdownMenuGroup>
                                <DropdownMenuSeparator />
                            </React.Fragment>
                        )
                    })
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
