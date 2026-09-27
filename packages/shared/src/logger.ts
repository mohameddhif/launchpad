type Level = "debug" | "info" | "warn" | "error";

function log(level: Level, scope: string, msg: string, meta?: Record<string, unknown>) {
  const entry = {
    level,
    scope,
    msg,
    ts: new Date().toISOString(),
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createLogger(scope: string) {
  return {
    debug: (msg: string, meta?: Record<string, unknown>) => log("debug", scope, msg, meta),
    info: (msg: string, meta?: Record<string, unknown>) => log("info", scope, msg, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => log("warn", scope, msg, meta),
    error: (msg: string, meta?: Record<string, unknown>) => log("error", scope, msg, meta),
  };
}
