import { logger } from "../config/logger";
import { ApiError } from "../errors/api.error";
import {
    findAirlinesForRoute,
    findAirportByCode,
    findDirectConnections,
    findDirectRoutes,
    findOneStopRoutes,
    ResolvedAirport
} from "../repositories/flight-route.repository";
import { AirportSummary, RouteType } from "../types/flight-route";

const toAirportSummary = ({ databaseId: _databaseId, ...airport }: ResolvedAirport): AirportSummary =>
    airport;

async function resolveAirport(code: string): Promise<ResolvedAirport> {
    const airport = await findAirportByCode(code);
    if (!airport) {
        throw new ApiError(404, `Airport code '${code}' was not found or has no map coordinates.`);
    }
    return airport;
}

async function resolveAirportPair(sourceCode: string, destinationCode: string) {
    const [sourceAirport, destinationAirport] = await Promise.all([
        resolveAirport(sourceCode),
        resolveAirport(destinationCode)
    ]);
    return { sourceAirport, destinationAirport };
}

export async function searchFlightRoutes(
    sourceCode: string,
    destinationCode: string,
    type: RouteType
) {
    const { sourceAirport, destinationAirport } = await resolveAirportPair(
        sourceCode,
        destinationCode
    );
    const routes = type === "direct"
        ? await findDirectRoutes(sourceAirport, destinationAirport)
        : await findOneStopRoutes(sourceAirport, destinationAirport);

    logger.info(
        { source: sourceCode, destination: destinationCode, type, count: routes.length },
        "flight routes searched"
    );
    return {
        sourceAirport: toAirportSummary(sourceAirport),
        destinationAirport: toAirportSummary(destinationAirport),
        type,
        routes
    };
}

export async function getAirportConnectivity(sourceCode: string) {
    const sourceAirport = await resolveAirport(sourceCode);
    const connections = await findDirectConnections(sourceAirport);

    logger.info(
        { source: sourceCode, count: connections.length },
        "airport connectivity searched"
    );
    return {
        sourceAirport: toAirportSummary(sourceAirport),
        connections
    };
}

export async function getAirlineConnectivity(
    sourceCode: string,
    destinationCode: string
) {
    const { sourceAirport, destinationAirport } = await resolveAirportPair(
        sourceCode,
        destinationCode
    );
    const airlines = await findAirlinesForRoute(sourceAirport, destinationAirport);

    logger.info(
        { source: sourceCode, destination: destinationCode, count: airlines.length },
        "airline connectivity searched"
    );
    return {
        sourceAirport: toAirportSummary(sourceAirport),
        destinationAirport: toAirportSummary(destinationAirport),
        airlines
    };
}

