import "dotenv/config";
import app from "./app";
import fs from "fs";
import https from "https";
import { Server } from "http";
import { prisma } from "./config/database";
import { logger } from "./config/logger";

const PORT = parseInt(process.env.PORT || "3000", 10);
let server: Server;

if (process.env.USE_HTTPS === "true") {
    const sslOptions = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH || "ssl/staging/privkey.pem"),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH || "ssl/staging/fullchain.pem"),
    };

    server = https.createServer(sslOptions, app);

    server.listen(PORT, "0.0.0.0", () => {
        logger.info({ port: PORT }, "HTTPS server running");
    });
} else {
    server = app.listen(PORT, "0.0.0.0", () => {
        logger.info({ port: PORT }, "HTTP server running");
    });
}

server.requestTimeout = Number(process.env.REQUEST_TIMEOUT_MS ?? 30_000);
server.headersTimeout = Number(process.env.HEADERS_TIMEOUT_MS ?? 35_000);
server.keepAliveTimeout = Number(process.env.KEEP_ALIVE_TIMEOUT_MS ?? 5_000);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Shutting down server");

    const forcedExit = setTimeout(() => {
        logger.error("Forced shutdown after timeout");
        process.exit(1);
    }, 10_000);
    forcedExit.unref();

    server.close(async error => {
        await prisma.$disconnect();
        clearTimeout(forcedExit);
        if (error) {
            logger.error({ error }, "Server shutdown failed");
            process.exit(1);
        }
        process.exit(0);
    });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
