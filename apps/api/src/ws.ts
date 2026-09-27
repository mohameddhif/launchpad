import type { Server as HttpServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { prisma, createRedisConnection, LOG_CHANNEL_PATTERN, createLogger, type LogEvent } from "@launchpad/shared";
import { readAuthTokenFromCookieHeader } from "./lib/cookies.js";
import { verifyAuthToken } from "./lib/jwt.js";

const log = createLogger("ws");

interface Subscription {
  ws: WebSocket;
  deploymentId: string;
  lastSeq: number;
  /** Live events arriving while history is still being fetched are queued here, not
   * sent — merged in after history so the client never sees a gap or a duplicate line. */
  buffer: LogEvent[];
  replaying: boolean;
}

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

/**
 * Attaches a `ws` server to the API's existing http.Server (PRD §6: one HTTP server for
 * REST + webhooks + WebSocket). A single Redis subscriber fans out to every connected
 * client by deploymentId, rather than one Redis connection per socket.
 */
export function attachWebSocketServer(server: HttpServer): void {
  const wss = new WebSocketServer({ noServer: true });
  const subscribersByDeployment = new Map<string, Set<Subscription>>();

  const redisSub = createRedisConnection();
  void redisSub.psubscribe(LOG_CHANNEL_PATTERN);
  redisSub.on("pmessage", (_pattern, _channel, raw: string) => {
    let event: LogEvent;
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }
    const subs = subscribersByDeployment.get(event.deploymentId);
    if (!subs) return;
    for (const sub of subs) {
      if (sub.replaying) {
        sub.buffer.push(event);
        continue;
      }
      if (event.seq <= sub.lastSeq) continue;
      sub.lastSeq = event.seq;
      send(sub.ws, { type: "log", ...event });
    }
  });

  function unsubscribe(sub: Subscription | null): void {
    if (!sub) return;
    subscribersByDeployment.get(sub.deploymentId)?.delete(sub);
  }

  server.on("upgrade", (req, socket, head) => {
    if (!req.url?.startsWith("/ws")) {
      socket.destroy();
      return;
    }
    const token = readAuthTokenFromCookieHeader(req.headers.cookie);
    try {
      if (!token) throw new Error("missing token");
      verifyAuthToken(token);
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    let currentSub: Subscription | null = null;

    ws.on("message", async (raw) => {
      let msg: { subscribe?: string };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const match = /^deployment:(.+)$/.exec(msg.subscribe ?? "");
      if (!match) return;
      const deploymentId = match[1]!;

      unsubscribe(currentSub);

      const sub: Subscription = { ws, deploymentId, lastSeq: -1, buffer: [], replaying: true };
      currentSub = sub;
      if (!subscribersByDeployment.has(deploymentId)) {
        subscribersByDeployment.set(deploymentId, new Set());
      }
      subscribersByDeployment.get(deploymentId)!.add(sub);

      const history = await prisma.deploymentLog.findMany({
        where: { deploymentId },
        orderBy: { seq: "asc" },
      });
      for (const line of history) {
        if (line.seq <= sub.lastSeq) continue;
        send(ws, {
          type: "log",
          deploymentId,
          seq: line.seq,
          stream: line.stream,
          message: line.message,
          ts: line.createdAt.toISOString(),
        });
        sub.lastSeq = line.seq;
      }
      for (const event of sub.buffer) {
        if (event.seq <= sub.lastSeq) continue;
        send(ws, { type: "log", ...event });
        sub.lastSeq = event.seq;
      }
      sub.buffer = [];
      sub.replaying = false;

      const deployment = await prisma.deployment.findUnique({ where: { id: deploymentId } });
      if (deployment && (deployment.status === "SUCCESS" || deployment.status === "FAILED")) {
        send(ws, { type: "status", deploymentId, status: deployment.status });
      }
    });

    ws.on("close", () => unsubscribe(currentSub));
  });

  log.info("ws server attached");
}
