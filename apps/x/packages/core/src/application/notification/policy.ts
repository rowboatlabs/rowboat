import type { UseCase } from '../../analytics/use_case.js';

const SUPPRESSED_RUN_USE_CASES = new Set<UseCase>([
    'background_task_agent',
    'knowledge_sync',
    'live_note_agent',
]);

export function shouldSuppressRunNotifications(
    useCase: UseCase | null | undefined,
    subUseCase?: string | null,
): boolean {
    if (subUseCase === 'scheduled') return true;
    return useCase ? SUPPRESSED_RUN_USE_CASES.has(useCase) : false;
}
