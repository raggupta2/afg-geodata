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

type TrainBoarding = {
    trainId: string;
    connections: JourneyConnection[];
    startIndex: number;
};

type JourneySearchState = {
    stationId: string;
    arrivalMinute: number;
    estimatedTotalLegs: number;
    rides: JourneyConnection[][];
    visitedStationIds: Set<string>;
    usedTrainIds: Set<string>;
};

const MINUTES_PER_DAY = 24 * 60;
const MAX_JOURNEY_RESULTS = 50;
const MAX_RESULTS_PER_LEG_COUNT = 20;
const MAX_TRAIN_LEGS = 6;
const MAX_SEARCH_DAYS = 3;
const MAX_EXPANDED_STATES = 10_000;
const MAX_GENERATED_STATES = 100_000;
const MAX_STATES_PER_STATION_DEPTH = 40;
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

function buildTrainBoardings(
    connections: JourneyConnection[]
): Map<string, TrainBoarding[]> {
    const byTrain = new Map<string, JourneyConnection[]>();
    for (const connection of connections) {
        const trainConnections = byTrain.get(connection.trainId) ?? [];
        trainConnections.push(connection);
        byTrain.set(connection.trainId, trainConnections);
    }

    const boardingsByStation = new Map<string, TrainBoarding[]>();
    for (const [trainId, trainConnections] of byTrain) {
        trainConnections.sort((left, right) => left.sequence - right.sequence);
        for (let startIndex = 0; startIndex < trainConnections.length; startIndex += 1) {
            const first = trainConnections[startIndex];
            if (!first.boardingAllowed) continue;
            const boardings = boardingsByStation.get(first.fromStation.id) ?? [];
            boardings.push({
                trainId,
                connections: trainConnections,
                startIndex
            });
            boardingsByStation.set(first.fromStation.id, boardings);
        }
    }

    return boardingsByStation;
}

function findNextTrainOccurrence(
    boarding: TrainBoarding,
    earliestDepartureMinute: number,
    requestedDate: Date
): JourneyConnection[] | null {
    const first = boarding.connections[boarding.startIndex];
    const originDayOffset = Math.floor(
        first.departureMinute / MINUTES_PER_DAY
    );
    const departureMinuteOfDay = first.departureMinute % MINUTES_PER_DAY;
    let departureDay = Math.floor(
        earliestDepartureMinute / MINUTES_PER_DAY
    );

    if (
        departureDay * MINUTES_PER_DAY + departureMinuteOfDay
        < earliestDepartureMinute
    ) {
        departureDay += 1;
    }

    while (departureDay <= MAX_SEARCH_DAYS) {
        const trainOriginDate = addDays(
            requestedDate,
            departureDay - originDayOffset
        );
        if (railwayRunsOnDay(first.runsMask, operatingDay(trainOriginDate))) {
            const serviceDayShift = (
                departureDay - originDayOffset
            ) * MINUTES_PER_DAY;
            const occurrence: JourneyConnection[] = [];
            for (
                let index = boarding.startIndex;
                index < boarding.connections.length;
                index += 1
            ) {
                const connection = boarding.connections[index];
                const previous = occurrence[occurrence.length - 1];
                if (
                    previous
                    && (
                        previous.sequence + 1 !== connection.sequence
                        || previous.toStation.id !== connection.fromStation.id
                    )
                ) {
                    break;
                }
                occurrence.push({
                    ...connection,
                    departureMinute: connection.departureMinute + serviceDayShift,
                    arrivalMinute: connection.arrivalMinute + serviceDayShift
                });
            }
            return occurrence;
        }
        departureDay += 1;
    }

    return null;
}

function journeyKey(rides: JourneyConnection[][]): string {
    if (rides.length === 0) return "";
    return [
        rides[0][0].fromStation.id,
        ...rides.map(ride => ride[ride.length - 1].toStation.id)
    ].join("|");
}

function trainSequenceKey(rides: JourneyConnection[][]): string {
    return rides.map(ride => ride[0].trainId).join("|");
}

function compareSearchStates(
    left: JourneySearchState,
    right: JourneySearchState
): number {
    return left.estimatedTotalLegs - right.estimatedTotalLegs
        || right.rides.length - left.rides.length
        || left.arrivalMinute - right.arrivalMinute;
}

function registerSearchState(
    state: JourneySearchState,
    labelsByStationDepth: Map<string, JourneySearchState[]>
): boolean {
    const labelKey = `${state.stationId}:${state.rides.length}`;
    const labels = labelsByStationDepth.get(labelKey) ?? [];
    const stateRouteKey = journeyKey(state.rides);
    const matchingIndex = labels.findIndex(
        label => journeyKey(label.rides) === stateRouteKey
    );

    if (matchingIndex >= 0) {
        if (labels[matchingIndex].arrivalMinute <= state.arrivalMinute) {
            return false;
        }
        labels[matchingIndex] = state;
        return true;
    }

    if (labels.length < MAX_STATES_PER_STATION_DEPTH) {
        labels.push(state);
        labelsByStationDepth.set(labelKey, labels);
        return true;
    }

    let latestIndex = 0;
    for (let index = 1; index < labels.length; index += 1) {
        if (labels[index].arrivalMinute > labels[latestIndex].arrivalMinute) {
            latestIndex = index;
        }
    }
    if (labels[latestIndex].arrivalMinute <= state.arrivalMinute) {
        return false;
    }

    labels[latestIndex] = state;
    return true;
}

function findMinimumRemainingLegs(
    connections: JourneyConnection[],
    arrivalStationId: string
): Map<string, number> {
    const byTrain = new Map<string, JourneyConnection[]>();
    for (const connection of connections) {
        const trainConnections = byTrain.get(connection.trainId) ?? [];
        trainConnections.push(connection);
        byTrain.set(connection.trainId, trainConnections);
    }
    for (const trainConnections of byTrain.values()) {
        trainConnections.sort((left, right) => left.sequence - right.sequence);
    }

    const minimumLegs = new Map<string, number>([[arrivalStationId, 0]]);
    for (let iteration = 0; iteration < MAX_TRAIN_LEGS; iteration += 1) {
        let changed = false;
        for (const trainConnections of byTrain.values()) {
            let bestDownstreamLegs: number | undefined;
            for (
                let index = trainConnections.length - 1;
                index >= 0;
                index -= 1
            ) {
                const connection = trainConnections[index];
                const downstreamLegs = minimumLegs.get(
                    connection.toStation.id
                );
                if (
                    connection.alightingAllowed
                    && downstreamLegs !== undefined
                    && (
                        bestDownstreamLegs === undefined
                        || downstreamLegs < bestDownstreamLegs
                    )
                ) {
                    bestDownstreamLegs = downstreamLegs;
                }
                if (
                    connection.boardingAllowed
                    && bestDownstreamLegs !== undefined
                ) {
                    const candidateLegs = bestDownstreamLegs + 1;
                    const knownLegs = minimumLegs.get(
                        connection.fromStation.id
                    );
                    if (knownLegs === undefined || candidateLegs < knownLegs) {
                        minimumLegs.set(
                            connection.fromStation.id,
                            candidateLegs
                        );
                        changed = true;
                    }
                }
            }
        }
        if (!changed) break;
    }

    return minimumLegs;
}

class JourneySearchQueue {
    private readonly states: JourneySearchState[] = [];

    get length(): number {
        return this.states.length;
    }

    push(state: JourneySearchState): void {
        this.states.push(state);
        let index = this.states.length - 1;
        while (index > 0) {
            const parentIndex = Math.floor((index - 1) / 2);
            if (
                compareSearchStates(
                    this.states[parentIndex],
                    this.states[index]
                ) <= 0
            ) {
                break;
            }
            [this.states[parentIndex], this.states[index]] = [
                this.states[index],
                this.states[parentIndex]
            ];
            index = parentIndex;
        }
    }

    pop(): JourneySearchState | undefined {
        const first = this.states[0];
        const last = this.states.pop();
        if (!first || !last || this.states.length === 0) return first;

        this.states[0] = last;
        let index = 0;
        while (true) {
            const leftIndex = index * 2 + 1;
            const rightIndex = leftIndex + 1;
            let smallestIndex = index;

            if (
                leftIndex < this.states.length
                && compareSearchStates(
                    this.states[leftIndex],
                    this.states[smallestIndex]
                ) < 0
            ) {
                smallestIndex = leftIndex;
            }
            if (
                rightIndex < this.states.length
                && compareSearchStates(
                    this.states[rightIndex],
                    this.states[smallestIndex]
                ) < 0
            ) {
                smallestIndex = rightIndex;
            }
            if (smallestIndex === index) break;

            [this.states[index], this.states[smallestIndex]] = [
                this.states[smallestIndex],
                this.states[index]
            ];
            index = smallestIndex;
        }

        return first;
    }
}

function findJourneysForLegCount(
    boardingsByStation: Map<string, TrainBoarding[]>,
    minimumRemainingLegs: Map<string, number>,
    departureStationId: string,
    arrivalStationId: string,
    requestedDate: Date,
    requestedMinute: number,
    targetLegCount: number,
    resultKeys: Set<string>,
    resultTrainKeys: Set<string>
): JourneyConnection[][] {
    const sourceMinimumLegs = minimumRemainingLegs.get(departureStationId);
    if (
        sourceMinimumLegs === undefined
        || sourceMinimumLegs > targetLegCount
    ) {
        return [];
    }

    const queue = new JourneySearchQueue();
    const labelsByStationDepth = new Map<string, JourneySearchState[]>();
    const initialState: JourneySearchState = {
        stationId: departureStationId,
        arrivalMinute: requestedMinute,
        estimatedTotalLegs: targetLegCount,
        rides: [],
        visitedStationIds: new Set([departureStationId]),
        usedTrainIds: new Set()
    };
    queue.push(initialState);
    registerSearchState(initialState, labelsByStationDepth);
    const results: JourneyConnection[][] = [];
    let expandedStates = 0;
    let generatedStates = 1;

    while (
        queue.length > 0
        && results.length < MAX_RESULTS_PER_LEG_COUNT
        && expandedStates < MAX_EXPANDED_STATES
        && generatedStates < MAX_GENERATED_STATES
    ) {
        const state = queue.pop();
        if (!state) break;

        if (state.stationId === arrivalStationId) {
            if (state.rides.length !== targetLegCount) continue;
            const key = journeyKey(state.rides);
            const trainKey = trainSequenceKey(state.rides);
            if (!resultKeys.has(key) && !resultTrainKeys.has(trainKey)) {
                resultKeys.add(key);
                resultTrainKeys.add(trainKey);
                results.push(state.rides.flat());
            }
            continue;
        }
        if (state.rides.length >= targetLegCount) continue;

        expandedStates += 1;
        const availableBoardings = boardingsByStation.get(state.stationId) ?? [];
        for (const boarding of availableBoardings) {
            if (state.usedTrainIds.has(boarding.trainId)) continue;

            const occurrence = findNextTrainOccurrence(
                boarding,
                state.arrivalMinute,
                requestedDate
            );
            if (!occurrence) continue;

            const ride: JourneyConnection[] = [];
            for (const connection of occurrence) {
                if (state.visitedStationIds.has(connection.toStation.id)) break;
                ride.push(connection);
                if (!connection.alightingAllowed) continue;
                const remainingLegs = minimumRemainingLegs.get(
                    connection.toStation.id
                );
                if (remainingLegs === undefined) continue;
                const nextLegCount = state.rides.length + 1;
                if (nextLegCount + remainingLegs > targetLegCount) continue;

                const nextState: JourneySearchState = {
                    stationId: connection.toStation.id,
                    arrivalMinute: connection.arrivalMinute,
                    estimatedTotalLegs: targetLegCount,
                    rides: [...state.rides, [...ride]],
                    visitedStationIds: new Set([
                        ...state.visitedStationIds,
                        ...ride.map(item => item.toStation.id)
                    ]),
                    usedTrainIds: new Set([
                        ...state.usedTrainIds,
                        boarding.trainId
                    ])
                };
                if (!registerSearchState(nextState, labelsByStationDepth)) {
                    continue;
                }
                queue.push(nextState);
                generatedStates += 1;
                if (generatedStates >= MAX_GENERATED_STATES) break;
            }
            if (generatedStates >= MAX_GENERATED_STATES) break;
        }
    }

    return results;
}

function findJourneys(
    connections: JourneyConnection[],
    departureStationId: string,
    arrivalStationId: string,
    requestedDate: Date,
    requestedMinute: number
): JourneyConnection[][] {
    const boardingsByStation = buildTrainBoardings(connections);
    const minimumRemainingLegs = findMinimumRemainingLegs(
        connections,
        arrivalStationId
    );
    const results: JourneyConnection[][] = [];
    const resultKeys = new Set<string>();
    const resultTrainKeys = new Set<string>();

    for (
        let targetLegCount = 1;
        targetLegCount <= MAX_TRAIN_LEGS
            && results.length < MAX_JOURNEY_RESULTS;
        targetLegCount += 1
    ) {
        const depthResults = findJourneysForLegCount(
            boardingsByStation,
            minimumRemainingLegs,
            departureStationId,
            arrivalStationId,
            requestedDate,
            requestedMinute,
            targetLegCount,
            resultKeys,
            resultTrainKeys
        );
        results.push(...depthResults);
    }

    return results.slice(0, MAX_JOURNEY_RESULTS);
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
    const stations = [
        first.fromStation,
        ...connections.map(connection => connection.toStation)
    ];
    const totalDistanceKm = first.fromDistanceKm !== null
        && last.toDistanceKm !== null
        ? last.toDistanceKm - first.fromDistanceKm
        : null;

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
        totalDistanceKm,
        numberOfStops: Math.max(0, stations.length - 2),
        stations
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
    const stations = [
        first.fromStation,
        ...connections.map(connection => connection.toStation)
    ];
    const totalDistanceKm = legs.every(leg => leg.totalDistanceKm !== null)
        ? legs.reduce((total, leg) => total + (leg.totalDistanceKm ?? 0), 0)
        : null;

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
        totalDistanceKm,
        numberOfStops: Math.max(0, stations.length - 2),
        numberOfTransfers: Math.max(0, legs.length - 1),
        stations,
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
): Promise<RailwayJourney[]> {
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
    const matchingJourneys = findJourneys(
        connections,
        departureStation.id,
        arrivalStation.id,
        searchDate,
        requestedMinute
    );

    if (matchingJourneys.length === 0) {
        throw new ApiError(
            404,
            `No railway route exists from '${departureCode}' to '${arrivalCode}' on ${date}.`
        );
    }

    const journeys = matchingJourneys.map(journey =>
        buildJourney(
            journey,
            toStationSummary(departureStation),
            toStationSummary(arrivalStation),
            searchDate,
            time
        )
    ).sort((left, right) =>
        left.totalDurationMinutes - right.totalDurationMinutes
        || left.numberOfTransfers - right.numberOfTransfers
        || (left.totalDistanceKm ?? Number.POSITIVE_INFINITY)
            - (right.totalDistanceKm ?? Number.POSITIVE_INFINITY)
        || left.departureDateTime.localeCompare(right.departureDateTime)
    );

    logger.info(
        {
            departure: departureCode,
            arrival: arrivalCode,
            date,
            time,
            resultCount: journeys.length,
            routeType: journeys[0].routeType,
            durationMinutes: journeys[0].totalDurationMinutes,
            transfers: journeys[0].numberOfTransfers
        },
        "railway journeys searched"
    );

    return journeys;
}

