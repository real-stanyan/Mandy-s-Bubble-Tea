// printer-client/src/ui/public/app.js
async function refresh() {
  const [statusRes, jobsRes] = await Promise.all([
    fetch("/api/status").then((r) => r.json()),
    fetch("/api/jobs?limit=20").then((r) => r.json()),
  ]);
  const statusEl = document.getElementById("status");
  const dotClass = statusRes.printerStatus === "idle" || statusRes.printerStatus === "printing" ? "green"
    : statusRes.printerStatus === "offline" ? "red" : "yellow";
  statusEl.innerHTML = `
    <span class="dot ${dotClass}"></span>
    Printer: <strong>${statusRes.printerStatus}</strong>
    &nbsp;|&nbsp; Pending: <strong>${statusRes.pendingCount}</strong>
    &nbsp;|&nbsp; Device: <code>${statusRes.deviceId}</code>
  `;
  const tbody = document.getElementById("jobs");
  tbody.innerHTML = "";
  for (const job of jobsRes.jobs) {
    const tr = document.createElement("tr");
    const when = new Date(job.created_at).toLocaleTimeString("en-AU", {
      timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    });
    const cupCount = (job.cups || []).length;
    const previews = [];
    for (let i = 1; i <= cupCount; i++) {
      const cup = job.cups[i - 1] || {};
      const alt = `${cup.drinkName || "Drink"} ${i}/${cupCount}`;
      previews.push(
        `<img class="preview" loading="lazy" title="${alt}" alt="${alt}" src="/api/jobs/${job.id}/preview.png?cup=${i}">`
      );
    }
    tr.innerHTML = `
      <td><strong>${job.sticker_number}</strong></td>
      <td>${job.source}</td>
      <td class="status-${job.status}">${job.status}${job.attempts > 0 ? " ("+job.attempts+"x)" : ""}</td>
      <td>${when}</td>
      <td class="previews">${previews.join("")}</td>
      <td><button data-id="${job.id}" class="reprint">Reprint</button></td>
    `;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("button.reprint").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Reprint this job?")) return;
      const id = btn.dataset.id;
      const r = await fetch(`/api/jobs/${id}/reprint`, { method: "POST" });
      if (r.ok) refresh();
      else alert("Reprint failed: " + (await r.text()));
    });
  });
}
document.getElementById("testBtn").addEventListener("click", async () => {
  const r = await fetch("/api/test-print", { method: "POST" });
  alert(r.ok ? "Test sent!" : "Test failed: " + (await r.text()));
});
document.getElementById("refreshBtn").addEventListener("click", refresh);
refresh();
setInterval(refresh, 5000);
