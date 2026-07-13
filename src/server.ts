import app from "./app";

const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on ${PORT}`);
});


// import fs from "fs";
// import https from "https";
// const PORT = parseInt(process.env.PORT || "3000", 10);
// const stagingCert = {
//     key: fs.readFileSync("ssl/staging/privkey.pem"),
//     cert: fs.readFileSync("ssl/staging/fullchain.pem")
// };
// const server = https.createServer(stagingCert, app);
// server.listen(PORT, "0.0.0.0", () => {
//     console.log(`HTTPS Server running on ${PORT}`);
// });