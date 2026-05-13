import net from "node:net";
import { spawn } from "node:child_process";
import { findPrinter } from "./printers";
import { ErrorCode } from "../../shared/error-codes";
import type { PrintRequest, NetworkPrinter } from "../../shared/protocol";
import type { PrintResult } from "./pdf";

export type NetworkSendFn = (
  host: string,
  port: number,
  payload: Buffer,
  timeoutMs?: number,
) => Promise<void>;

export type LocalRawSendFn = (printerName: string, payload: Buffer) => Promise<void>;

export interface RawBytesDeps {
  sendNetwork?: NetworkSendFn;
  sendLocalRaw?: LocalRawSendFn;
  lookup?: typeof findPrinter;
}

export async function dispatchRawBytes(
  req: PrintRequest,
  deps: RawBytesDeps = {},
): Promise<PrintResult> {
  const sendNetwork = deps.sendNetwork ?? defaultSendNetwork;
  const sendLocalRaw = deps.sendLocalRaw ?? defaultSendLocalRaw;
  const lookup = deps.lookup ?? findPrinter;

  const target = lookup(req.printerName);
  if (!target) {
    return {
      dispatched: false,
      copiesAcknowledged: 0,
      error: `Printer ${req.printerName} not registered`,
      errorCode: ErrorCode.PRINTER_NOT_FOUND,
    };
  }

  const payload = Buffer.from(req.payloadBase64, "base64");
  try {
    for (let i = 0; i < req.copies; i++) {
      if (target.kind === "network") {
        const np: NetworkPrinter = target.record;
        await sendNetwork(np.ip, np.port, payload);
      } else {
        await sendLocalRaw(target.record.name, payload);
      }
    }
    return { dispatched: true, copiesAcknowledged: req.copies };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      dispatched: false,
      copiesAcknowledged: 0,
      error: message,
      errorCode: classifyTransportError(message),
    };
  }
}

export function classifyTransportError(message: string): ErrorCode {
  const m = message.toLowerCase();
  if (m.includes("econnrefused") || m.includes("etimedout") || m.includes("ehostunreach")) {
    return ErrorCode.PRINTER_OFFLINE;
  }
  if (m.includes("enotfound") || m.includes("not found") || m.includes("no such printer")) {
    return ErrorCode.PRINTER_NOT_FOUND;
  }
  return ErrorCode.INTERNAL;
}

export const defaultSendNetwork: NetworkSendFn = (host, port, payload, timeoutMs = 5000) =>
  new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const done = (err?: Error): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      err ? reject(err) : resolve();
    };
    socket.setTimeout(timeoutMs, () => done(new Error("ETIMEDOUT")));
    socket.once("error", done);
    socket.once("connect", () => {
      socket.write(payload, (err) => {
        if (err) return done(err);
        socket.end(() => done());
      });
    });
  });

export const defaultSendLocalRaw: LocalRawSendFn = (printerName, payload) => {
  if (process.platform === "win32") {
    return sendLocalRawWindows(printerName, payload);
  }
  return sendLocalRawUnix(printerName, payload);
};

function sendLocalRawUnix(printerName: string, payload: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("lp", ["-d", printerName, "-o", "raw"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.once("error", reject);
    proc.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `lp exited with ${code}`));
    });
    proc.stdin.end(payload);
  });
}

async function sendLocalRawWindows(printerName: string, payload: Buffer): Promise<void> {
  const printer = await import("@grandchef/node-printer");
  printer.printDirect({ data: payload, printer: printerName, type: "RAW" });
}
