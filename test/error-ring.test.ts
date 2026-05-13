import { describe, it, expect } from "vitest";
import { ErrorRing } from "../src/main/error-ring";

describe("ErrorRing", () => {
  it("records error message and optional code", () => {
    let t = 100;
    const ring = new ErrorRing(50, () => t);
    ring.record(new Error("boom"), "INTERNAL");
    t = 200;
    ring.record("plain string failure");

    const list = ring.list();
    expect(list).toEqual([
      { ts: 100, msg: "boom", code: "INTERNAL" },
      { ts: 200, msg: "plain string failure", code: undefined },
    ]);
  });

  it("drops oldest entries past capacity", () => {
    const ring = new ErrorRing(3);
    for (let i = 0; i < 5; i++) ring.record(new Error(`e${i}`));
    expect(ring.list().map((r) => r.msg)).toEqual(["e2", "e3", "e4"]);
    expect(ring.size()).toBe(3);
  });

  it("list returns a copy, so mutation does not affect the ring", () => {
    const ring = new ErrorRing(10);
    ring.record(new Error("a"));
    const snap = ring.list();
    snap.push({ ts: 0, msg: "injected" });
    expect(ring.list()).toHaveLength(1);
  });

  it("clear empties the ring", () => {
    const ring = new ErrorRing(10);
    ring.record(new Error("a"));
    ring.clear();
    expect(ring.size()).toBe(0);
  });
});
