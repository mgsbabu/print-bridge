import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { createApp, type ServerDeps } from "../src/main/server";
import type { PairingRecord } from "../src/main/store";
import type { LoadedPrinter, PrintRequest } from "../src/shared/protocol";
import type { PrintResult } from "../src/main/dispatcher/pdf";

interface Harness {
  url: string;
  server: http.Server;
  state: { pairing: PairingRecord | null; printers: LoadedPrinter[] };
  dispatchPdf: ReturnType<typeof vi.fn<[PrintRequest], Promise<PrintResult>>>;
  dispatchZpl: ReturnType<typeof vi.fn<[PrintRequest], Promise<PrintResult>>>;
}

const okResult = async (req: PrintRequest): Promise<PrintResult> => ({
  dispatched: true,
  copiesAcknowledged: req.copies,
});

async function startHarness(
  initial: PairingRecord | null,
  printers: LoadedPrinter[] = [],
  dispatchImpl: (req: PrintRequest) => Promise<PrintResult> = okResult,
  zplImpl: (req: PrintRequest) => Promise<PrintResult> = okResult,
): Promise<Harness> {
  const state = { pairing: initial, printers };
  const dispatchPdf = vi.fn(dispatchImpl);
  const dispatchZpl = vi.fn(zplImpl);
  const deps: ServerDeps = {
    getPairing: () => state.pairing,
    setPairing: (p) => {
      state.pairing = p;
    },
    appVersion: "0.0.0-test",
    startedAt: Date.now(),
    listPrinters: () => state.printers,
    refreshPrinters: async () => state.printers,
    dispatchPdf,
    dispatchZpl,
  };
  const app = createApp(deps);
  const server: http.Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, server, state, dispatchPdf, dispatchZpl };
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

const ZEBRA: LoadedPrinter = {
  name: "Zebra-ZD220",
  language: "PDF",
  mediaWidthMm: null,
  mediaHeightMm: null,
  mediaKind: null,
  isDefault: true,
  online: true,
};

const VALID_PRINT: PrintRequest = {
  printerName: "Zebra-ZD220",
  language: "PDF",
  payloadBase64: Buffer.from("%PDF-1.4\n%fake").toString("base64"),
  copies: 2,
  jobRef: 482,
};

describe("GET /printers", () => {
  it("401 without token", async () => {
    const h = await startHarness(VALID_PAIR, [ZEBRA]);
    try {
      const r = await fetch(`${h.url}/printers`);
      expect(r.status).toBe(401);
    } finally {
      h.server.close();
    }
  });

  it("200 with token, returns the cached list", async () => {
    const h = await startHarness(VALID_PAIR, [ZEBRA]);
    try {
      const r = await fetch(`${h.url}/printers`, {
        headers: { "X-Bridge-Token": VALID_PAIR.token },
      });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual([ZEBRA]);
    } finally {
      h.server.close();
    }
  });
});

describe("POST /print", () => {
  it("401 without token", async () => {
    const h = await startHarness(VALID_PAIR, [ZEBRA]);
    try {
      const r = await fetch(`${h.url}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(VALID_PRINT),
      });
      expect(r.status).toBe(401);
      expect(h.dispatchPdf).not.toHaveBeenCalled();
    } finally {
      h.server.close();
    }
  });

  it("200 with PDF + valid token, forwards to dispatchPdf", async () => {
    const h = await startHarness(VALID_PAIR, [ZEBRA]);
    try {
      const r = await fetch(`${h.url}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": VALID_PAIR.token },
        body: JSON.stringify(VALID_PRINT),
      });
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ dispatched: true, copiesAcknowledged: 2 });
      expect(h.dispatchPdf).toHaveBeenCalledOnce();
      expect(h.dispatchPdf).toHaveBeenCalledWith(VALID_PRINT);
    } finally {
      h.server.close();
    }
  });

  it("400 with bad body (missing copies)", async () => {
    const h = await startHarness(VALID_PAIR, [ZEBRA]);
    try {
      const { copies: _, ...bad } = VALID_PRINT;
      const r = await fetch(`${h.url}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": VALID_PAIR.token },
        body: JSON.stringify(bad),
      });
      expect(r.status).toBe(400);
      expect((await r.json()).errorCode).toBe("BAD_PAYLOAD");
    } finally {
      h.server.close();
    }
  });

  it("200 for language=ZPL — forwards to dispatchZpl", async () => {
    const h = await startHarness(VALID_PAIR, [{ ...ZEBRA, language: "ZPL" }]);
    try {
      const r = await fetch(`${h.url}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": VALID_PAIR.token },
        body: JSON.stringify({ ...VALID_PRINT, language: "ZPL" }),
      });
      expect(r.status).toBe(200);
      expect(h.dispatchZpl).toHaveBeenCalledOnce();
      expect(h.dispatchPdf).not.toHaveBeenCalled();
    } finally {
      h.server.close();
    }
  });

  it("400 for language=ESC_POS (not implemented in M3)", async () => {
    const h = await startHarness(VALID_PAIR, [ZEBRA]);
    try {
      const r = await fetch(`${h.url}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": VALID_PAIR.token },
        body: JSON.stringify({ ...VALID_PRINT, language: "ESC_POS" }),
      });
      expect(r.status).toBe(400);
      const body = await r.json();
      expect(body.errorCode).toBe("BAD_PAYLOAD");
      expect(body.error).toMatch(/ESC_POS/);
    } finally {
      h.server.close();
    }
  });

  it("502 when dispatcher reports failure", async () => {
    const h = await startHarness(VALID_PAIR, [ZEBRA], async () => ({
      dispatched: false,
      copiesAcknowledged: 0,
      error: "Printer offline",
      errorCode: "PRINTER_OFFLINE" as const,
    }));
    try {
      const r = await fetch(`${h.url}/print`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": VALID_PAIR.token },
        body: JSON.stringify(VALID_PRINT),
      });
      expect(r.status).toBe(502);
      expect((await r.json()).errorCode).toBe("PRINTER_OFFLINE");
    } finally {
      h.server.close();
    }
  });
});

describe("POST /test-print", () => {
  const ZPL_PRINTER: LoadedPrinter = { ...ZEBRA, language: "ZPL" };

  it("401 without token", async () => {
    const h = await startHarness(VALID_PAIR, [ZPL_PRINTER]);
    try {
      const r = await fetch(`${h.url}/test-print`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ printerName: ZPL_PRINTER.name }),
      });
      expect(r.status).toBe(401);
    } finally {
      h.server.close();
    }
  });

  it("200 — dispatches a ZPL BRIDGE OK sample to the named printer", async () => {
    const h = await startHarness(VALID_PAIR, [ZPL_PRINTER]);
    try {
      const r = await fetch(`${h.url}/test-print`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": VALID_PAIR.token },
        body: JSON.stringify({ printerName: ZPL_PRINTER.name }),
      });
      expect(r.status).toBe(200);
      expect(h.dispatchZpl).toHaveBeenCalledOnce();
      const arg = h.dispatchZpl.mock.calls[0][0];
      expect(arg.printerName).toBe(ZPL_PRINTER.name);
      expect(arg.language).toBe("ZPL");
      const decoded = Buffer.from(arg.payloadBase64, "base64").toString("utf-8");
      expect(decoded).toContain("BRIDGE OK");
      expect(decoded).toContain("^XA");
      expect(decoded).toContain("^XZ");
    } finally {
      h.server.close();
    }
  });

  it("404 when printer is unknown", async () => {
    const h = await startHarness(VALID_PAIR, []);
    try {
      const r = await fetch(`${h.url}/test-print`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": VALID_PAIR.token },
        body: JSON.stringify({ printerName: "ghost" }),
      });
      expect(r.status).toBe(404);
      expect((await r.json()).errorCode).toBe("PRINTER_NOT_FOUND");
    } finally {
      h.server.close();
    }
  });

  it("400 when printer is not ZPL (M3 limitation)", async () => {
    const h = await startHarness(VALID_PAIR, [ZEBRA]);
    try {
      const r = await fetch(`${h.url}/test-print`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Token": VALID_PAIR.token },
        body: JSON.stringify({ printerName: ZEBRA.name }),
      });
      expect(r.status).toBe(400);
      expect((await r.json()).errorCode).toBe("BAD_PAYLOAD");
    } finally {
      h.server.close();
    }
  });
});
