const list = document.getElementById("list");

function row(p) {
  const el = document.createElement("div");
  el.className = "printer";
  const title = document.createElement("h2");
  title.textContent = `${p.name} (${p.language})`;
  el.appendChild(title);

  const controls = document.createElement("div");
  controls.className = "controls";
  controls.innerHTML = `
    <label><input type="checkbox" class="rotate" /> Rotate 180°</label>
    <label>Cut <select class="cut">
      <option value="partial">After each tag</option>
      <option value="none">None (continuous)</option>
    </select></label>
    <label>Density <input type="number" class="density" min="0" max="15" /></label>
    <span class="saved"></span>`;
  el.appendChild(controls);

  const rotate = controls.querySelector(".rotate");
  const cut = controls.querySelector(".cut");
  const density = controls.querySelector(".density");
  const status = controls.querySelector(".saved");
  rotate.checked = p.rotate180 === true;
  cut.value = p.cutMode ?? "partial";
  density.value = p.density ?? "";

  async function save() {
    const settings = { rotate180: rotate.checked, cutMode: cut.value };
    if (density.value !== "") settings.density = Number(density.value);
    const r = await window.bridge.setPrinterSettings(p.name, settings);
    status.className = r.error ? "saved err" : "saved";
    status.textContent = r.error ?? "Saved";
  }
  rotate.addEventListener("change", save);
  cut.addEventListener("change", save);
  density.addEventListener("change", save);
  return el;
}

window.bridge.listPrinterSettings().then((printers) => {
  if (printers.length === 0) list.textContent = "No printers loaded. Use Reload Printers first.";
  for (const p of printers) list.appendChild(row(p));
});
