import { Router } from "express";
import { getRailwayTracks } from "../controllers/railway-track.controller";
import { getRailwayStations } from "../controllers/railway-station.controller";
import { searchRailwayJourneys } from "../controllers/journey-search.controller";
import { createRateLimiter, resolveRateLimiterConfig } from "../middleware/rate-limiter";

const router = Router();

const searchRateLimiter = createRateLimiter({
    ...resolveRateLimiterConfig(),
    busyMessage: "Too many railway search requests. Please slow down and try again shortly."
});

router.post("/search", searchRateLimiter, searchRailwayJourneys);
router.get("/stations", getRailwayStations);
router.get("/", getRailwayTracks);

export default router;
