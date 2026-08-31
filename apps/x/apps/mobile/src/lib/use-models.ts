import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';

import { useConnection } from './connection';

// The model catalog + the user's pick. Same source as the desktop's picker
// (models:list). The pick persists per install; no pick = the server default.

export interface ModelChoice {
  provider: string;
  model: string;
  /** Display name (falls back to the model id). */
  name: string;
}

export interface ProviderModels {
  id: string;
  flavor: string;
  models: { id: string; name?: string }[];
}

const STORE_KEY = 'rowboat.model.v1';

export function useModels() {
  const { rpc } = useConnection();
  const [providers, setProviders] = useState<ProviderModels[]>([]);
  const [defaultChoice, setDefaultChoice] = useState<ModelChoice | null>(null);
  const [picked, setPicked] = useState<ModelChoice | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void SecureStore.getItemAsync(STORE_KEY).then((raw) => {
      setPicked(raw ? (JSON.parse(raw) as ModelChoice) : null);
    });
  }, []);

  const refresh = useCallback(async () => {
    if (!rpc) return;
    setLoading(true);
    try {
      const result = (await rpc.call('models:list', null)) as {
        providers: { id: string; flavor: string; status: string; models: { id: string; name?: string }[] }[];
        defaultModel: { provider: string; model: string } | null;
      };
      setProviders(
        result.providers
          .filter((p) => p.status === 'ok' && p.models.length > 0)
          .map((p) => ({ id: p.id, flavor: p.flavor, models: p.models })),
      );
      if (result.defaultModel) {
        const p = result.providers.find((x) => x.id === result.defaultModel!.provider);
        const m = p?.models.find((x) => x.id === result.defaultModel!.model);
        setDefaultChoice({
          provider: result.defaultModel.provider,
          model: result.defaultModel.model,
          name: m?.name ?? result.defaultModel.model,
        });
      }
    } finally {
      setLoading(false);
    }
  }, [rpc]);

  const pick = useCallback(async (choice: ModelChoice | null) => {
    setPicked(choice);
    if (choice) await SecureStore.setItemAsync(STORE_KEY, JSON.stringify(choice));
    else await SecureStore.deleteItemAsync(STORE_KEY);
  }, []);

  /** What to show on the pill and send with messages (null = server default). */
  const current = picked ?? null;
  const display = current ?? defaultChoice;

  return { providers, defaultChoice, current, display, pick, refresh, loading };
}
