import { Router } from "express";
import {
    searchRoutes,
    searchRoutesByPost
} from "../controllers/railway-journey.controller";

const router = Router();

router.get("/", searchRoutes);
router.post("/search", searchRoutesByPost);

export default router;
