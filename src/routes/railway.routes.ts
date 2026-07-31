import { Router } from "express";
import { getRailwayTracks } from "../controllers/railway-track.controller";
import { getRailwayStations } from "../controllers/railway-station.controller";
import { searchRailwayJourneys } from "../controllers/journey-search.controller";

const router = Router();

router.post("/search", searchRailwayJourneys);
router.get("/stations", getRailwayStations);
router.get("/", getRailwayTracks);

export default router;
