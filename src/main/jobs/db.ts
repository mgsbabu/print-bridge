import Database from "better-sqlite3";
import { app } from "electron";
import path from "node:path";

export const JOBS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    printer TEXT NOT NULL,
    language TEXT NOT NULL,
    copies_requested INTEGER NOT NULL,
    copies_acknowledged INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_ts ON jobs(ts DESC);
`;

export function openJobsDb(filename?: string): Database.Database {
  const dbPath = filename ?? path.join(app.getPath("userData"), "jobs.db");
  const db = new Database(dbPath);
  db.exec(JOBS_SCHEMA);
  return db;
}
