import { Router } from "express";
import { getRailways } from "../controllers/railway.controller";

const router = Router();

router.get(
    "/",
    getRailways
);


export default router;