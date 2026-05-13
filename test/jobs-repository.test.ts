import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { JOBS_SCHEMA } from "../src/main/jobs/db";
import { JobsRepository } from "../src/main/jobs/repository";

let now = 1_000_000_000_000;
const clock = () => now;

function makeRepo(): JobsRepository {
  const db = new Database(":memory:");
  db.exec(JOBS_SCHEMA);
  return new JobsRepository(db, clock);
}

beforeEach(() => {
  now = 1_000_000_000_000;
});

describe("JobsRepository", () => {
  it("insertJob creates a QUEUED row and returns its id", () => {
    const repo = makeRepo();
    const id = repo.insertJob("Zebra-ZD220", "ZPL", 3);
    expect(id).toBeGreaterThan(0);

    const [row] = repo.listRecentJobs(10);
    expect(row).toMatchObject({
      id,
      printer: "Zebra-ZD220",
      language: "ZPL",
      copiesRequested: 3,
      copiesAcknowledged: 0,
      status: "QUEUED",
      error: null,
    });
  });

  it("updateJobResult flips status and records ack count", () => {
    const repo = makeRepo();
    const id = repo.insertJob("Zebra-ZD220", "ZPL", 3);
    repo.updateJobResult(id, 3, "DISPATCHED", null);

    const [row] = repo.listRecentJobs(10);
    expect(row.status).toBe("DISPATCHED");
    expect(row.copiesAcknowledged).toBe(3);
    expect(row.error).toBe(null);
  });

  it("updateJobResult persists error text on failure", () => {
    const repo = makeRepo();
    const id = repo.insertJob("offline-printer", "ZPL", 1);
    repo.updateJobResult(id, 0, "FAILED", "ECONNREFUSED");

    const [row] = repo.listRecentJobs(10);
    expect(row.status).toBe("FAILED");
    expect(row.error).toBe("ECONNREFUSED");
  });

  it("listRecentJobs returns newest first and respects limit", () => {
    const repo = makeRepo();
    for (let i = 0; i < 5; i++) {
      now += 1000;
      repo.insertJob(`p${i}`, "ZPL", 1);
    }
    const rows = repo.listRecentJobs(3);
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.printer)).toEqual(["p4", "p3", "p2"]);
  });

  it("getSuccessRate excludes QUEUED rows and computes rate inside the window", () => {
    const repo = makeRepo();
    // 3 dispatched, 1 failed within the window
    for (let i = 0; i < 3; i++) {
      const id = repo.insertJob(`p${i}`, "ZPL", 1);
      repo.updateJobResult(id, 1, "DISPATCHED", null);
    }
    const failedId = repo.insertJob("offline", "ZPL", 1);
    repo.updateJobResult(failedId, 0, "FAILED", "ECONNREFUSED");
    // 1 still queued — should not count
    repo.insertJob("pending", "ZPL", 1);

    const window = repo.getSuccessRate(60_000);
    expect(window.total).toBe(4);
    expect(window.succeeded).toBe(3);
    expect(window.rate).toBeCloseTo(0.75, 5);
  });

  it("getSuccessRate returns rate=1 when no jobs in window (no-news-is-good-news)", () => {
    const repo = makeRepo();
    const r = repo.getSuccessRate(60_000);
    expect(r).toEqual({ total: 0, succeeded: 0, rate: 1 });
  });

  it("getSuccessRate ignores jobs older than the window", () => {
    const repo = makeRepo();
    const oldId = repo.insertJob("old", "ZPL", 1);
    repo.updateJobResult(oldId, 0, "FAILED", "old failure");

    now += 10 * 60_000; // 10 minutes pass
    const newId = repo.insertJob("new", "ZPL", 1);
    repo.updateJobResult(newId, 1, "DISPATCHED", null);

    const r = repo.getSuccessRate(5 * 60_000);
    expect(r.total).toBe(1);
    expect(r.succeeded).toBe(1);
    expect(r.rate).toBe(1);
  });
});
