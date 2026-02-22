import { useState, useEffect, useCallback } from 'react';

export interface LlmModelOption {
    id: string
    name?: string
    release_date?: string
}

export function useModelsList() {
    const [modelsCatalog, setModelsCatalog] = useState<Record<string, LlmModelOption[]>>({})
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const fetchModels = useCallback(async () => {
        try {
            setIsLoading(true)
            setError(null)
            const result = await window.ipc.invoke("models:list", null)
            const catalog: Record<string, LlmModelOption[]> = {}
            for (const p of result.providers || []) {
                catalog[p.id] = p.models || []
            }
            setModelsCatalog(catalog)
        } catch {
            setError("Failed to load models list")
            setModelsCatalog({})
        } finally {
            setIsLoading(false)
        }
    }, [])

    useEffect(() => {
        fetchModels()
    }, [fetchModels])

    return { modelsCatalog, isLoading, error, refresh: fetchModels }
}
