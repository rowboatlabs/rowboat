export const isValidDate = (date: any): boolean => {
    const parsed = new Date(date);
    return parsed instanceof Date && !isNaN(parsed.getTime());
};