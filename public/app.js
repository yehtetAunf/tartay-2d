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

const roundsContainer = document.querySelector("#rounds");

let latestResults = [];


/* =========================
   CREATE ROUND CARDS
========================= */

function createRoundCards() {
  if (!roundsContainer) return;

  roundsContainer.innerHTML = times
    .map(
      time => `
        <article data-round="${time}">
          <b>${time}</b>
          <span>--</span>
        </article>
      `
    )
    .join("");
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
        "Failed to load results"
      );
    }

    const data = await response.json();

    if (!data.success) {
      throw new Error(
        data.error || "Unable to load results"
      );
    }

    latestResults =
      Array.isArray(data.results)
        ? data.results
        : [];

    updateRoundCards(latestResults);

    updateCurrentResult(latestResults);

  } catch (error) {
    console.error(
      "Today results error:",
      error
    );
  }
}


/* =========================
   UPDATE ROUND CARDS
========================= */

function updateRoundCards(results) {
  times.forEach(time => {

    const card =
      document.querySelector(
        `[data-round="${time}"]`
      );

    if (!card) return;

    const result =
      results.find(
        item =>
          item.round_time === time
      );

    const resultSpan =
      card.querySelector("span");

    if (!resultSpan) return;

    resultSpan.textContent =
      result?.result_2d || "--";
  });
}


/* =========================
   UPDATE CURRENT RESULT
========================= */

function updateCurrentResult(results) {
  if (!results.length) {
    setText(
      [
        "#currentResult",
        "#current-result",
        "[data-current-result]"
      ],
      "--"
    );

    setText(
      [
        "#setValue",
        "#set-value",
        "[data-set-value]"
      ],
      "--"
    );

    setText(
      [
        "#valueValue",
        "#value-value",
        "[data-value-value]"
      ],
      "--"
    );

    return;
  }


  /*
    Backend already returns rounds
    in chronological order.

    Last saved result becomes
    Current Result.
  */

  const latest =
    results[results.length - 1];


  setText(
    [
      "#currentResult",
      "#current-result",
      "[data-current-result]"
    ],
    latest.result_2d || "--"
  );


  setText(
    [
      "#setValue",
      "#set-value",
      "[data-set-value]"
    ],
    latest.set_value || "--"
  );


  setText(
    [
      "#valueValue",
      "#value-value",
      "[data-value-value]"
    ],
    latest.value_value || "--"
  );
}


/* =========================
   HELPER
========================= */

function setText(selectors, value) {
  for (const selector of selectors) {

    const element =
      document.querySelector(selector);

    if (element) {
      element.textContent = value;
      return;
    }
  }
}


/* =========================
   SERVER STATUS
========================= */

async function checkStatus() {
  try {
    const response =
      await fetch(
        "/api/status",
        {
          cache: "no-store"
        }
      );

    if (!response.ok) return;

    const data =
      await response.json();

    console.log(
      "Tartay 2D:",
      data.status
    );

  } catch (error) {
    console.error(
      "Status error:",
      error
    );
  }
}


/* =========================
   INITIAL LOAD
========================= */

createRoundCards();

checkStatus();

loadTodayResults();


/* =========================
   AUTO REFRESH
========================= */

/*
  Refresh results every
  10 seconds.

  If Admin saves a new result,
  User App will update
  automatically.
*/

setInterval(
  loadTodayResults,
  10000
);


/* =========================
   REFRESH WHEN APP RETURNS
========================= */

document.addEventListener(
  "visibilitychange",
  () => {

    if (
      document.visibilityState
      === "visible"
    ) {
      loadTodayResults();
    }

  }
);
