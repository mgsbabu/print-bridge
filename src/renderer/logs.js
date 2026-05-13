const rowsEl = document.getElementById("rows");
const metaEl = document.getElementById("meta");

function fmtTime(ms) {
  try { return new Date(ms).toLocaleTimeString(); } catch { return String(ms); }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function render(jobs) {
  if (!jobs || jobs.length === 0) {
    rowsEl.innerHTML = '<tr><td colspan="6" class="empty">No jobs yet.</td></tr>';
    metaEl.textContent = "0 jobs · refreshes every 5s";
    return;
  }
  rowsEl.innerHTML = jobs
    .map((j) => {
      const copies = j.copiesAcknowledged === j.copiesRequested
        ? j.copiesRequested
        : `${j.copiesAcknowledged} / ${j.copiesRequested}`;
      return `<tr>
        <td class="mono">${fmtTime(j.ts)}</td>
        <td>${escapeHtml(j.printer)}</td>
        <td>${escapeHtml(j.language)}</td>
        <td>${copies}</td>
        <td class="status-${escapeHtml(j.status)}">${escapeHtml(j.status)}</td>
        <td class="err" title="${escapeHtml(j.error ?? "")}">${escapeHtml(j.error ?? "")}</td>
      </tr>`;
    })
    .join("");
  metaEl.textContent = `${jobs.length} job${jobs.length === 1 ? "" : "s"} · refreshes every 5s`;
}

async function refresh() {
  try {
    const jobs = await window.bridge.listRecentJobs(100);
    render(jobs);
  } catch (e) {
    metaEl.textContent = `error: ${e?.message ?? e}`;
  }
}

refresh();
setInterval(refresh, 5000);
