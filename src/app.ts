import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import collectRoutes from "./routes/collect.routes";
import healthRoutes from "./routes/health.routes";
import railwayRoutes from "./routes/railway.routes";

const app=express();
app.use(cors());
app.use(helmet());
app.use(express.json());

app.use(
    "/api/v1/collect",
    collectRoutes
);

app.use(
    "/api/v1/health",
    healthRoutes
);

app.use("/api/v1/railways", railwayRoutes );

app.use(
    (
        error: Error,
        req: Request,
        res: Response,
        next: NextFunction
    ) => {

        console.error("API ERROR:", error);

        if (res.headersSent) {
            return next(error);
        }

        res.status(500).json({
            success: false,
            message: error.message,
            stack:
                process.env.NODE_ENV === "development"
                    ? error.stack
                    : undefined
        });
    }
);

export default app;
