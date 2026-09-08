import {Router} from "express";
import { currentMetricsSnapshot } from "../observability/metrics";
import { metricsAuth } from "../middleware/metrics-auth";
const router=Router();

router.get("/",(req,res)=>{
    res.json({
        status:"ok",
        service:"afg-geodata",
        time:new Date()
    });
});

// Gated by METRICS_ACCESS_TOKEN when set (see middleware/metrics-auth.ts);
// left unauthenticated with a startup warning if that env var is unset, so
// local/dev use stays zero-config while production gets a clear nudge.
router.get("/metrics", metricsAuth, (req, res) => {
    res.json(currentMetricsSnapshot());
});

export default router;