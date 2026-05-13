import { describe, it, expect, vi } from "vitest";
import { dispatchEscpos } from "../src/main/dispatcher/escpos";
import type { PrinterLookup } from "../src/main/dispatcher/printers";
import type { PrintRequest } from "../src/shared/protocol";

const RECEIPT_BYTES = Buffer.from([0x1b, 0x40, 0x42, 0x52, 0x49, 0x44, 0x47, 0x45]);
const PAYLOAD = RECEIPT_BYTES.toString("base64");

const req = (overrides: Partial<PrintRequest> = {}): PrintRequest => ({
  printerName: "Star-TSP-net",
  language: "ESC_POS",
  payloadBase64: PAYLOAD,
  copies: 1,
  jobRef: 7,
  ...overrides,
});

describe("dispatchEscpos", () => {
  it("routes to sendNetwork for network printers; no labelary call", async () => {
    const sendNetwork = vi.fn(async () => undefined);
    const lookup = vi.fn(
      (): PrinterLookup => ({
        kind: "network",
        record: {
          name: "Star-TSP-net",
          ip: "192.168.1.40",
          port: 9100,
          language: "ESC_POS",
          mediaWidthMm: null,
          mediaHeightMm: null,
          mediaKind: null,
        },
      }),
    );
    const result = await dispatchEscpos(req({ copies: 2 }), { sendNetwork, lookup });
    expect(result).toEqual({ dispatched: true, copiesAcknowledged: 2 });
    expect(sendNetwork).toHaveBeenCalledTimes(2);
    expect(sendNetwork).toHaveBeenCalledWith("192.168.1.40", 9100, expect.any(Buffer));
  });

  it("routes to sendLocalRaw for OS printers", async () => {
    const sendLocalRaw = vi.fn(async () => undefined);
    const result = await dispatchEscpos(req({ printerName: "Star-TSP-USB" }), {
      sendLocalRaw,
      lookup: (): PrinterLookup => ({
        kind: "os",
        record: {
          name: "Star-TSP-USB",
          language: "ESC_POS",
          mediaWidthMm: null,
          mediaHeightMm: null,
          mediaKind: null,
          isDefault: false,
          online: true,
        },
      }),
    });
    expect(result.dispatched).toBe(true);
    expect(sendLocalRaw).toHaveBeenCalledOnce();
  });

  it("returns PRINTER_NOT_FOUND when printer is unknown", async () => {
    const result = await dispatchEscpos(req(), { lookup: () => null });
    expect(result).toMatchObject({
      dispatched: false,
      errorCode: "PRINTER_NOT_FOUND",
    });
  });
});
