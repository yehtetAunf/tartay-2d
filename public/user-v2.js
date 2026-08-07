const TIMES = [
  "05:00 PM",
  "06:00 PM",
  "07:00 PM",
  "08:00 PM",
  "09:00 PM",
  "10:00 PM",
  "11:00 PM",
  "12:00 AM"
];

const bigResult = document.getElementById("bigResult");
const liveSet = document.getElementById("liveSet");
const liveValue = document.getElementById("liveValue");
const updatedText = document.getElementById("updatedText");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const roundGrid = document.getElementById("roundGrid");
const refreshBtn = document.getElementById("refreshBtn");

function makeRoundCards(rounds = []) {
  roundGrid.innerHTML = "";

  TIMES.forEach((time, index) => {
    const round = rounds[index] || {};

    const card = document.createElement("div");
    card.className = "round-card";

    const timeBox = document.createElement("div");
    timeBox.className = "round-time";
    timeBox.innerHTML = `<span>◷</span>&nbsp; ${time}`;

    const resultBox = document.createElement("div");
    resultBox.className = "round-result";
    resultBox.textContent =
      round.result && round.result !== ""
        ? round.result
        : "--";

    card.appendChild(timeBox);
    card.appendChild(resultBox);

    roundGrid.appendChild(card);
  });
}

function setStatus(live) {
  if (live) {
    statusText.textContent = "LIVE";
    statusBadge.classList.add("live");
    statusBadge.classList.remove("offline");
  } else {
    statusText.textContent = "OFFLINE";
    statusBadge.classList.remove("live");
    statusBadge.classList.add("offline");
  }
}

function setLatest(data) {
  const latest = data.latest;

  if (!latest) {
    bigResult.textContent = "--";
    liveSet.textContent = "--";
    liveValue.textContent = "--";
    updatedText.textContent = "Waiting for result";
    return;
  }

  bigResult.textContent = latest.result || "--";
  liveSet.textContent = latest.set || "--";
  liveValue.textContent = latest.value || "--";

  if (latest.publishedAt) {
    const d = new Date(latest.publishedAt);

    updatedText.textContent =
      "Updated " +
      d.toLocaleTimeString("en-US", {
        timeZone: "Asia/Yangon",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true
      });
  } else {
    updatedText.textContent = "Waiting for result";
  }
}

async function loadResults() {
  try {
    const res = await fetch("/api/state", {
      cache: "no-store"
    });

    if (!res.ok) {
      throw new Error("API error");
    }

    const data = await res.json();

    setStatus(data.live !== false);
    setLatest(data);
    makeRoundCards(data.rounds || []);
  } catch (error) {
    console.error(error);

    setStatus(false);

    bigResult.textContent = "--";
    liveSet.textContent = "--";
    liveValue.textContent = "--";
    updatedText.textContent = "Waiting for result";

    makeRoundCards([]);
  }
}

if (refreshBtn) {
  refreshBtn.addEventListener("click", loadResults);
}

makeRoundCards([]);
loadResults();

setInterval(loadResults, 10000);
