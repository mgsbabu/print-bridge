import { describe, it, expect, vi } from "vitest";

vi.mock("pdf-to-printer", () => ({
  getPrinters: async () => [
    { name: "BIXOLON SRP-275III" },
    { name: "Bluetooth-BT-802" },
    { name: "BT802" },
    { name: "Unnati TT 203 DPI Premium" },
    { name: "Some Laser" },
  ],
  getDefaultPrinter: async () => null,
}));
vi.mock("../src/main/store", () => ({ getNetworkPrinters: () => [] }));

import { refreshPrinters, hasAutoCutter } from "../src/main/dispatcher/printers";

describe("printer language inference", () => {
  it("maps BIXOLON SRP-275III and BT-802 receipt printers to ESC_POS, others to PDF", async () => {
    // refreshPrinters reads CUPS off Windows; this test exercises the Windows path.
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const byName = Object.fromEntries((await refreshPrinters()).map((p) => [p.name, p.language]));
    expect(byName["BIXOLON SRP-275III"]).toBe("ESC_POS");
    expect(byName["Bluetooth-BT-802"]).toBe("ESC_POS");
    expect(byName["BT802"]).toBe("ESC_POS");
    expect(byName["Unnati TT 203 DPI Premium"]).toBe("TSPL");
    expect(byName["Some Laser"]).toBe("PDF");
  });

  it("flags only the BIXOLON as an auto-cutter", () => {
    expect(hasAutoCutter("BIXOLON SRP-275III")).toBe(true);
    expect(hasAutoCutter("SRP-275III")).toBe(true);
    expect(hasAutoCutter("Bluetooth-BT-802")).toBe(false);
    expect(hasAutoCutter("Star-TSP-USB")).toBe(false);
  });
});
