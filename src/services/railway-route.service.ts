import { logger } from "../config/logger";
import { ApiError } from "../errors/api.error";
import {
    findDirectTrainRoutes,
    findOneStopTrainRoutes,
    findRailwayStationByCode,
    ResolvedRailwayStation
} from "../repositories/railway-route.repository";
import { RailwayRouteType } from "../types/railway-route";

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
    const routes = type === "direct"
        ? await findDirectTrainRoutes(sourceStation, destinationStation)
        : await findOneStopTrainRoutes(sourceStation, destinationStation);

    logger.info(
        { source: sourceCode, destination: destinationCode, type, count: routes.length },
        "railway routes searched"
    );

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
        routes
    };
}
