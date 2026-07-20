import { Router } from "express";
import { getRailways } from "../controllers/railway.controller";
import { getRailwayStations } from "../controllers/railway-station.controller";
import { searchRoutes } from "../controllers/railway-route.controller";

const router = Router();

router.get("/routes", searchRoutes);
router.get("/stations", getRailwayStations);
router.get("/", getRailways);

export default router;