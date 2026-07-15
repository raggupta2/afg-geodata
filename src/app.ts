import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import collectRoutes from "./routes/collect.routes";
import healthRoutes from "./routes/health.routes";
import railwayRoutes from "./routes/railway.routes";
import airportRoutes from "./routes/airport.routes";
import path from "path";

const app=express();
app.use(cors());
//app.use(helmet());
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
app.use("/api/v1/airports", airportRoutes);

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
                    "'self'"
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
