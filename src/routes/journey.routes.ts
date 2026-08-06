import { Router } from "express";
import { searchJourneys } from "../controllers/multimodal-journey.controller";

const router = Router();
router.post("/search", searchJourneys);

export default router;
