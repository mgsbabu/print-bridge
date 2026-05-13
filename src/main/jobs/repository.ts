import type Database from "better-sqlite3";
import type { PrintLanguage } from "../../shared/protocol";

export type JobStatus = "QUEUED" | "DISPATCHED" | "FAILED";

export interface JobRow {
  id: number;
  ts: number;
  printer: string;
  language: PrintLanguage;
  copiesRequested: number;
  copiesAcknowledged: number;
  status: JobStatus;
  error: string | null;
}

export interface SuccessRate {
  total: number;
  succeeded: number;
  rate: number;
}

export class JobsRepository {
  private readonly insertStmt: Database.Statement;
  private readonly updateStmt: Database.Statement;
  private readonly listStmt: Database.Statement;
  private readonly rateStmt: Database.Statement;
  private readonly now: () => number;

  constructor(db: Database.Database, now: () => number = Date.now) {
    this.now = now;
    this.insertStmt = db.prepare(
      "INSERT INTO jobs (ts, printer, language, copies_requested, status) VALUES (?, ?, ?, ?, 'QUEUED')",
    );
    this.updateStmt = db.prepare(
      "UPDATE jobs SET copies_acknowledged = ?, status = ?, error = ? WHERE id = ?",
    );
    this.listStmt = db.prepare(
      `SELECT id, ts, printer, language,
              copies_requested AS copiesRequested,
              copies_acknowledged AS copiesAcknowledged,
              status, error
       FROM jobs ORDER BY ts DESC LIMIT ?`,
    );
    this.rateStmt = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'DISPATCHED' THEN 1 ELSE 0 END) AS succeeded
       FROM jobs WHERE ts >= ? AND status != 'QUEUED'`,
    );
  }

  insertJob(printer: string, language: PrintLanguage, copiesRequested: number): number {
    const r = this.insertStmt.run(this.now(), printer, language, copiesRequested);
    return Number(r.lastInsertRowid);
  }

  updateJobResult(
    id: number,
    copiesAcknowledged: number,
    status: JobStatus,
    error: string | null,
  ): void {
    this.updateStmt.run(copiesAcknowledged, status, error, id);
  }

  listRecentJobs(limit = 100): JobRow[] {
    return this.listStmt.all(limit) as JobRow[];
  }

  getSuccessRate(windowMs: number): SuccessRate {
    const since = this.now() - windowMs;
    const r = this.rateStmt.get(since) as { total: number; succeeded: number | null };
    const total = r.total;
    const succeeded = r.succeeded ?? 0;
    const rate = total === 0 ? 1 : succeeded / total;
    return { total, succeeded, rate };
  }
}
