import { AppState } from 'react-native';
import type { SpacesLive } from '@x/spaces-client';

// Mobile availability follows the foreground app, independent of DND (2026-11-05).
export function reportMobileActivity(live: SpacesLive): () => void {
  const report = () => live.activity(AppState.currentState === 'active');
  const subscription = AppState.addEventListener('change', report);
  const timer = setInterval(report, 15_000);
  report();
  return () => { clearInterval(timer); subscription.remove(); live.activity(false); };
}
