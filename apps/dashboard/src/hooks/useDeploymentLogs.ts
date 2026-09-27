import { useEffect, useRef, useState } from "react";
import type { DeploymentStatus } from "../lib/api.js";

export interface LiveLogLine {
  seq: number;
  stream: "stdout" | "stderr" | "system";
  message: string;
  ts: string;
}

interface WsMessage {
  type: "log" | "status";
  seq?: number;
  stream?: LiveLogLine["stream"];
  message?: string;
  ts?: string;
  status?: DeploymentStatus;
}

/**
 * Subscribes to one deployment's log stream over the shared /ws endpoint. The server
 * replays history before switching to live events, both tagged with a monotonic seq, so
 * this hook only needs to de-dupe by seq — never re-sort or reconcile gaps itself.
 */
export function useDeploymentLogs(deploymentId: string | undefined) {
  const [lines, setLines] = useState<LiveLogLine[]>([]);
  const [terminalStatus, setTerminalStatus] = useState<DeploymentStatus | null>(null);
  const [connected, setConnected] = useState(false);
  const seenSeqs = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (!deploymentId) return;
    setLines([]);
    setTerminalStatus(null);
    seenSeqs.current = new Set();

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({ subscribe: `deployment:${deploymentId}` }));
    };
    ws.onclose = () => setConnected(false);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data) as WsMessage;
      if (msg.type === "log" && msg.seq !== undefined && msg.stream && msg.message !== undefined && msg.ts) {
        if (seenSeqs.current.has(msg.seq)) return;
        seenSeqs.current.add(msg.seq);
        setLines((prev) => [...prev, { seq: msg.seq!, stream: msg.stream!, message: msg.message!, ts: msg.ts! }]);
      } else if (msg.type === "status" && msg.status) {
        setTerminalStatus(msg.status);
      }
    };

    return () => ws.close();
  }, [deploymentId]);

  return { lines, terminalStatus, connected };
}
