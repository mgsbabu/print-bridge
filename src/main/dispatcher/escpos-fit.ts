// Adapts an ESC/POS receipt stream to the BIXOLON SRP-275III (76 mm roll):
//  1. every cut becomes "feed to cutter, then cut" (GS V 66 n). The plain
//     GS V 0/1 the web app sends cuts at the print head, which leaves the last
//     lines (e.g. "Thank you") behind inside the printer.
//  2. plain text lines longer than the printer's columns are word-wrapped, so
//     an 80 mm (48-col) layout doesn't break mid-word on the 76 mm roll.
// Anything the walker doesn't recognise returns the stream untouched.

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

export const COLS_76MM_FONT_A = 40;
export const COLS_76MM_FONT_B = 50;
const FEED_AND_CUT = [GS, 0x56, 0x42, 0x03];

interface State {
  fontB: boolean;
  widthMul: number;
}

// Total length of a fixed-size command starting at buf[i] (buf[i] is ESC/GS), or
// -1 when unknown. Binary-payload commands are handled by the caller.
function fixedLen(buf: Buffer, i: number): number {
  const c = buf[i + 1];
  if (buf[i] === ESC) {
    if ("@2=<".includes(String.fromCharCode(c))) return 2;
    if ("MaE-!dJrt{G3SUVRT!pq".includes(String.fromCharCode(c))) return c === 0x70 ? 5 : 3;
    if (c === 0x24 || c === 0x5c) return 4;
    return -1;
  }
  if (c === 0x21 || c === 0x42 || c === 0x48 || c === 0x66 || c === 0x68 || c === 0x77) return 3;
  if (c === 0x4c || c === 0x57) return 4;
  return -1;
}

const isPlain = (b: number): boolean => b >= 0x20 && b <= 0x7e;

function wrap(text: string, cols: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/( +)/)) {
    if (cur.length + word.length <= cols) {
      cur += word;
      continue;
    }
    if (word.trim() === "") continue;
    if (cur.trim()) lines.push(cur.trimEnd());
    cur = word;
    while (cur.length > cols) {
      lines.push(cur.slice(0, cols));
      cur = cur.slice(cols);
    }
  }
  if (cur.trim()) lines.push(cur.trimEnd());
  return lines;
}

// keepCuts=false (printer cutMode "none") drops every cut so tags print as one strip.
export function fitToBixolon76(payload: Buffer, keepCuts = true): Buffer {
  const out: number[] = [];
  const st: State = { fontB: false, widthMul: 1 };
  let line: number[] = []; // current pending plain text
  const flush = (withLf: boolean): void => {
    if (line.length === 0 && !withLf) return;
    const cols = Math.floor((st.fontB ? COLS_76MM_FONT_B : COLS_76MM_FONT_A) / st.widthMul);
    const text = Buffer.from(line).toString("latin1");
    if (text.length > cols) {
      const parts = wrap(text, cols);
      parts.forEach((p, k) => {
        out.push(...Buffer.from(p, "latin1"));
        if (k < parts.length - 1 || withLf) out.push(LF);
      });
    } else {
      out.push(...line);
      if (withLf) out.push(LF);
    }
    line = [];
  };

  let i = 0;
  while (i < payload.length) {
    const b = payload[i];
    if (b === LF) {
      flush(true);
      i++;
      continue;
    }
    if (isPlain(b)) {
      line.push(b);
      i++;
      continue;
    }
    if (b !== ESC && b !== GS) {
      flush(false);
      out.push(b); // CR, tabs, high-bit chars: pass through (and stop wrapping this line)
      i++;
      continue;
    }
    flush(false);
    const c = payload[i + 1];
    let len = -1;
    if (b === GS && c === 0x56) {
      // GS V m [n] — normalise every cut to feed-to-cutter + cut.
      const m = payload[i + 2];
      const total = m === 65 || m === 66 ? 4 : 3;
      if (keepCuts) out.push(...FEED_AND_CUT);
      i += total;
      continue;
    }
    if (b === ESC && (c === 0x69 || c === 0x6d)) {
      if (keepCuts) out.push(...FEED_AND_CUT); // legacy ESC i / ESC m cut
      i += 2;
      continue;
    }
    if (b === GS && c === 0x76 && payload[i + 2] === 0x30) {
      // GS v 0 m xL xH yL yH data
      const w = payload[i + 4] + payload[i + 5] * 256;
      const h = payload[i + 6] + payload[i + 7] * 256;
      len = 8 + w * h;
    } else if (b === ESC && c === 0x2a) {
      // ESC * m nL nH data
      const m = payload[i + 2];
      const n = payload[i + 3] + payload[i + 4] * 256;
      len = 5 + n * (m >= 32 ? 3 : 1);
    } else if (b === GS && (c === 0x28 || c === 0x38)) {
      // GS ( k / GS ( L / GS 8 L: pL pH + data
      len = c === 0x28 ? 5 + payload[i + 3] + payload[i + 4] * 256 : -1;
    } else if (b === GS && c === 0x6b) {
      // GS k: m>=65 has a length byte; m<=6 is NUL-terminated.
      const m = payload[i + 2];
      if (m >= 65) len = 4 + payload[i + 3];
      else {
        const nul = payload.indexOf(0, i + 3);
        len = nul < 0 ? -1 : nul - i + 1;
      }
    } else {
      len = fixedLen(payload, i);
    }
    if (len < 0 || i + len > payload.length) return payload; // unknown stream: leave as is
    if (b === ESC && c === 0x4d) st.fontB = payload[i + 2] % 2 === 1;
    if (b === ESC && c === 0x21) {
      st.fontB = (payload[i + 2] & 1) === 1;
      st.widthMul = payload[i + 2] & 0x20 ? 2 : 1;
    }
    if (b === GS && c === 0x21) st.widthMul = ((payload[i + 2] >> 4) & 0x0f) + 1;
    if (b === ESC && c === 0x40) {
      st.fontB = false;
      st.widthMul = 1;
    }
    for (let k = 0; k < len; k++) out.push(payload[i + k]);
    i += len;
  }
  flush(false);
  return Buffer.from(out);
}

// True when the stream contains a cut command (GS V / ESC i / ESC m).
export function hasCut(payload: Buffer): boolean {
  for (let i = 0; i < payload.length - 1; i++) {
    if (payload[i] === GS && payload[i + 1] === 0x56) return true;
    if (payload[i] === ESC && (payload[i + 1] === 0x69 || payload[i + 1] === 0x6d)) return true;
  }
  return false;
}

// Loggable shape of a stream: control bytes as hex, printable runs collapsed to
// "<text×n>" so tag content (payload) never reaches the log. Only the first and
// last tokens are kept — enough to see leading/trailing feeds and cuts.
export function describeEscpos(payload: Buffer, head = 24, tail = 12): string {
  const tokens: string[] = [];
  for (let i = 0; i < payload.length; ) {
    let j = i;
    while (j < payload.length && isPlain(payload[j])) j++;
    if (j - i >= 3) {
      tokens.push(`<text×${j - i}>`);
      i = j;
    } else {
      tokens.push(payload[i].toString(16).padStart(2, "0"));
      i++;
    }
  }
  if (tokens.length <= head + tail) return tokens.join(" ");
  return `${tokens.slice(0, head).join(" ")} … ${tokens.slice(-tail).join(" ")}`;
}
