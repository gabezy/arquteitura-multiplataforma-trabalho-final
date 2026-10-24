// A calendar day written as YYYY-MM-DD, read as the start of that day in UTC. Null when the text is not a real
// day: one that rolls over (February 30) or that carries more than the date does not read back as the same text.
export function parseDay(value: string): Date | null {
    const day = new Date(`${value}T00:00:00Z`);

    if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== value) {
        return null;
    }
    return day;
}
