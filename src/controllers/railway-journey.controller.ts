import { NextFunction, Request, Response } from "express";
import { searchRailwayJourney } from "../services/railway-routing.service";
import { parseRailwayJourneySearch } from "../validators/railway-journey.validator";

async function search(
    input: unknown,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const query = parseRailwayJourneySearch(input);
        const journey = await searchRailwayJourney(
            query.departure,
            query.arrival,
            query.date,
            query.time
        );

        res.json({
            success: true,
            message: "Railway route found.",
            data: journey
        });
    } catch (error) {
        next(error);
    }
}

export async function searchRoutes(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    await search(req.query, res, next);
}

export async function searchRoutesByPost(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    await search(req.body, res, next);
}
