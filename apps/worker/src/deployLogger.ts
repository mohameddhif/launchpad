import { prisma, createRedisConnection, logChannel, type LogStream, type LogEvent } from "@launchpad/shared";

const FLUSH_INTERVAL_MS = 1000;
const FLUSH_BATCH_SIZE = 50;

/**
 * Every log line goes to two sinks: Redis pub/sub for whoever is watching the build live,
 * and a batched Postgres insert for replay after the fact. The dashboard joins the two by
 * `seq`, so a viewer who opens mid-build sees history first and then the live tail with no
 * gap and no duplicate lines.
 */
export class DeployLogger {
  private seq = 0;
  private buffer: { seq: number; stream: LogStream; message: string }[] = [];
  private readonly flushTimer: NodeJS.Timeout;
  private readonly redis = createRedisConnection();
  private closed = false;

  constructor(private readonly deploymentId: string) {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, FLUSH_INTERVAL_MS);
  }

  log(stream: LogStream, message: string): void {
    if (this.closed) return;
    const seq = this.seq++;
    const event: LogEvent = {
      deploymentId: this.deploymentId,
      seq,
      stream,
      message,
      ts: new Date().toISOString(),
    };
    void this.redis.publish(logChannel(this.deploymentId), JSON.stringify(event));
    this.buffer.push({ seq, stream, message });
    if (this.buffer.length >= FLUSH_BATCH_SIZE) {
      void this.flush();
    }
  }

  system(message: string): void {
    this.log("system", message);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer.splice(0, this.buffer.length);
    await prisma.deploymentLog.createMany({
      data: batch.map((b) => ({
        deploymentId: this.deploymentId,
        seq: b.seq,
        stream: b.stream,
        message: b.message,
      })),
      skipDuplicates: true,
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    clearInterval(this.flushTimer);
    await this.flush();
    this.redis.disconnect();
  }
}
