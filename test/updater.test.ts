import { describe, it, expect, vi, beforeEach } from "vitest";

const { autoUpdaterMock, handlers } = vi.hoisted(() => {
  const h = new Map<string, (arg?: unknown) => void>();
  return {
    handlers: h,
    autoUpdaterMock: {
      logger: null as unknown,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on: vi.fn((event: string, fn: (arg?: unknown) => void) => {
        h.set(event, fn);
      }),
      checkForUpdatesAndNotify: vi.fn(async () => undefined),
      checkForUpdates: vi.fn(async () => undefined),
      quitAndInstall: vi.fn(),
    },
  };
});

vi.mock("electron-updater", () => ({ autoUpdater: autoUpdaterMock }));

import {
  startAutoUpdate,
  STARTUP_CHECK_MS,
  PERIODIC_CHECK_MS,
  IDLE_POLL_MS,
} from "../src/main/updater";

interface FakeTimers {
  setTimeout: ReturnType<typeof vi.fn>;
  setInterval: ReturnType<typeof vi.fn>;
  scheduled: Array<{ kind: "timeout" | "interval"; fn: () => void; ms: number }>;
}

function makeTimers(): FakeTimers {
  const scheduled: FakeTimers["scheduled"] = [];
  return {
    scheduled,
    setTimeout: vi.fn((fn: () => void, ms: number) => {
      scheduled.push({ kind: "timeout", fn, ms });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }),
    setInterval: vi.fn((fn: () => void, ms: number) => {
      scheduled.push({ kind: "interval", fn, ms });
      return 0 as unknown as ReturnType<typeof setInterval>;
    }),
  };
}

beforeEach(() => {
  handlers.clear();
  autoUpdaterMock.on.mockClear();
  autoUpdaterMock.checkForUpdatesAndNotify.mockClear();
  autoUpdaterMock.checkForUpdates.mockClear();
  autoUpdaterMock.quitAndInstall.mockClear();
});

describe("startAutoUpdate", () => {
  it("schedules a 30s startup check and a 6h periodic check", () => {
    const timers = makeTimers();
    startAutoUpdate({ isIdle: () => true, timers: timers as unknown as { setTimeout: typeof setTimeout; setInterval: typeof setInterval } });

    const startup = timers.scheduled.find((s) => s.kind === "timeout");
    const periodic = timers.scheduled.find((s) => s.kind === "interval" && s.ms === PERIODIC_CHECK_MS);
    expect(startup?.ms).toBe(STARTUP_CHECK_MS);
    expect(periodic).toBeDefined();
  });

  it("startup timer fires checkForUpdatesAndNotify", async () => {
    const timers = makeTimers();
    startAutoUpdate({ isIdle: () => true, timers: timers as unknown as { setTimeout: typeof setTimeout; setInterval: typeof setInterval } });
    const startup = timers.scheduled.find((s) => s.kind === "timeout");
    startup?.fn();
    expect(autoUpdaterMock.checkForUpdatesAndNotify).toHaveBeenCalledOnce();
  });

  it("does not quitAndInstall before update-downloaded fires", () => {
    const timers = makeTimers();
    startAutoUpdate({ isIdle: () => true, timers: timers as unknown as { setTimeout: typeof setTimeout; setInterval: typeof setInterval } });
    const idlePoll = timers.scheduled.find((s) => s.kind === "interval" && s.ms === IDLE_POLL_MS);
    idlePoll?.fn();
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
  });

  it("does not quitAndInstall while isIdle returns false, even after update-downloaded", () => {
    const timers = makeTimers();
    startAutoUpdate({ isIdle: () => false, timers: timers as unknown as { setTimeout: typeof setTimeout; setInterval: typeof setInterval } });
    handlers.get("update-downloaded")?.({ version: "1.2.3" });
    const idlePoll = timers.scheduled.find((s) => s.kind === "interval" && s.ms === IDLE_POLL_MS);
    idlePoll?.fn();
    idlePoll?.fn();
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();
  });

  it("quitAndInstall fires once after update-downloaded AND isIdle returns true", () => {
    let idle = false;
    const timers = makeTimers();
    startAutoUpdate({ isIdle: () => idle, timers: timers as unknown as { setTimeout: typeof setTimeout; setInterval: typeof setInterval } });
    handlers.get("update-downloaded")?.({ version: "1.2.3" });
    const idlePoll = timers.scheduled.find((s) => s.kind === "interval" && s.ms === IDLE_POLL_MS);

    idlePoll?.fn();
    expect(autoUpdaterMock.quitAndInstall).not.toHaveBeenCalled();

    idle = true;
    idlePoll?.fn();
    expect(autoUpdaterMock.quitAndInstall).toHaveBeenCalledOnce();
  });

  it("does not crash on autoUpdater errors (errors are logged, not thrown)", () => {
    const timers = makeTimers();
    autoUpdaterMock.checkForUpdates.mockRejectedValueOnce(new Error("net"));
    startAutoUpdate({ isIdle: () => true, timers: timers as unknown as { setTimeout: typeof setTimeout; setInterval: typeof setInterval } });
    const periodic = timers.scheduled.find((s) => s.kind === "interval" && s.ms === PERIODIC_CHECK_MS);
    expect(() => periodic?.fn()).not.toThrow();
  });
});
