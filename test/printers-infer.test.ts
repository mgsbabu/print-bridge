import { describe, it, expect, vi } from "vitest";

vi.mock("pdf-to-printer", () => ({
  getPrinters: async () => [
    { name: "BIXOLON SRP-275III" },
    { name: "Bluetooth-BT-802" },
    { name: "BT802" },
    { name: "Some Laser" },
  ],
  getDefaultPrinter: async () => null,
}));
vi.mock("../src/main/store", () => ({ getNetworkPrinters: () => [] }));

import { refreshPrinters, hasAutoCutter } from "../src/main/dispatcher/printers";

describe("printer language inference", () => {
  it("maps BIXOLON SRP-275III to ESC_POS, BT-802 to TSPL, others to PDF", async () => {
    const byName = Object.fromEntries((await refreshPrinters()).map((p) => [p.name, p.language]));
    expect(byName["BIXOLON SRP-275III"]).toBe("ESC_POS");
    expect(byName["Bluetooth-BT-802"]).toBe("TSPL");
    expect(byName["BT802"]).toBe("TSPL");
    expect(byName["Some Laser"]).toBe("PDF");
  });

  it("flags only the BIXOLON as an auto-cutter", () => {
    expect(hasAutoCutter("BIXOLON SRP-275III")).toBe(true);
    expect(hasAutoCutter("SRP-275III")).toBe(true);
    expect(hasAutoCutter("Bluetooth-BT-802")).toBe(false);
    expect(hasAutoCutter("Star-TSP-USB")).toBe(false);
  });
});
