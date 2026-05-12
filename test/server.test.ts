import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { createApp, type ServerDeps } from "../src/main/server";
import type { PairingRecord } from "../src/main/store";

interface Harness {
  url: string;
  server: http.Server;
  state: { pairing: PairingRecord | null };
}

async function startHarness(initial: PairingRecord | null): Promise<Harness> {
  const state: { pairing: PairingRecord | null } = { pairing: initial };
  const deps: ServerDeps = {
    getPairing: () => state.pairing,
    setPairing: (p) => {
      state.pairing = p;
    },
    appVersion: "0.0.0-test",
    startedAt: Date.now(),
  };
  const app = createApp(deps);
  const server: http.Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, state };
}

const VALID_PAIR: PairingRecord = {
  tenantId: 13,
  orgUnitId: 12,
  token: "a".repeat(64),
  tenantOrigin: "https://app.tailorapp.in",
};

describe("POST /pair", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await startHarness(null);
  });
  afterEach(() => h.server.close());

  it("200 with valid body, persists the pairing", async () => {
    const r = await fetch(`${h.url}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(VALID_PAIR),
    });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ paired: true });
    expect(h.state.pairing).toEqual(VALID_PAIR);
  });

  it("400 with bad body (missing tenantOrigin)", async () => {
    const { tenantOrigin: _, ...bad } = VALID_PAIR;
    const r = await fetch(`${h.url}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bad),
    });
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.errorCode).toBe("BAD_PAYLOAD");
  });

  it("400 with bad body (token too short)", async () => {
    const r = await fetch(`${h.url}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...VALID_PAIR, token: "short" }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).errorCode).toBe("BAD_PAYLOAD");
  });
});

describe("GET /health", () => {
  it("401 without token (unpaired)", async () => {
    const h = await startHarness(null);
    try {
      const r = await fetch(`${h.url}/health`);
      expect(r.status).toBe(401);
      expect((await r.json()).errorCode).toBe("UNAUTHORIZED");
    } finally {
      h.server.close();
    }
  });

  it("401 without token (paired)", async () => {
    const h = await startHarness(VALID_PAIR);
    try {
      const r = await fetch(`${h.url}/health`);
      expect(r.status).toBe(401);
    } finally {
      h.server.close();
    }
  });

  it("401 with wrong token", async () => {
    const h = await startHarness(VALID_PAIR);
    try {
      const r = await fetch(`${h.url}/health`, {
        headers: { "X-Bridge-Token": "wrong-token" },
      });
      expect(r.status).toBe(401);
    } finally {
      h.server.close();
    }
  });

  it("200 with valid token", async () => {
    const h = await startHarness(VALID_PAIR);
    try {
      const r = await fetch(`${h.url}/health`, {
        headers: { "X-Bridge-Token": VALID_PAIR.token },
      });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.version).toBe("0.0.0-test");
      expect(body.tenantId).toBe(VALID_PAIR.tenantId);
      expect(body.orgUnitId).toBe(VALID_PAIR.orgUnitId);
      expect(body.loadedPrinters).toEqual([]);
      expect(typeof body.uptimeSeconds).toBe("number");
    } finally {
      h.server.close();
    }
  });
});
