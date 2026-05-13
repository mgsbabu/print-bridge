import { describe, it, expect } from "vitest";
import { scrub, scrubString } from "../src/main/scrub";

describe("scrub", () => {
  it("redacts payloadBase64 anywhere in the tree", () => {
    const event = {
      breadcrumbs: [
        { data: { payloadBase64: "AAAA....", printer: "Zebra" } },
        { message: "ok" },
      ],
    };
    const out = scrub(event) as typeof event;
    expect(out.breadcrumbs[0].data).toEqual({
      payloadBase64: "[REDACTED]",
      printer: "Zebra",
    });
  });

  it("redacts token, tokenEnc, X-Bridge-Token, bridgeToken, Authorization, Cookie keys", () => {
    const input = {
      token: "secret-64-char",
      tokenEnc: "base64-encrypted",
      bridgeToken: "secret-64-char",
      Authorization: "Bearer xyz",
      Cookie: "session=abc",
      headers: {
        "X-Bridge-Token": "secret-64-char",
        "content-type": "application/json",
      },
    };
    const out = scrub(input) as typeof input;
    expect(out.token).toBe("[REDACTED]");
    expect(out.tokenEnc).toBe("[REDACTED]");
    expect(out.bridgeToken).toBe("[REDACTED]");
    expect(out.Authorization).toBe("[REDACTED]");
    expect(out.Cookie).toBe("[REDACTED]");
    expect((out.headers as Record<string, string>)["X-Bridge-Token"]).toBe("[REDACTED]");
    expect((out.headers as Record<string, string>)["content-type"]).toBe("application/json");
  });

  it("leaves harmless values alone", () => {
    const out = scrub({ name: "Zebra-ZD220", copies: 3, online: true });
    expect(out).toEqual({ name: "Zebra-ZD220", copies: 3, online: true });
  });

  it("handles arrays", () => {
    const out = scrub([{ token: "a" }, { token: "b" }, { name: "ok" }]);
    expect(out).toEqual([
      { token: "[REDACTED]" },
      { token: "[REDACTED]" },
      { name: "ok" },
    ]);
  });

  it("does not mutate the input", () => {
    const input = { token: "secret" };
    scrub(input);
    expect(input.token).toBe("secret");
  });

  it("handles null and undefined gracefully", () => {
    expect(scrub(null)).toBe(null);
    expect(scrub(undefined)).toBe(undefined);
    expect(scrub({ x: null })).toEqual({ x: null });
  });

  it("scrubString replaces long base64-shaped strings", () => {
    const blob = "A".repeat(300);
    expect(scrubString(blob)).toBe("[BASE64 REDACTED]");
  });

  it("scrubString leaves regular long strings alone", () => {
    const msg = "this is a long human-readable error message ".repeat(20);
    expect(scrubString(msg)).toBe(msg);
  });
});
