import { describe, it, expect, vi } from "vitest";

vi.mock("pdf-to-printer", () => ({
  getPrinters: async () => [
    { name: "BIXOLON SRP-275III" },
    { name: "Bluetooth-BT-802" },
    { name: "BT802" },
    { name: "Unnati TT 203 DPI Premium" },
    { name: "Some Laser" },
    { name: "TSC TTP-244 Pro" },
    { name: "TSC TE244" },
    { name: "TTP-244M Pro" },
    { name: "GODEX G500" },
    { name: "EPSON TM-T82" },
    { name: "Star TSP143" },
    { name: "POS-80C" },
    { name: "HP LaserJet Pro M404 A4" },
    { name: "Canon iR A5" },
    { name: "Microsoft Print to PDF" },
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
    for (const n of ["TSC TTP-244 Pro", "TSC TE244", "TTP-244M Pro"]) expect(byName[n]).toBe("TSPL");
    expect(byName["GODEX G500"]).toBe("ZPL");
    for (const n of ["EPSON TM-T82", "Star TSP143", "POS-80C"]) expect(byName[n]).toBe("ESC_POS");
    for (const n of ["HP LaserJet Pro M404 A4", "Canon iR A5", "Microsoft Print to PDF"])
      expect(byName[n]).toBe("PDF");
  });

  it("flags only the BIXOLON as an auto-cutter", () => {
    expect(hasAutoCutter("BIXOLON SRP-275III")).toBe(true);
    expect(hasAutoCutter("SRP-275III")).toBe(true);
    expect(hasAutoCutter("Bluetooth-BT-802")).toBe(false);
    expect(hasAutoCutter("Star-TSP-USB")).toBe(false);
  });
});
