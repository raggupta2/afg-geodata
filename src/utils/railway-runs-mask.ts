export const RAILWAY_OPERATING_DAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday"
] as const;

export type RailwayOperatingDay = typeof RAILWAY_OPERATING_DAYS[number];

/**
 * Weekly railway operating-day bit assignments.
 *
 * Bit 0 = Monday, bit 1 = Tuesday, bit 2 = Wednesday,
 * bit 3 = Thursday, bit 4 = Friday, bit 5 = Saturday,
 * and bit 6 = Sunday.
 */
export const RAILWAY_RUNS_MASK_BITS: Readonly<Record<RailwayOperatingDay, number>> = {
    monday: 1 << 0,
    tuesday: 1 << 1,
    wednesday: 1 << 2,
    thursday: 1 << 3,
    friday: 1 << 4,
    saturday: 1 << 5,
    sunday: 1 << 6
};

export const RAILWAY_RUNS_MASK_MIN = 0;
export const RAILWAY_RUNS_MASK_MAX = 127;

const assertValidRunsMask = (runsMask: number): void => {
    if (
        !Number.isInteger(runsMask) ||
        runsMask < RAILWAY_RUNS_MASK_MIN ||
        runsMask > RAILWAY_RUNS_MASK_MAX
    ) {
        throw new RangeError("runs_mask must be an integer between 0 and 127");
    }
};

export const encodeRailwayRunsMask = (
    days: Iterable<RailwayOperatingDay>
): number => {
    let runsMask = 0;
    for (const day of days) {
        const bit = RAILWAY_RUNS_MASK_BITS[day];
        if (bit === undefined) {
            throw new RangeError(`Unknown railway operating day: ${String(day)}`);
        }
        runsMask |= bit;
    }
    return runsMask;
};

export const decodeRailwayRunsMask = (
    runsMask: number
): RailwayOperatingDay[] => {
    assertValidRunsMask(runsMask);
    return RAILWAY_OPERATING_DAYS.filter(
        day => (runsMask & RAILWAY_RUNS_MASK_BITS[day]) !== 0
    );
};

export const railwayRunsOnDay = (
    runsMask: number,
    day: RailwayOperatingDay
): boolean => {
    assertValidRunsMask(runsMask);
    const bit = RAILWAY_RUNS_MASK_BITS[day];
    if (bit === undefined) {
        throw new RangeError(`Unknown railway operating day: ${String(day)}`);
    }
    return (runsMask & bit) !== 0;
};
