import { Router } from "express";
import { getRailways } from "../controllers/railway.controller";
import { getRailwayStations } from "../controllers/railway-station.controller";

const router = Router();

router.get("/stations", getRailwayStations);
router.get("/", getRailways);

export default router;