import { NextFunction, Request, Response } from "express";
import {
    getAirlineConnectivity,
    getAirportConnectivity,
    searchFlightRoutes
} from "../services/flight-route.service";
import {
    parseAirlineConnectivityQuery,
    parseRouteSearchQuery,
    parseSourceAirportQuery
} from "../validators/flight-route.validator";

export async function searchRoutes(req: Request, res: Response, next: NextFunction) {
    try {
        const query = parseRouteSearchQuery(req.query);
        const result = await searchFlightRoutes(query.source, query.destination, query.type);

        res.json({
            success: true,
            count: result.routes.length,
            message: result.routes.length
                ? "Flight routes found."
                : `No ${query.type === "direct" ? "direct" : "one-stop"} routes are available.`,
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function getConnectivity(req: Request, res: Response, next: NextFunction) {
    try {
        const query = parseSourceAirportQuery(req.query);
        const result = await getAirportConnectivity(query.source);

        res.json({
            success: true,
            count: result.connections.length,
            message: result.connections.length
                ? "Directly connected airports found."
                : "No directly connected airports are available.",
            data: result
        });
    } catch (error) {
        next(error);
    }
}

export async function getAirlines(req: Request, res: Response, next: NextFunction) {
    try {
        const query = parseAirlineConnectivityQuery(req.query);
        const result = await getAirlineConnectivity(query.source, query.destination);

        res.json({
            success: true,
            count: result.airlines.length,
            message: result.airlines.length
                ? "Airlines found."
                : "No airlines operate a direct route between these airports.",
            data: result
        });
    } catch (error) {
        next(error);
    }
}
