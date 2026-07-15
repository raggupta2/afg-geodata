import { Router } from "express";
import { getAirports } from "../controllers/airport.controller";

const router = Router();

router.get("/", getAirports);

export default router;