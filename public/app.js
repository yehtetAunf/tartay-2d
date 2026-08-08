const times = [
  "05:00 PM",
  "06:00 PM",
  "07:00 PM",
  "08:00 PM",
  "09:00 PM",
  "10:00 PM",
  "11:00 PM",
  "12:00 AM"
];

const roundsEl = document.getElementById("rounds");
const setEl = document.getElementById("set");
const valueEl = document.getElementById("value");
const twoDEl = document.getElementById("twoD");
const roundEl = document.getElementById("round");
const onlineEl = document.querySelector(".online");

let loadingResults = false;
let refreshTimer = null;


/* ========================================
   CREATE ROUND CARDS
======================================== */

function createRoundCards() {
  if (!roundsEl) return;

  roundsEl.innerHTML = times.map(time => `
    <article data-round="${time}">
      <b>${time}</b>
      <span>--</span>
    </article>
  `).join("");
}


/* ========================================
   CONNECTION STATUS
======================================== */

function setOnlineStatus(isOnline) {
  if (!onlineEl) return;

  if (isOnline) {
    onlineEl.textContent = "● ONLINE";
    onlineEl.style.opacity = "1";
  } else {
    onlineEl.textContent = "● OFFLINE";
    onlineEl.style.opacity = "0.65";
  }
}


/* ========================================
   UPDATE ROUND CARDS
======================================== */

function updateRoundCards(results) {
  times.forEach(time => {
    const card = document.querySelector(
      `[data-round="${time}"]`
    );

    if (!card) return;

    const result = results.find(
      item => item.round_time === time
    );

    const resultEl = card.querySelector("span");

    if (!resultEl) return;

    resultEl.textContent =
      result && result.result_2d
        ? result.result_2d
        : "--";
  });
}


/* ========================================
   CURRENT RESULT
======================================== */

function updateCurrentResult(results) {
  if (!Array.isArray(results) || results.length === 0) {
    if (setEl) setEl.textContent = "--";
    if (valueEl) valueEl.textContent = "--";
    if (twoDEl) twoDEl.textContent = "--";

    if (roundEl) {
      roundEl.textContent = "Waiting for result";
    }

    return;
  }

  /*
    Results come from backend in round order.
    The latest completed round becomes
    CURRENT RESULT.
  */

  const latest = results[results.length - 1];

  if (twoDEl) {
    twoDEl.textContent =
      latest.result_2d || "--";
  }

  if (roundEl) {
    roundEl.textContent =
      latest.round_time || "Waiting for result";
  }

  if (setEl) {
    setEl.textContent =
      latest.set_value || "--";
  }

  if (valueEl) {
    valueEl.textContent =
      latest.value_value || "--";
  }
}


/* ========================================
   LOAD TODAY RESULTS
======================================== */

async function loadTodayResults() {
  /*
    Prevent two refresh requests
    from running at the same time.
  */

  if (loadingResults) return;

  loadingResults = true;

  try {
    const response = await fetch(
      `/api/results/today?t=${Date.now()}`,
      {
        method: "GET",
        cache: "no-store",
        headers: {
          "Accept": "application/json"
        }
      }
    );

    if (!response.ok) {
      throw new Error(
        `Result API HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(
        data.error || "Unable to load results"
      );
    }

    const results =
      Array.isArray(data.results)
        ? data.results
        : [];

    updateRoundCards(results);
    updateCurrentResult(results);

    setOnlineStatus(true);

    console.log(
      "Tartay 2D results updated:",
      data.date,
      results
    );

  } catch (error) {
    console.error(
      "Result loading error:",
      error
    );

    setOnlineStatus(false);

  } finally {
    loadingResults = false;
  }
}


/* ========================================
   SERVER STATUS
======================================== */

async function checkStatus() {
  try {
    const response = await fetch(
      `/api/status?t=${Date.now()}`,
      {
        cache: "no-store"
      }
    );

    if (!response.ok) {
      throw new Error(
        `Status HTTP ${response.status}`
      );
    }

    const data = await response.json();

    if (data.status === "Online") {
      setOnlineStatus(true);
    }

  } catch (error) {
    console.error(
      "Server status error:",
      error
    );

    setOnlineStatus(false);
  }
}


/* ========================================
   AUTO REFRESH
======================================== */

function startAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  /*
    Check D1 results every 5 seconds.

    Admin saves new result
        ↓
    D1
        ↓
    User App automatically updates
  */

  refreshTimer = setInterval(() => {
    if (
      document.visibilityState === "visible"
    ) {
      loadTodayResults();
    }
  }, 5000);
}


/* ========================================
   INTERNET EVENTS
======================================== */

window.addEventListener("online", () => {
  setOnlineStatus(true);

  checkStatus();
  loadTodayResults();
});


window.addEventListener("offline", () => {
  setOnlineStatus(false);
});


/* ========================================
   APP RETURNS TO FOREGROUND
======================================== */

document.addEventListener(
  "visibilitychange",
  () => {
    if (
      document.visibilityState === "visible"
    ) {
      checkStatus();
      loadTodayResults();
    }
  }
);


/* ========================================
   PAGE FOCUS
======================================== */

window.addEventListener("focus", () => {
  loadTodayResults();
});


/* ========================================
   START TARTAY 2D
======================================== */

function startApp() {
  createRoundCards();

  setOnlineStatus(
    navigator.onLine
  );

  checkStatus();

  loadTodayResults();

  startAutoRefresh();
}


startApp();
