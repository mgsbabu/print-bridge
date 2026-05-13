import { describe, it, expect, vi } from "vitest";
import type http from "node:http";
import { HttpSupervisor } from "../src/main/supervisor";
import { ErrorRing } from "../src/main/error-ring";

function fakeServer(): http.Server {
  return { close: vi.fn() } as unknown as http.Server;
}

interface FakeTimers {
  setTimeout: ReturnType<typeof vi.fn>;
  flush: () => void;
}

function makeTimers(): FakeTimers {
  const queue: Array<() => void> = [];
  return {
    setTimeout: vi.fn((fn: () => void, _ms: number) => {
      queue.push(fn);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }),
    flush: () => {
      while (queue.length) queue.shift()!();
    },
  };
}

describe("HttpSupervisor", () => {
  it("starts the server immediately on construction", () => {
    const start = vi.fn(fakeServer);
    new HttpSupervisor({ start, errorRing: new ErrorRing(), timers: makeTimers() });
    expect(start).toHaveBeenCalledOnce();
  });

  it("records the crash and restarts the server", () => {
    const ring = new ErrorRing();
    let i = 0;
    const servers: http.Server[] = [];
    const start = vi.fn(() => {
      const s = fakeServer();
      servers.push(s);
      return s;
    });
    const timers = makeTimers();
    const supervisor = new HttpSupervisor({ start, errorRing: ring, timers });

    supervisor.handleCrash(new Error("boom"), "UNCAUGHT");
    expect(ring.list()).toHaveLength(1);
    expect(ring.list()[0].msg).toBe("boom");
    expect(timers.setTimeout).toHaveBeenCalledOnce();

    timers.flush();
    expect(start).toHaveBeenCalledTimes(2);
    expect(servers[0].close).toHaveBeenCalledOnce();
    expect(supervisor.server()).toBe(servers[1]);
    i++;
  });

  it("coalesces back-to-back crashes into a single restart", () => {
    const ring = new ErrorRing();
    const start = vi.fn(fakeServer);
    const timers = makeTimers();
    const supervisor = new HttpSupervisor({ start, errorRing: ring, timers });

    supervisor.handleCrash(new Error("a"));
    supervisor.handleCrash(new Error("b"));
    supervisor.handleCrash(new Error("c"));

    expect(ring.list().map((r) => r.msg)).toEqual(["a", "b", "c"]);
    expect(timers.setTimeout).toHaveBeenCalledOnce();
    timers.flush();
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("handles a non-Error crash payload gracefully", () => {
    const ring = new ErrorRing();
    const start = vi.fn(fakeServer);
    const supervisor = new HttpSupervisor({
      start,
      errorRing: ring,
      timers: makeTimers(),
    });
    supervisor.handleCrash("string failure", "UNHANDLED_REJECTION");
    expect(ring.list()[0].msg).toBe("string failure");
    expect(ring.list()[0].code).toBe("UNHANDLED_REJECTION");
  });

  it("survives if a restart attempt throws", () => {
    const ring = new ErrorRing();
    let firstCall = true;
    const start = vi.fn(() => {
      if (firstCall) {
        firstCall = false;
        return fakeServer();
      }
      throw new Error("port already in use");
    });
    const timers = makeTimers();
    const supervisor = new HttpSupervisor({ start, errorRing: ring, timers });
    supervisor.handleCrash(new Error("boom"));
    expect(() => timers.flush()).not.toThrow();
  });
});
