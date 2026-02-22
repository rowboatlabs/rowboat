import { useState, useEffect, useCallback } from 'react';

export function useActiveModel() {
    const [modelName, setModelName] = useState<string | null>(null);
    const [flavor, setFlavor] = useState<string | null>(null);

    const fetchModel = useCallback(async () => {
        try {
            const result = await window.ipc.invoke("workspace:readFile", {
                path: "config/models.json",
            });
            const parsed = JSON.parse(result.data);
            if (parsed?.provider?.flavor && parsed?.model) {
                setFlavor(parsed.provider.flavor);
                setModelName(parsed.model);
            }
        } catch (e) {
            // Ignore
        }
    }, []);

    useEffect(() => {
        fetchModel();
        // Listen for custom event triggered by settings dialog
        const handleModelChange = () => fetchModel();
        window.addEventListener('models-changed', handleModelChange);
        return () => window.removeEventListener('models-changed', handleModelChange);
    }, [fetchModel]);

    return { modelName, flavor };
}
