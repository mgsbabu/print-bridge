import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { validateZpl } from "../src/main/labelary";

describe("validateZpl", () => {
  let fetchMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchMock = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    fetchMock.mockRestore();
  });

  it("returns ok on 200", async () => {
    fetchMock.mockResolvedValueOnce(new Response("png-bytes", { status: 200 }));
    const r = await validateZpl("^XA^FDhi^XZ");
    expect(r).toEqual({ ok: true });
  });

  it("returns not-ok on 400 with labelary's reason", async () => {
    fetchMock.mockResolvedValueOnce(new Response("invalid ^XX command", { status: 400 }));
    const r = await validateZpl("^XA^XX^XZ");
    expect(r).toMatchObject({ ok: false });
    expect(r.reason).toContain("invalid");
  });

  it("passes through when labelary returns unexpected status", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));
    const r = await validateZpl("^XA^XZ");
    expect(r).toEqual({ ok: true });
  });

  it("passes through on network error (graceful skip)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("ENETUNREACH"));
    const r = await validateZpl("^XA^XZ");
    expect(r).toEqual({ ok: true });
  });

  it("passes through on timeout (AbortError)", async () => {
    fetchMock.mockImplementationOnce(
      (_, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const r = await validateZpl("^XA^XZ", 10);
    expect(r).toEqual({ ok: true });
  });
});
