import "dotenv/config";
import app from "./app";
import fs from "fs";
import https from "https";

const PORT = parseInt(process.env.PORT || "3000", 10);

if (process.env.USE_HTTPS === "true") {
    const sslOptions = {
        key: fs.readFileSync(process.env.SSL_KEY_PATH || "ssl/staging/privkey.pem"),
        cert: fs.readFileSync(process.env.SSL_CERT_PATH || "ssl/staging/fullchain.pem"),
    };

    const server = https.createServer(sslOptions, app);

    server.listen(PORT, "0.0.0.0", () => {
        console.log(`HTTPS Server running on ${PORT}`);
    });
} else {
    app.listen(PORT, "0.0.0.0", () => {
        console.log(`HTTP Server running on ${PORT}`);
    });
}