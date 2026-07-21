import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type http from "node:http";
import { HttpSupervisor } from "../src/main/supervisor";
import { ErrorRing } from "../src/main/error-ring";

function fakeServer(): http.Server {
  return { close: vi.fn(), once: vi.fn(), on: vi.fn() } as unknown as http.Server;
}

// A fake that actually emits 'error'/'listening', for tests that need
// the supervisor to react to those events rather than calling
// handleCrash() directly.
function emittingServer(): http.Server & EventEmitter {
  return Object.assign(new EventEmitter(), { close: vi.fn() }) as unknown as http.Server &
    EventEmitter;
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

  it("tags a server 'error' event as PORT_IN_USE when the port is taken", () => {
    const ring = new ErrorRing();
    const servers: Array<http.Server & EventEmitter> = [];
    const start = vi.fn(() => {
      const s = emittingServer();
      servers.push(s);
      return s;
    });
    const timers = makeTimers();
    new HttpSupervisor({ start, errorRing: ring, timers });

    const err = Object.assign(new Error("addr in use"), { code: "EADDRINUSE" });
    servers[0].emit("error", err);

    expect(ring.list()[0].code).toBe("PORT_IN_USE");
    expect(timers.setTimeout).toHaveBeenCalledOnce();
  });

  it("backs off exponentially across consecutive failures, capped at maxRestartIntervalMs", () => {
    const ring = new ErrorRing();
    const servers: Array<http.Server & EventEmitter> = [];
    const start = vi.fn(() => {
      const s = emittingServer();
      servers.push(s);
      return s;
    });
    const timers = makeTimers();
    new HttpSupervisor({
      start,
      errorRing: ring,
      timers,
      minRestartIntervalMs: 1000,
      maxRestartIntervalMs: 3000,
    });

    const addrInUse = () => Object.assign(new Error("addr in use"), { code: "EADDRINUSE" });

    servers[0].emit("error", addrInUse());
    expect(timers.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 1000);
    timers.flush();

    servers[1].emit("error", addrInUse());
    expect(timers.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 2000);
    timers.flush();

    servers[2].emit("error", addrInUse());
    expect(timers.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 3000); // capped
  });

  it("resets the backoff once the server successfully starts listening", () => {
    const ring = new ErrorRing();
    const servers: Array<http.Server & EventEmitter> = [];
    const start = vi.fn(() => {
      const s = emittingServer();
      servers.push(s);
      return s;
    });
    const timers = makeTimers();
    new HttpSupervisor({
      start,
      errorRing: ring,
      timers,
      minRestartIntervalMs: 1000,
      maxRestartIntervalMs: 60000,
    });

    const addrInUse = () => Object.assign(new Error("addr in use"), { code: "EADDRINUSE" });

    servers[0].emit("error", addrInUse());
    timers.flush();
    servers[1].emit("listening");

    servers[1].emit("error", addrInUse());
    expect(timers.setTimeout).toHaveBeenLastCalledWith(expect.any(Function), 1000);
  });
});
