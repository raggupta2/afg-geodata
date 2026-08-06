import { NextFunction, Request, Response } from "express";
import { searchMultimodalJourneys } from "../services/multimodal-journey.service";
import { parseMultimodalSearch } from "../validators/multimodal-journey.validator";

export async function searchJourneys(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const input = parseMultimodalSearch(req.body);
        const result = await searchMultimodalJourneys(input);
        res.setHeader("Cache-Control", "private, no-store");
        res.json({
            success: true,
            count: result.journeyResults.length,
            message: result.journeyResults.length > 0
                ? "Multimodal journey options found."
                : "No journey is available for the requested time.",
            data: result
        });
    } catch (error) {
        next(error);
    }
}
