const RESULT_TIMES = [
  "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM",
  "9:00 PM", "10:00 PM", "11:00 PM", "12:00 AM"
];

async function loadPublicResults() {
  const list = document.getElementById("publicResultList");
  list.innerHTML = '<div class="empty-row">Loading...</div>';

  try {
    const response = await fetch("/api/results", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error();

    const byTime = new Map(
      (data.results || []).map((item) => [item.result_time, item])
    );

    const ordered = RESULT_TIMES.map((time) => byTime.get(time) || {
      result_time: time,
      result_number: "--",
      created_at: null
    });

    list.innerHTML = ordered.map((item) => `
      <div class="public-result-row">
        <div class="public-time">${escapeHtml(item.result_time)}</div>
        <div class="public-status ${item.result_number === "--" ? "waiting" : "published"}">
          ${item.result_number === "--" ? "Waiting" : "Published"}
        </div>
        <div class="public-number">${escapeHtml(item.result_number || "--")}</div>
      </div>
    `).join("");

    const published = ordered.filter((item) => /^\d{2}$/.test(item.result_number || ""));
    const latest = published[published.length - 1];

    document.getElementById("latestNumber").textContent = latest?.result_number || "--";
    document.getElementById("latestTime").textContent = latest
      ? `${latest.result_time} Result`
      : "Waiting for result";
    document.getElementById("updatedAt").textContent = latest?.created_at
      ? `Updated: ${latest.created_at}`
      : "Updated: --";
  } catch {
    list.innerHTML = '<div class="empty-row">Results could not be loaded.</div>';
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadPublicResults();
setInterval(loadPublicResults, 30000);
