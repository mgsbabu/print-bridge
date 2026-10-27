import { AsyncLocalStorage } from "node:async_hooks";

// Short, payload-free notes about how a job was handled (which path, which
// settings took effect). Shown in the Logs window so a print that "did nothing"
// can be explained without reading the log file. Never put payload text here.
const store = new AsyncLocalStorage<string[]>();

export function trace(note: string): void {
  store.getStore()?.push(note);
}

export async function withTrace<T>(fn: () => Promise<T>): Promise<{ result: T; notes: string[] }> {
  const notes: string[] = [];
  const result = await store.run(notes, fn);
  return { result, notes };
}
