export interface ErrorRecord {
  ts: number;
  msg: string;
  code?: string;
}

/**
 * In-memory ring buffer of the most recent N errors. Surfaced via
 * /health.recentErrors for the support runbook so an operator can
 * read the last few failures without SSHing into the outlet PC.
 *
 * Never store payloadBase64 or tokens here — only the human-readable
 * message + a short error code. Full stack traces stay in pino logs.
 */
export class ErrorRing {
  private buf: ErrorRecord[] = [];
  private readonly capacity: number;
  private readonly now: () => number;

  constructor(capacity = 50, now: () => number = Date.now) {
    this.capacity = capacity;
    this.now = now;
  }

  record(err: unknown, code?: string): void {
    const msg = err instanceof Error ? err.message : String(err);
    this.buf.push({ ts: this.now(), msg, code });
    if (this.buf.length > this.capacity) this.buf.shift();
  }

  list(): ErrorRecord[] {
    return [...this.buf];
  }

  size(): number {
    return this.buf.length;
  }

  clear(): void {
    this.buf = [];
  }
}
