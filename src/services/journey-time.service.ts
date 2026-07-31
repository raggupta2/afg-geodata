export const RAILWAY_TIME_ZONE = "Asia/Kolkata";

type ZonedParts = {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
};

export type RailwaySearchClock = {
    requestedInstant: Date;
    requestedMinute: number;
    serviceDate: Date;
    serviceDayStartInstantMs: number;
};

const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: RAILWAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
});

function zonedParts(date: Date): ZonedParts {
    const values = Object.fromEntries(
        formatter.formatToParts(date)
            .filter(part => part.type !== "literal")
            .map(part => [part.type, Number(part.value)])
    );
    return values as ZonedParts;
}

export function createRailwaySearchClock(departureAt: string): RailwaySearchClock {
    const requestedInstant = new Date(departureAt);
    const parts = zonedParts(requestedInstant);
    const requestedMinute = parts.hour * 60 + parts.minute;
    const elapsedLocalMs = (
        requestedMinute * 60 + parts.second
    ) * 1000 + requestedInstant.getUTCMilliseconds();

    return {
        requestedInstant,
        requestedMinute,
        serviceDate: new Date(Date.UTC(parts.year, parts.month - 1, parts.day)),
        serviceDayStartInstantMs: requestedInstant.getTime() - elapsedLocalMs
    };
}

export function createRailwayDateSearchClock(
    departureDate: string
): RailwaySearchClock {
    return createRailwaySearchClock(
        `${departureDate}T00:00:00+05:30`
    );
}

export function minuteToInstant(
    clock: RailwaySearchClock,
    totalMinute: number
): Date {
    return new Date(clock.serviceDayStartInstantMs + totalMinute * 60_000);
}

export function formatRailwayDateTime(date: Date): string {
    const parts = zonedParts(date);
    const asUtc = Date.UTC(
        parts.year,
        parts.month - 1,
        parts.day,
        parts.hour,
        parts.minute,
        parts.second
    );
    const offsetMinutes = Math.round((asUtc - date.getTime()) / 60_000);
    const sign = offsetMinutes >= 0 ? "+" : "-";
    const absoluteOffset = Math.abs(offsetMinutes);
    const offsetHours = Math.floor(absoluteOffset / 60)
        .toString()
        .padStart(2, "0");
    const offsetRemainder = (absoluteOffset % 60)
        .toString()
        .padStart(2, "0");

    return [
        parts.year.toString().padStart(4, "0"),
        "-",
        parts.month.toString().padStart(2, "0"),
        "-",
        parts.day.toString().padStart(2, "0"),
        "T",
        parts.hour.toString().padStart(2, "0"),
        ":",
        parts.minute.toString().padStart(2, "0"),
        ":",
        parts.second.toString().padStart(2, "0"),
        sign,
        offsetHours,
        ":",
        offsetRemainder
    ].join("");
}
