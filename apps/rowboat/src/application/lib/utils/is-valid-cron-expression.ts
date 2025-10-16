const RANGE_SEPARATOR = "-";
const STEP_SEPARATOR = "/";

export function isValidCronExpression(cron: string): boolean {
    const parts = cron.trim().split(/\s+/);
    if (parts.length !== 5) {
        return false;
    }

    const [minute, hour, day, month, dayOfWeek] = parts;

    const validatePart = (part: string, max: number): boolean => {
        if (part === "*") {
            return true;
        }

        if (part.includes(STEP_SEPARATOR)) {
            const [range, step] = part.split(STEP_SEPARATOR);
            if (!step) {
                return false;
            }

            const stepValue = Number(step);
            if (!Number.isInteger(stepValue) || stepValue <= 0) {
                return false;
            }

            if (range === "*") {
                return stepValue <= max;
            }

            return validatePart(range, max);
        }

        if (part.includes(RANGE_SEPARATOR)) {
            const [start, end] = part.split(RANGE_SEPARATOR);
            if (start === undefined || end === undefined) {
                return false;
            }

            const startValue = Number(start);
            const endValue = Number(end);

            if (!Number.isInteger(startValue) || !Number.isInteger(endValue)) {
                return false;
            }

            if (startValue > endValue) {
                return false;
            }

            return startValue >= 0 && endValue <= max;
        }

        const value = Number(part);
        if (!Number.isInteger(value)) {
            return false;
        }

        return value >= 0 && value <= max;
    };

    return (
        validatePart(minute, 59) &&
        validatePart(hour, 23) &&
        validatePart(day, 31) &&
        validatePart(month, 12) &&
        validatePart(dayOfWeek, 7)
    );
}
