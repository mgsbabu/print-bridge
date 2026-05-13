const f = document.getElementById("f");
const btn = document.getElementById("submit");
const msg = document.getElementById("msg");

f.addEventListener("submit", async (e) => {
  e.preventDefault();
  msg.className = "";
  msg.textContent = "";
  btn.disabled = true;
  try {
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
