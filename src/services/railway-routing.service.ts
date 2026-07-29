import { logger } from "../config/logger";
import { ApiError } from "../errors/api.error";
import {
    findJourneyConnections,
    findJourneyStationByCode,
    ResolvedJourneyStation
} from "../repositories/railway-routing.repository";
import {
    JourneyConnection,
    JourneyStation,
    RailwayJourney,
    RailwayJourneyLeg
} from "../types/railway-journey";
import {
    railwayRunsOnDay,
    RailwayOperatingDay
} from "../utils/railway-runs-mask";

type JourneyPath = {
    connection: JourneyConnection;
    previous: JourneyPath | null;
};

const MINUTES_PER_DAY = 24 * 60;
const WEEKDAYS: RailwayOperatingDay[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday"
];

async function resolveStation(code: string): Promise<ResolvedJourneyStation> {
    const station = await findJourneyStationByCode(code);
    if (!station) {
        throw new ApiError(404, `Railway station code '${code}' was not found.`);
    }
    return station;
}

function parseDate(date: string): Date {
    const [year, month, day] = date.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day));
}

function addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setUTCDate(result.getUTCDate() + days);
    return result;
}

function operatingDay(date: Date): RailwayOperatingDay {
    return WEEKDAYS[date.getUTCDay()];
}

function timeToMinute(time: string): number {
    const [hours, minutes] = time.split(":").map(Number);
    return hours * 60 + minutes;
}

function directTrainRunsOnDate(
    runsMask: number,
    requestedDate: Date,
    departureMinute: number
): boolean {
    const originDayOffset = Math.floor(departureMinute / MINUTES_PER_DAY);
    const trainOriginDate = addDays(requestedDate, -originDayOffset);
    return railwayRunsOnDay(runsMask, operatingDay(trainOriginDate));
}

function findDirectJourney(
    connections: JourneyConnection[],
    departureStationId: string,
    arrivalStationId: string,
    requestedDate: Date,
    requestedMinute: number
): JourneyConnection[] | null {
    const byTrain = new Map<string, JourneyConnection[]>();
    for (const connection of connections) {
        const trainConnections = byTrain.get(connection.trainId) ?? [];
        trainConnections.push(connection);
        byTrain.set(connection.trainId, trainConnections);
    }

   

    let bestJourney: JourneyConnection[] | null = null;
    for (const trainConnections of byTrain.values()) {
        trainConnections.sort((left, right) => left.sequence - right.sequence);

        for (let startIndex = 0; startIndex < trainConnections.length; startIndex += 1) {
            const first = trainConnections[startIndex];
            const departureMinuteOfDay = first.departureMinute % MINUTES_PER_DAY;

     

            if (
                first.fromStation.id !== departureStationId
                || !first.boardingAllowed
                || departureMinuteOfDay < requestedMinute
                || !directTrainRunsOnDate(
                    first.runsMask,
                    requestedDate,
                    first.departureMinute
                )
            ) {
                continue;
            }


            const serviceDayShift = Math.floor(
                first.departureMinute / MINUTES_PER_DAY
            ) * MINUTES_PER_DAY;
            const candidate: JourneyConnection[] = [];

            for (let index = startIndex; index < trainConnections.length; index += 1) {
                const connection = trainConnections[index];
                const previous = candidate[candidate.length - 1];
                if (
                    previous
                    && (
                        previous.sequence + 1 !== connection.sequence
                        || previous.toStation.id !== connection.fromStation.id
                    )
                ) {
                    break;
                }

                candidate.push({
                    ...connection,
                    departureMinute: connection.departureMinute - serviceDayShift,
                    arrivalMinute: connection.arrivalMinute - serviceDayShift
                });

                if (connection.toStation.id !== arrivalStationId) continue;
                if (!connection.alightingAllowed) break;

                const candidateArrival = candidate[candidate.length - 1].arrivalMinute;
                const bestArrival = bestJourney?.[bestJourney.length - 1].arrivalMinute;
                if (bestArrival === undefined || candidateArrival < bestArrival) {
                    bestJourney = candidate;
                }
                break;
            }
        }
    }

    return bestJourney;
}

function scanConnections(
    connections: JourneyConnection[],
    departureStationId: string,
    arrivalStationId: string,
    requestedMinute: number
): JourneyConnection[] | null {
    const earliestArrival = new Map<string, number>([
        [departureStationId, requestedMinute]
    ]);
    const stationPaths = new Map<string, JourneyPath>();
    const trainPaths = new Map<string, JourneyPath>();

    for (const connection of connections) {
        const arrivalAtDepartureStation = earliestArrival.get(
            connection.fromStation.id
        );
        const existingTrainPath = trainPaths.get(connection.trainId);
        const continuesOnTrain = existingTrainPath !== undefined
            && existingTrainPath.connection.sequence + 1 === connection.sequence
            && existingTrainPath.connection.toStation.id === connection.fromStation.id;
        const canBoard = connection.boardingAllowed
            && arrivalAtDepartureStation !== undefined
            && arrivalAtDepartureStation <= connection.departureMinute;

        if (!continuesOnTrain && !canBoard) continue;

        const path: JourneyPath = {
            connection,
            previous: continuesOnTrain
                ? existingTrainPath
                : stationPaths.get(connection.fromStation.id) ?? null
        };
        trainPaths.set(connection.trainId, path);

        if (!connection.alightingAllowed) continue;

        const knownArrival = earliestArrival.get(connection.toStation.id);
        if (knownArrival !== undefined && knownArrival <= connection.arrivalMinute) {
            continue;
        }

        earliestArrival.set(connection.toStation.id, connection.arrivalMinute);
        stationPaths.set(connection.toStation.id, path);
    }

    const destinationPath = stationPaths.get(arrivalStationId);
    if (!destinationPath) return null;

    const journey: JourneyConnection[] = [];
    let current: JourneyPath | null = destinationPath;
    while (current) {
        journey.push(current.connection);
        current = current.previous;
    }

    return journey.reverse();
}

function formatServiceTime(totalMinutes: number): string {
    const minuteOfDay = totalMinutes % MINUTES_PER_DAY;
    const hours = Math.floor(minuteOfDay / 60);
    const minutes = minuteOfDay % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:00`;
}

function formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

function formatDateTime(searchDate: Date, totalMinutes: number): string {
    const date = addDays(searchDate, Math.floor(totalMinutes / MINUTES_PER_DAY));
    return `${formatDate(date)}T${formatServiceTime(totalMinutes)}`;
}

function buildLeg(
    connections: JourneyConnection[],
    searchDate: Date
): RailwayJourneyLeg {
    const first = connections[0];
    const last = connections[connections.length - 1];

    return {
        trainNumber: first.trainNumber,
        trainName: first.trainName,
        departureStation: first.fromStation,
        arrivalStation: last.toStation,
        departureTime: formatServiceTime(first.departureMinute),
        arrivalTime: formatServiceTime(last.arrivalMinute),
        departureDateTime: formatDateTime(searchDate, first.departureMinute),
        arrivalDateTime: formatDateTime(searchDate, last.arrivalMinute),
        durationMinutes: last.arrivalMinute - first.departureMinute,
        numberOfStops: connections.length - 1
    };
}

function buildJourney(
    connections: JourneyConnection[],
    departureStation: JourneyStation,
    arrivalStation: JourneyStation,
    searchDate: Date,
    requestedDepartureTime: string
): RailwayJourney {
    const groupedConnections: JourneyConnection[][] = [];

    for (const connection of connections) {
        const currentGroup = groupedConnections[groupedConnections.length - 1];
        if (currentGroup?.[0].trainId === connection.trainId) {
            currentGroup.push(connection);
        } else {
            groupedConnections.push([connection]);
        }
    }

    const first = connections[0];
    const last = connections[connections.length - 1];
    const legs = groupedConnections.map(group => buildLeg(group, searchDate));

    return {
        routeType: legs.length === 1 ? "direct" : "transfer",
        searchDate: formatDate(searchDate),
        requestedDepartureTime,
        departureStation,
        arrivalStation,
        departureTime: formatServiceTime(first.departureMinute),
        arrivalTime: formatServiceTime(last.arrivalMinute),
        departureDateTime: formatDateTime(searchDate, first.departureMinute),
        arrivalDateTime: formatDateTime(searchDate, last.arrivalMinute),
        totalDurationMinutes: last.arrivalMinute - first.departureMinute,
        numberOfTransfers: Math.max(0, legs.length - 1),
        legs
    };
}

function toStationSummary(station: ResolvedJourneyStation): JourneyStation {
    return { id: station.id, code: station.code, name: station.name };
}

export async function searchRailwayJourney(
    departureCode: string,
    arrivalCode: string,
    date: string,
    time: string
): Promise<RailwayJourney> {
    const [departureStation, arrivalStation] = await Promise.all([
        resolveStation(departureCode),
        resolveStation(arrivalCode)
    ]);
    const connections = await findJourneyConnections(
        departureStation.databaseId,
        arrivalStation.databaseId
    );
    const searchDate = parseDate(date);
    const requestedMinute = timeToMinute(time);
    const directJourney = findDirectJourney(
        connections,
        departureStation.id,
        arrivalStation.id,
        searchDate,
        requestedMinute
    );
    const serviceDay = operatingDay(searchDate);
    const scannedJourney = directJourney ?? scanConnections(
        connections.filter(connection =>
            railwayRunsOnDay(connection.runsMask, serviceDay)
        ),
        departureStation.id,
        arrivalStation.id,
        requestedMinute
    );

    if (!scannedJourney) {
        throw new ApiError(
            404,
            `No railway route exists from '${departureCode}' to '${arrivalCode}' on ${date}.`
        );
    }

    const journey = buildJourney(
        scannedJourney,
        toStationSummary(departureStation),
        toStationSummary(arrivalStation),
        searchDate,
        time
    );

    logger.info(
        {
            departure: departureCode,
            arrival: arrivalCode,
            date,
            time,
            routeType: journey.routeType,
            durationMinutes: journey.totalDurationMinutes,
            transfers: journey.numberOfTransfers
        },
        "railway journey searched with CSA"
    );

    return journey;
}

