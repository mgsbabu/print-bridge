/**
 * Which web origins a paired Bridge answers to.
 *
 * <h2>Why this is not in store.ts</h2>
 * It lives beside the protocol rather than beside the pairing record because
 * {@code store.ts} imports {@code electron} for {@code safeStorage}. The CORS
 * layer in {@code server.ts} needs this function at runtime, and pulling it
 * from the store would drag Electron into the Express app — and into the test
 * harness, which runs under plain Node. The rule this file exists to keep:
 * anything the server needs as a *value* rather than a type must not sit
 * behind an Electron import.
 */

/** The pairing fields that decide the allow-list. Structural on purpose, so
 *  both {@code PairingRecord} and a raw {@code PairRequest} satisfy it. */
export interface OriginBearing {
  tenantOrigin: string;
  tenantOrigins?: string[];
}

/**
 * Every origin the pairing accepts — de-duplicated, primary first.
 *
 * <p>This is the single place the Bridge's single-origin history is absorbed.
 * A pairing written before multi-origin support carries no
 * {@code tenantOrigins} and reads here as a list of one, so no caller has to
 * branch on which shape it was handed.
 *
 * <p>An absent pairing yields an empty list, and the CORS layer must read that
 * as "refuse every cross-origin request" rather than "allow any". An unpaired
 * Bridge answering a stranger is precisely what the allow-list exists to stop:
 * until /pair has run, no web page has proved it belongs to this counter.
 */
export function allowedOrigins(p: OriginBearing | null | undefined): string[] {
  if (!p) return [];
  return [...new Set([p.tenantOrigin, ...(p.tenantOrigins ?? [])])];
}
