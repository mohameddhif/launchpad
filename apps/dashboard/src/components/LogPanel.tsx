import { useEffect, useRef, useState } from "react";
import type { LiveLogLine } from "../hooks/useDeploymentLogs.js";

const STREAM_COLOR: Record<LiveLogLine["stream"], string> = {
  stdout: "text-zinc-300",
  stderr: "text-red-400",
  system: "text-sky-400",
};

/**
 * Auto-scrolls to the newest line, but releases that behavior the moment the viewer
 * scrolls up to read earlier output — it only re-engages once they scroll back to bottom.
 */
export function LogPanel({ lines }: { lines: LiveLogLine[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines, autoScroll]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="h-[28rem] overflow-y-auto rounded-b-xl bg-zinc-950 p-3 font-mono text-sm leading-relaxed"
    >
      {lines.length === 0 && <div className="text-zinc-500">Waiting for output…</div>}
      {lines.map((line) => (
        <div key={line.seq} className={STREAM_COLOR[line.stream]}>
          <span className="select-none text-zinc-600">{line.stream === "system" ? "· " : "  "}</span>
          {line.message}
        </div>
      ))}
    </div>
  );
}
