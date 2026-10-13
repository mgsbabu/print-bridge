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

  describe("auto-cutter printers (BIXOLON SRP-275III)", () => {
    const osLookup = (name: string) => (): PrinterLookup => ({
      kind: "os",
      record: {
        name,
        language: "ESC_POS",
        mediaWidthMm: null,
        mediaHeightMm: null,
        mediaKind: null,
        isDefault: false,
        online: true,
      },
    });

    it("appends feed+cut when the payload has none, once per copy", async () => {
      const sendLocalRaw = vi.fn(async () => undefined);
      const name = "BIXOLON SRP-275III";
      const result = await dispatchEscpos(req({ printerName: name, copies: 2 }), {
        sendLocalRaw,
        lookup: osLookup(name),
      });
      expect(result).toEqual({ dispatched: true, copiesAcknowledged: 2 });
      expect(sendLocalRaw).toHaveBeenCalledTimes(2);
      const sent = sendLocalRaw.mock.calls[0][1] as unknown as Buffer;
      expect(sent.subarray(0, RECEIPT_BYTES.length)).toEqual(RECEIPT_BYTES);
      expect(sent.subarray(RECEIPT_BYTES.length)).toEqual(Buffer.from([0x1d, 0x56, 0x42, 0x03]));
    });

    it("does not double-cut when the payload already has a cut command", async () => {
      const sendLocalRaw = vi.fn(async () => undefined);
      const name = "BIXOLON SRP-275III";
      const withCut = Buffer.concat([RECEIPT_BYTES, Buffer.from([0x1d, 0x56, 0x01])]);
      await dispatchEscpos(req({ printerName: name, payloadBase64: withCut.toString("base64") }), {
        sendLocalRaw,
        lookup: osLookup(name),
      });
      expect(sendLocalRaw.mock.calls[0][1]).toEqual(withCut);
    });

    it("leaves non-cutter printers untouched", async () => {
      const sendLocalRaw = vi.fn(async () => undefined);
      await dispatchEscpos(req({ printerName: "Star-TSP-USB" }), {
        sendLocalRaw,
        lookup: osLookup("Star-TSP-USB"),
      });
      expect(sendLocalRaw.mock.calls[0][1]).toEqual(RECEIPT_BYTES);
    });
  });

  it("returns PRINTER_NOT_FOUND when printer is unknown", async () => {
    const result = await dispatchEscpos(req(), { lookup: () => null });
    expect(result).toMatchObject({
      dispatched: false,
      errorCode: "PRINTER_NOT_FOUND",
    });
  });
});
