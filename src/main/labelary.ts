import { log } from "./logger";

export interface LabelaryResult {
  ok: boolean;
  reason?: string;
}

const LABELARY_URL = "https://api.labelary.com/v1/printers/8dpmm/labels/4x6/0/";

export async function validateZpl(zpl: string, timeoutMs = 3000): Promise<LabelaryResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(LABELARY_URL, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: zpl,
      signal: controller.signal,
    });
    if (r.status === 200) return { ok: true };
    if (r.status === 400) {
      const text = await r.text().catch(() => "");
      return { ok: false, reason: text || "Labelary rejected ZPL syntax" };
    }
    log.warn({ status: r.status }, "labelary returned unexpected status; passing through");
    return { ok: true };
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : err }, "labelary unreachable; skipping validation");
    return { ok: true };
  } finally {
    clearTimeout(timer);
  }
}
