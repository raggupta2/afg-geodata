import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import collectRoutes from "./routes/collect.routes";
import healthRoutes from "./routes/health.routes";

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

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
        next(error);
        return;
    }

    res.status(400).json({
        success: false,
        message: "Invalid request payload"
    });
});

export default app;
