import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { createApp } from "../src/main/server";
import type { PairingRecord } from "../src/main/store";
import { allowedOrigins } from "../src/shared/origins";

/**
 * Which web pages this counter's Bridge will talk to.
 *
 * <h3>The failure this protects against</h3>
 * The Bridge allowed exactly one origin — the one it happened to be paired
 * from. A counter reachable at a second hostname (a tenant on a custom domain
 * who also uses the platform domain, or one machine serving two brands) failed
 * the CORS preflight on every route but /pair. The browser blocked the call,
 * fetch threw, and the web app reported the Bridge "offline" — while it sat
 * there running and had never received the request. Nothing was logged at
 * either end, which is why it read as a network fault rather than a policy one.
 *
 * <h3>What must not regress</h3>
 * Widening the list must not weaken it. The allow-list stays named: no
 * wildcard, and an unpaired Bridge still refuses everyone. Reflecting an
 * arbitrary Origin back would let any page on the internet drive a printer on
 * the shop floor of anyone who has the agent installed.
 */

const ORIGIN_A = "https://web.fabtailor.in";
const ORIGIN_B = "https://web.fabklean.com";
const STRANGER = "https://not-ours.example.com";

function pairing(extra?: string[]): PairingRecord {
  return {
    tenantId: 13,
    orgUnitId: 12,
    token: "a".repeat(64),
    tenantOrigin: ORIGIN_A,
    ...(extra ? { tenantOrigins: extra } : {}),
  };
}

describe("allowedOrigins", () => {
  /** The compatibility case: every pairing already on a shop floor. */
  it("a pairing written before multi-origin reads as a list of one", () => {
    expect(allowedOrigins(pairing())).toEqual([ORIGIN_A]);
  });

  it("keeps the paired origin first, then the added ones", () => {
    expect(allowedOrigins(pairing([ORIGIN_B]))).toEqual([ORIGIN_A, ORIGIN_B]);
  });

  /** Re-pairing from B while B is already listed must not list it twice. */
  it("de-duplicates", () => {
    expect(allowedOrigins(pairing([ORIGIN_A, ORIGIN_B, ORIGIN_B])))
      .toEqual([ORIGIN_A, ORIGIN_B]);
  });

  it("an unpaired Bridge allows nobody", () => {
    expect(allowedOrigins(null)).toEqual([]);
  });
});

describe("CORS on a paired Bridge", () => {
  let server: http.Server;
  let url: string;
  let state: { pairing: PairingRecord | null };

  function start(p: PairingRecord | null): Promise<void> {
    state = { pairing: p };
    const app = createApp({
      getPairing: () => state.pairing,
      setPairing: (x) => {
        state.pairing = x;
      },
      appVersion: "test",
      listPrinters: () => [],
      refreshPrinters: async () => [],
      dispatchPdf: async () => ({ dispatched: true, copiesAcknowledged: 1 }),
      dispatchZpl: async () => ({ dispatched: true, copiesAcknowledged: 1 }),
      dispatchEscpos: async () => ({ dispatched: true, copiesAcknowledged: 1 }),
      dispatchTspl: async () => ({ dispatched: true, copiesAcknowledged: 1 }),
    });
    return new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  afterEach(() => server?.close());

  /** The preflight is where the old bug actually bit: the browser never sent
   *  the real request, so no log anywhere recorded a refusal. */
  async function preflight(origin: string): Promise<Response> {
    return fetch(`${url}/printers`, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "x-bridge-token",
      },
    });
  }

  it("allows the origin it was paired from", async () => {
    await start(pairing());
    const r = await preflight(ORIGIN_A);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN_A);
  });

  /** The reported bug, from the second brand's domain. */
  it("allows a second origin once it has been added", async () => {
    await start(pairing([ORIGIN_B]));
    const r = await preflight(ORIGIN_B);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN_B);
  });

  it("still allows the first origin after a second is added", async () => {
    await start(pairing([ORIGIN_B]));
    const r = await preflight(ORIGIN_A);
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN_A);
  });

  it("refuses an origin nobody paired", async () => {
    await start(pairing([ORIGIN_B]));
    const r = await preflight(STRANGER);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("never answers with a wildcard", async () => {
    await start(pairing([ORIGIN_B]));
    const r = await preflight(ORIGIN_A);
    expect(r.headers.get("access-control-allow-origin")).not.toBe("*");
  });

  it("an unpaired Bridge refuses even a plausible origin", async () => {
    await start(null);
    const r = await preflight(ORIGIN_A);
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });

  /** /pair must stay open to any origin, or a fresh install could never be
   *  paired from anywhere — it is the one route with no allow-list to consult
   *  yet, and it is why the bug looked like "offline" rather than "refused". */
  it("/pair stays reachable from an unpaired origin", async () => {
    await start(null);
    const r = await fetch(`${url}/pair`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN_B,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type",
      },
    });
    expect(r.headers.get("access-control-allow-origin")).toBe(ORIGIN_B);
  });
});
