import * as React from "react"
import { Check, ChevronDown, Cpu, Loader2 } from "lucide-react"
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
import { useOAuthState } from "@/hooks/useOAuthState"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

function ConnectionDot({ connected }: { connected: boolean }) {
    return (
        <span
            className={cn(
                "inline-block size-1.5 rounded-full shrink-0",
                connected
                    ? "bg-emerald-500 shadow-[0_0_3px_rgba(16,185,129,0.5)]"
                    : "bg-red-500/60"
            )}
        />
    )
}

export function QuickModelSelector() {
    const { modelsCatalog, isLoading } = useModelsList()
    const { modelName, flavor, refresh: refreshActiveModel } = useActiveModel()
    const { isConnected, supportsOAuth } = useOAuthState()
    const [switching, setSwitching] = React.useState<string | null>(null)

    const handleSelectModel = async (providerId: string, modelId: string) => {
        // Already active — nothing to do
        if (flavor === providerId && modelName === modelId) return

        setSwitching(modelId)
        try {
            const providerConfig = {
                provider: { flavor: providerId as "openai" | "anthropic" | "google" | "antigravity" | "ollama" | "openrouter" | "aigateway" | "openai-compatible" },
                model: modelId,
            }

            // For OAuth-connected providers, skip the test — just save directly
            // This makes model switching instant for trusted providers
            const hasOAuth = supportsOAuth(providerId) && isConnected(providerId)

            if (hasOAuth) {
                await window.ipc.invoke("models:saveConfig", providerConfig)
                window.dispatchEvent(new Event('models-changed'))
                refreshActiveModel()
                toast.success(`Switched to ${modelId}`)
            } else {
                // For API-key providers or unconnected OAuth providers, test first
                const result = await window.ipc.invoke("models:test", providerConfig)
                if (result.success) {
                    await window.ipc.invoke("models:saveConfig", providerConfig)
                    window.dispatchEvent(new Event('models-changed'))
                    refreshActiveModel()
                    toast.success(`Switched to ${modelId}`)
                } else {
                    toast.error(result.error || `Failed to switch to ${modelId}`)
                }
            }
        } catch {
            toast.error(`Error switching to ${modelId}`)
        } finally {
            setSwitching(null)
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

    // Check which provider is currently connected
    const currentConnected = flavor ? (supportsOAuth(flavor) ? isConnected(flavor) : true) : false

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button className="titlebar-no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors max-w-[180px]">
                    <Cpu className="size-3.5 shrink-0" />
                    <span className="truncate">{modelName || "Select Model"}</span>
                    {flavor && (
                        <ConnectionDot connected={currentConnected} />
                    )}
                    <ChevronDown className="size-3 opacity-50 shrink-0" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[260px] max-h-[60vh] overflow-y-auto">
                {isLoading ? (
                    <div className="p-4 text-center text-xs text-muted-foreground">Loading models...</div>
                ) : (
                    providers.map((p) => {
                        const models = modelsCatalog[p.id]
                        if (!models || models.length === 0) return null

                        const providerConnected = supportsOAuth(p.id) ? isConnected(p.id) : true

                        return (
                            <React.Fragment key={p.id}>
                                <DropdownMenuGroup>
                                    <DropdownMenuLabel className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                        <ConnectionDot connected={providerConnected} />
                                        {p.name}
                                        {!providerConnected && (
                                            <span className="text-[10px] font-normal normal-case text-amber-500 ml-auto">
                                                Not connected
                                            </span>
                                        )}
                                    </DropdownMenuLabel>
                                    {models.map((m) => {
                                        const isActive = flavor === p.id && modelName === m.id
                                        const isSwitching = switching === m.id
                                        return (
                                            <DropdownMenuItem
                                                key={m.id}
                                                className={cn(
                                                    "flex items-center justify-between text-xs cursor-pointer py-1.5",
                                                    !providerConnected && "opacity-60"
                                                )}
                                                onClick={() => handleSelectModel(p.id, m.id)}
                                                disabled={isSwitching}
                                            >
                                                <span className="truncate pr-2">{m.name || m.id}</span>
                                                {isSwitching ? (
                                                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                                                ) : isActive ? (
                                                    <Check className="size-3.5 text-primary" />
                                                ) : null}
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
