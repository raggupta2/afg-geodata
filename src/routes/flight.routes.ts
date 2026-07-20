import { Router } from "express";
import { searchFlights } from "../controllers/flight-schedule.controller";

const router = Router();

router.get("/search", searchFlights);

export default router;
