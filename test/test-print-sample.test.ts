import { describe, it, expect } from "vitest";
import { buildEscposSample, buildZplSample } from "../src/main/test-print-sample";

const GS_V = Buffer.from([0x1d, 0x56]); // GS V — paper cut

describe("buildEscposSample", () => {
  it("starts with ESC @ and contains BRIDGE OK", () => {
    const b = buildEscposSample(new Date("2026-06-16T10:00:00Z"));
    expect(b[0]).toBe(0x1b);
    expect(b[1]).toBe(0x40);
    expect(b.includes(Buffer.from("BRIDGE OK"))).toBe(true);
  });

  it("does NOT cut by default (cutter-less printers like TM-T82X)", () => {
    const b = buildEscposSample(new Date("2026-06-16T10:00:00Z"));
    expect(b.includes(GS_V)).toBe(false);
    // feed-to-tear: ends in a line feed
    expect(b[b.length - 1]).toBe(0x0a);
  });

  it("emits a partial cut when { cut: true }", () => {
    const b = buildEscposSample(new Date("2026-06-16T10:00:00Z"), { cut: true });
    expect(b.subarray(-3).equals(Buffer.from([0x1d, 0x56, 0x01]))).toBe(true);
  });
});

describe("buildZplSample", () => {
  it("wraps content in ^XA/^XZ", () => {
    const s = buildZplSample(new Date("2026-06-16T10:00:00Z"));
    expect(s.startsWith("^XA")).toBe(true);
    expect(s.trimEnd().endsWith("^XZ")).toBe(true);
  });
});
