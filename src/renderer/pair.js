const f = document.getElementById("f");
const btn = document.getElementById("submit");
const msg = document.getElementById("msg");
const codeEl = document.getElementById("code");
const codeStatus = document.getElementById("codeStatus");

function tryDecodeAndFill() {
  const raw = codeEl.value.trim();
  if (!raw) {
    codeStatus.textContent = "";
    codeStatus.style.color = "#666";
    return null;
  }
  try {
    const json = JSON.parse(atob(raw));
    if (
      typeof json.tenantId === "number" &&
      typeof json.orgUnitId === "number" &&
      typeof json.token === "string" &&
      typeof json.tenantOrigin === "string"
    ) {
      f.tenantId.value = json.tenantId;
      f.orgUnitId.value = json.orgUnitId;
      f.token.value = json.token;
      f.tenantOrigin.value = json.tenantOrigin;
      codeStatus.textContent = `Decoded — tenant ${json.tenantId}, org unit ${json.orgUnitId}, origin ${json.tenantOrigin}`;
      codeStatus.style.color = "#1b5e20";
      return json;
    }
    codeStatus.textContent = "Code parsed but is missing required fields";
    codeStatus.style.color = "#b00020";
  } catch (_) {
    codeStatus.textContent = "Not a valid pairing code yet";
    codeStatus.style.color = "#b00020";
  }
  return null;
}

codeEl.addEventListener("input", tryDecodeAndFill);

f.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.className = "";
  msg.textContent = "";
  btn.disabled = true;
  try {
    tryDecodeAndFill();
    const body = {
      tenantId: Number(f.tenantId.value),
      orgUnitId: Number(f.orgUnitId.value),
      token: f.token.value.trim(),
      tenantOrigin: f.tenantOrigin.value.trim(),
    };
    const r = await fetch("http://127.0.0.1:7755/pair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Pairing failed");
    msg.className = "msg ok";
    msg.textContent = "Paired. You can close this window.";
  } catch (err) {
    msg.className = "msg err";
    msg.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});
