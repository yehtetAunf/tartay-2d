const TIMES = [
  "05:00 PM","06:00 PM","07:00 PM","08:00 PM",
  "09:00 PM","10:00 PM","11:00 PM","12:00 AM"
];

const $ = (id) => document.getElementById(id);

function drawRounds(rounds = []) {
  const grid = $("roundGrid");
  grid.innerHTML = "";

  TIMES.forEach((time, i) => {
    const r = rounds[i] || {};
    const card = document.createElement("div");
    card.className = "round-card";

    const left = document.createElement("div");
    left.className = "round-time";
    left.innerHTML = `<span class="clock">◷</span><span>${time}</span>`;

    const right = document.createElement("div");
    right.className = "round-result";
    right.textContent = r.result && r.result !== "" ? r.result : "--";

    card.append(left, right);
    grid.appendChild(card);
  });
}

function setStatus(live) {
  const badge = $("statusBadge");
  $("statusText").textContent = live ? "LIVE" : "OFFLINE";
  badge.classList.toggle("offline", !live);
}

function setLatest(data) {
  const latest = data && data.latest ? data.latest : null;

  if (!latest) {
    $("bigResult").textContent = "--";
    $("liveSet").textContent = "--";
    $("liveValue").textContent = "--";
    $("updatedText").textContent = "Waiting for result";
    return;
  }

  $("bigResult").textContent = latest.result || "--";
  $("liveSet").textContent = latest.set || "--";
  $("liveValue").textContent = latest.value || "--";

  if (latest.publishedAt) {
    const t = new Date(latest.publishedAt).toLocaleTimeString("en-US", {
      timeZone: "Asia/Yangon",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true
    });
    $("updatedText").textContent = `Updated ${t}`;
  } else {
    $("updatedText").textContent = "Waiting for result";
  }
}

async function load() {
  try {
    const res = await fetch(`/api/state?t=${Date.now()}`, {
      cache: "no-store",
      headers: { "cache-control": "no-cache" }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    setStatus(data.live !== false);
    setLatest(data);
    drawRounds(Array.isArray(data.rounds) ? data.rounds : []);
  } catch (err) {
    console.error(err);
    setStatus(false);
    setLatest(null);
    drawRounds([]);
  }
}

drawRounds([]);
load();
setInterval(load, 10000);
