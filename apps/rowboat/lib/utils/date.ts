export function isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
        date.getMonth() === today.getMonth() &&
        date.getFullYear() === today.getFullYear();
}

export function isThisWeek(date: Date): boolean {
    const now = new Date();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + (6 - now.getDay()));
    return date >= weekStart && date <= weekEnd;
}

export function isThisMonth(date: Date): boolean {
    const now = new Date();
    return date.getMonth() === now.getMonth() &&
        date.getFullYear() === now.getFullYear();
}