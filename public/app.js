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


/* =========================
   CREATE ROUND CARDS
========================= */

function createRoundCards() {
  roundsEl.innerHTML = times.map(time => `
    <article data-round="${time}">
      <b>${time}</b>
      <span>--</span>
    </article>
  `).join("");
}


/* =========================
   UPDATE ROUND CARDS
========================= */

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

    resultEl.textContent =
      result?.result_2d || "--";
  });
}


/* =========================
   UPDATE CURRENT RESULT
========================= */

function updateCurrentResult(results) {

  if (!results || results.length === 0) {

    setEl.textContent = "--";
    valueEl.textContent = "--";
    twoDEl.textContent = "--";
    roundEl.textContent = "Waiting for result";

    return;
  }


  /*
    Backend sends today's results
    ordered by round time.

    Last saved round = current result.
  */

  const latest = results[results.length - 1];


  twoDEl.textContent =
    latest.result_2d || "--";


  roundEl.textContent =
    latest.round_time || "Waiting for result";


  setEl.textContent =
    latest.set_value || "--";


  valueEl.textContent =
    latest.value_value || "--";
}


/* =========================
   LOAD TODAY RESULTS
========================= */

async function loadTodayResults() {

  try {

    const response = await fetch(
      "/api/results/today",
      {
        method: "GET",
        cache: "no-store"
      }
    );


    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status}`
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


    console.log(
      "Tartay 2D results loaded:",
      results
    );


  } catch (error) {

    console.error(
      "Result loading error:",
      error
    );

  }
}


/* =========================
   CHECK SERVER STATUS
========================= */

async function checkStatus() {

  try {

    const response = await fetch(
      "/api/status",
      {
        cache: "no-store"
      }
    );

    const data = await response.json();

    console.log(
      "Tartay 2D status:",
      data
    );

  } catch (error) {

    console.error(
      "Status check failed:",
      error
    );

  }
}


/* =========================
   START APP
========================= */

createRoundCards();

checkStatus();

loadTodayResults();


/* =========================
   AUTO REFRESH
========================= */

setInterval(() => {

  loadTodayResults();

}, 10000);


/* =========================
   REFRESH WHEN USER
   RETURNS TO APP
========================= */

document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState === "visible"
    ) {

      loadTodayResults();

    }

  }
);
