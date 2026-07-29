import { Router } from "express";
import { getRailwayTracks } from "../controllers/railway-track.controller";
import { getRailwayStations } from "../controllers/railway-station.controller";
import { searchRoutes } from "../controllers/railway-route.controller";

const router = Router();

router.get("/routes", searchRoutes);
router.get("/stations", getRailwayStations);
router.get("/", getRailwayTracks);

export default router; 