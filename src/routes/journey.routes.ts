import { Router } from "express";
import { searchJourneys } from "../controllers/multimodal-journey.controller";
import { createRateLimiter, resolveRateLimiterConfig } from "../middleware/rate-limiter";

const router = Router();

const searchRateLimiter = createRateLimiter({
    ...resolveRateLimiterConfig(),
    busyMessage: "Too many journey search requests. Please slow down and try again shortly."
});

router.post("/search", searchRateLimiter, searchJourneys);

export default router;
