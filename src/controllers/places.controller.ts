import { NextFunction, Request, Response } from "express";
import { getAddressDetails, searchAddressSuggestions } from "../services/places.service";
import { parseAddressDetailsQuery, parseAddressSuggestionsQuery } from "../validators/places.validator";

export async function getAddressSuggestions(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const query = parseAddressSuggestionsQuery(req.query);
        const suggestions = await searchAddressSuggestions(query);
        res.setHeader("Cache-Control", "private, no-store");
        res.json({
            success: true,
            count: suggestions.length,
            data: suggestions
        });
    } catch (error) {
        next(error);
    }
}

export async function getAddressDetail(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const query = parseAddressDetailsQuery(req.query);
        const details = await getAddressDetails(query);
        res.setHeader("Cache-Control", "private, no-store");
        res.json({
            success: true,
            data: details
        });
    } catch (error) {
        next(error);
    }
}
