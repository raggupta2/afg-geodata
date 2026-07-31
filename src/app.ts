import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import collectRoutes from "./routes/collect.routes";
import healthRoutes from "./routes/health.routes";
import railwayRoutes from "./routes/railway.routes";
import airportRoutes from "./routes/airport.routes";
import flightRoutes from "./routes/flight.routes";
import path from "path";
import { ApiError } from "./errors/api.error";
import { logger } from "./config/logger";

const app=express();
app.disable("x-powered-by");
app.use(pinoHttp({ logger }));
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "32kb" }));

app.use(
    "/api/v1/collect",
    collectRoutes
);

app.use(
    "/api/v1/health",
    healthRoutes
);

app.use("/api/v1/railways", railwayRoutes );
app.use("/api/v1/airports", airportRoutes);
app.use("/api/v1/flights", flightRoutes);

app.use(
    (
        error: Error,
        req: Request,
        res: Response,
        next: NextFunction
    ) => {
        if (res.headersSent) {
            return next(error);
        }

        const statusCode = error instanceof ApiError ? error.statusCode : 500;
        const message = error instanceof ApiError
            ? error.message
            : "An unexpected error occurred.";

        logger[statusCode >= 500 ? "error" : "warn"](
            { error, method: req.method, path: req.path, statusCode },
            "API request failed"
        );

        res.status(statusCode).json({
            success: false,
            message,
            details: error instanceof ApiError ? error.details : undefined,
            stack: process.env.NODE_ENV === "development" ? error.stack : undefined
        });
    }
);

// Serve config.js dynamically
app.get("/config.js", (req, res) => {
    const apiUrl = JSON.stringify(process.env.API_URL || "/api/v1/");

    res.type("application/javascript");
    res.send(`window.APP_CONFIG = { API_URL: ${apiUrl} };`);
});

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],

                scriptSrc: [
                    "'self'"
                ],

                styleSrc: [
                    "'self'",
                    "'unsafe-inline'"
                ],

                imgSrc: [
                    "'self'",
                    "data:",
                    "https://tile.openstreetmap.org",
                    "https://*.tile.openstreetmap.org"
                ],

                connectSrc: [
                    "'self'",
                    "https://nominatim.openstreetmap.org"
                ],

                upgradeInsecureRequests:
                    process.env.NODE_ENV === "production" ? [] : null,

                fontSrc: [
                    "'self'",
                    "data:"
                ]
            }
        }
    })
);


// Serve static files
app.use(express.static(path.join(__dirname, "../public")));

export default app;
