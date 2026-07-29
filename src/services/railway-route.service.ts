import { logger } from "../config/logger";
import { ApiError } from "../errors/api.error";
import {
    findDirectTrainRoutes,
    findOneStopTrainRoutes,
    findRailwayStationByCode,
    ResolvedRailwayStation
} from "../repositories/railway-route.repository";
import { RailwayItinerary, RailwayRouteType, TrainRunDays } from "../types/railway-route";

const MAX_DIRECT_TRAINS = 2;
const MAX_ALTERNATE_TRAINS = 2;

function buildSummary(itinerary: RailwayItinerary): RailwayItinerary["summary"] {
    const totalKms = itinerary.trains.reduce((sum, leg) => sum + (leg.distanceKm ?? 0), 0);
    const initialRunDays: TrainRunDays = {
        M: false,
        T: false,
        W: false,
        Th: false,
        F: false,
        S: false,
        Su: false
    };

    const combined = itinerary.trains.reduce<TrainRunDays>((accumulator, leg) => {
        const current = leg.runDays ?? initialRunDays;
        return {
            ...accumulator,
            M: accumulator.M || current.M,
            T: accumulator.T || current.T,
            W: accumulator.W || current.W,
            Th: accumulator.Th || current.Th,
            F: accumulator.F || current.F,
            S: accumulator.S || current.S,
            Su: accumulator.Su || current.Su
        };
    }, initialRunDays);

    return {
        distance: `${totalKms} km`,
        totalKms,
        runDays: combined
    };
}

async function resolveStation(code: string): Promise<ResolvedRailwayStation> {
    const station = await findRailwayStationByCode(code);
    if (!station) {
        throw new ApiError(404, `Railway station code '${code}' was not found.`);
    }
    return station;
}

export async function searchRailwayRoutes(
    sourceCode: string,
    destinationCode: string,
    type: RailwayRouteType
) {
    const [sourceStation, destinationStation] = await Promise.all([
        resolveStation(sourceCode),
        resolveStation(destinationCode)
    ]);
    const [directRoutes, oneStopRoutes] = await Promise.all([
        findDirectTrainRoutes(sourceStation, destinationStation),
        findOneStopTrainRoutes(sourceStation, destinationStation)
    ]);

    const directRouteResults = directRoutes
        .slice(0, MAX_DIRECT_TRAINS)
        .map(route => ({ ...route, summary: buildSummary(route) }));

   

    const alternateRouteResults = oneStopRoutes
        .slice(0, directRouteResults.length > 0 ? 1 : MAX_ALTERNATE_TRAINS)
        .map(route => ({ ...route, summary: buildSummary(route) }));

    const requestedRoutes = type === "direct"
        ? directRouteResults
        : alternateRouteResults;


    return {
        sourceStation: {
            id: sourceStation.id,
            code: sourceStation.code,
            name: sourceStation.name
        },
        destinationStation: {
            id: destinationStation.id,
            code: destinationStation.code,
            name: destinationStation.name
        },
        type,
        train_between_stations: directRouteResults,
        alternate_trains: alternateRouteResults,
        routes: requestedRoutes
    };
}
