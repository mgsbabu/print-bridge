const f = document.getElementById("f");
const btn = document.getElementById("submit");
const msg = document.getElementById("msg");

function numOrNull(v) {
  const n = Number(v);
  return v === "" || Number.isNaN(n) ? null : n;
}

function strOrNull(v) {
  const s = v.trim();
  return s === "" ? null : s;
}

f.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.className = "";
  msg.textContent = "";
  btn.disabled = true;
  try {
    const body = {
      name: f.name.value.trim(),
      ip: f.ip.value.trim(),
      port: Number(f.port.value),
      language: f.language.value,
      mediaWidthMm: numOrNull(f.mediaWidthMm.value),
      mediaHeightMm: numOrNull(f.mediaHeightMm.value),
      mediaKind: strOrNull(f.mediaKind.value),
    };
    const r = await window.bridge.addNetworkPrinter(body);
    if (r.error) throw new Error(r.error);
    msg.className = "msg ok";
    msg.textContent = "Printer added. You can close this window.";
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
