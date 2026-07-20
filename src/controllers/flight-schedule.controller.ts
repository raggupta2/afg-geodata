import { NextFunction, Request, Response } from "express";
import { searchFlightSchedules } from "../services/flight-schedule.service";
import { parseFlightSearchQuery } from "../validators/flight-schedule.validator";

export async function searchFlights(req: Request, res: Response, next: NextFunction) {
    try {
        const query = parseFlightSearchQuery(req.query);
        const result = await searchFlightSchedules(query.from, query.to, query.date);

        res.json({
            success: true,
            count: result.flights.length,
            message: result.flights.length
                ? "Scheduled flights found."
                : "No scheduled flights were found for this route and date.",
            data: result
        });
    } catch (error) {
        next(error);
    }
}
