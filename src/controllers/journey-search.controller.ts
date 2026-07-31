import { NextFunction, Request, Response } from "express";
import { searchCoordinateRailwayJourney } from "../services/journey-search.service";
import { parseJourneySearch } from "../validators/journey-search.validator";

export async function searchRailwayJourneys(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const query = parseJourneySearch(req.body);
        const result = await searchCoordinateRailwayJourney(query);
        res.setHeader("Cache-Control", "private, no-store");
        res.json({
            success: true,
            count: result.trainResults.length,
            message: result.trainResults.length > 0
                ? "Railway journey options found."
                : "No railway journey is available for the requested time.",
            data: result
        });
    } catch (error) {
        next(error);
    }
}
