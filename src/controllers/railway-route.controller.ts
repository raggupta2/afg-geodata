import { NextFunction, Request, Response } from "express";
import { searchRailwayRoutes } from "../services/railway-route.service";
import { parseRailwayRouteSearchQuery } from "../validators/railway-route.validator";

export async function searchRoutes(req: Request, res: Response, next: NextFunction) {
    try {
        const query = parseRailwayRouteSearchQuery(req.query);
        const result = await searchRailwayRoutes(
            query.source,
            query.destination,
            query.type
        );

        res.json({
            success: true,
            count: result.routes.length,
            message: result.routes.length
                ? "Railway routes found."
                : `No ${query.type === "direct" ? "direct" : "one-stop"} railway routes are available.`,
            data: result
        });
    } catch (error) {
        next(error);
    }
}
