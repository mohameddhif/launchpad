import "dotenv/config";
import { createServer } from "node:http";
import { createApp } from "./app.js";
import { attachWebSocketServer } from "./ws.js";
import { createLogger } from "@launchpad/shared";

const log = createLogger("api");
const port = Number(process.env.API_PORT ?? 4000);

const app = createApp();
const server = createServer(app);
attachWebSocketServer(server);

server.listen(port, () => {
  log.info(`api listening on :${port}`);
});
