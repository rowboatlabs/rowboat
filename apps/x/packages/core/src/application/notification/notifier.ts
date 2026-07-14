import type { NotificationCategory } from '@x/shared/dist/notification-settings.js';
import { isNotificationCategoryEnabled } from '../../config/notification_config.js';
import type { INotificationService, NotifyInput } from './service.js';

/**
 * Fire a notification for `category`, but only if the user has that category
 * enabled and the platform supports notifications.
 *
 * Resolution of the notification service is done via a *dynamic* import of the
 * DI container so that callers like the agent runtime — which the container
 * itself imports — don't create a circular module dependency. The whole thing
 * is wrapped so a missing service (very early startup), an unsupported
 * platform, or a config read error can never disrupt the run/sync that
 * triggered it. Callers should fire-and-forget (`void notifyIfEnabled(...)`).
 */
export async function notifyIfEnabled(
    category: NotificationCategory,
    input: NotifyInput,
): Promise<void> {
    try {
        if (!isNotificationCategoryEnabled(category)) return;
        const { lazyResolve } = await import('../../di/lazy-resolve.js');
        const service = await lazyResolve<INotificationService>('notificationService');
        if (!service.isSupported()) return;
        service.notify(input);
    } catch (err) {
        console.error(`[notifier] failed to notify (category=${category}):`, err);
    }
}
