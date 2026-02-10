export const MAX_EVENT_ITEMS = 50;

export function limitEventItems(items: string[], max: number = MAX_EVENT_ITEMS): { items: string[]; truncated: boolean } {
    if (items.length <= max) {
        return { items, truncated: false };
    }
    return { items: items.slice(0, max), truncated: true };
}
