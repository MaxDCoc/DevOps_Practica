import { createServer } from "node:http";
import os from "node:os";

const port = Number(process.env.PORT ?? 3000);

const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/health") {
        res.end(JSON.stringify({ status: "healthy" }));
        return;
    }

    res.end(JSON.stringify({
        message: "Hola desde un contenedor",
        hostname: os.hostname(),
        node: process.version
    }));
});

server.listen(port, "0.0.0.0");

console.log(`Server is running on port ${port}`);
