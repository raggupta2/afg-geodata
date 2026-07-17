import { Router } from "express";
import { getAirports } from "../controllers/airport.controller";
import {
    getAirlines,
    getConnectivity,
    searchRoutes
} from "../controllers/flight-route.controller";

const router = Router();

router.get("/routes", searchRoutes);
router.get("/connectivity", getConnectivity);
router.get("/airlines", getAirlines);
router.get("/", getAirports);

export default router;