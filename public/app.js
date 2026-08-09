const ROUNDS = [
  "05:00 PM",
  "06:00 PM",
  "07:00 PM",
  "08:00 PM",
  "09:00 PM",
  "10:00 PM",
  "11:00 PM",
  "12:00 AM"
];


/* ========================================
   FORMAT UPDATED TIME
   Database UTC -> Myanmar Time
======================================== */

function formatUpdatedTime(value) {

  if (!value) {
    return "Waiting for result";
  }

  /*
    Cloudflare D1 CURRENT_TIMESTAMP usually returns:
    2026-08-09 15:08:13

    Add Z so JavaScript treats it as UTC.
  */

  let normalized = String(value).trim();

  if (
    /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/
      .test(normalized)
  ) {
    normalized =
      normalized.replace(" ", "T") + "Z";
  }

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return value;
  }


  const parts =
    new Intl.DateTimeFormat(
      "en-GB",
      {
        timeZone: "Asia/Yangon",

        day: "2-digit",
        month: "2-digit",
        year: "numeric",

        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",

        hour12: true
      }
    ).formatToParts(date);


  const get =
    type =>
      parts.find(
        item => item.type === type
      )?.value || "";


  const day =
    get("day");

  const month =
    get("month");

  const year =
    get("year");

  const hour =
    get("hour");

  const minute =
    get("minute");

  const second =
    get("second");

  const period =
    get("dayPeriod")
      .toUpperCase();


  return (
    `${day}/${month}/${year}, ` +
    `${hour}:${minute}:${second} ${period}`
  );
}


/* ========================================
   SAFE TEXT
======================================== */

function safeText(value) {

  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return "--";
  }

  return String(value);
}


/* ========================================
   CREATE ROUND CARDS
======================================== */

function renderRounds(results) {

  const container =
    document.getElementById("rounds");

  if (!container) {
    return;
  }


  container.innerHTML = "";


  ROUNDS.forEach(roundTime => {

    const item =
      results.find(
        result =>
          result.round_time === roundTime
      );


    const card =
      document.createElement("div");

    card.className =
      "round-card";


    const time =
      document.createElement("span");

    time.className =
      "round-time";

    time.textContent =
      roundTime;


    const number =
      document.createElement("strong");

    number.className =
      item
        ? "round-number"
        : "round-number waiting";


    number.textContent =
      item
        ? safeText(item.result_2d)
        : "--";


    card.appendChild(time);
    card.appendChild(number);

    container.appendChild(card);

  });
}


/* ========================================
   UPDATE HOME SCREEN
======================================== */

function updateHome(results) {

  const twoD =
    document.getElementById("twoD");

  const round =
    document.getElementById("round");

  const set =
    document.getElementById("set");

  const value =
    document.getElementById("value");


  /*
    API results are ordered
    05 PM -> 12 AM.

    Last public result = current result.
  */

  const latest =
    results.length
      ? results[results.length - 1]
      : null;


  if (!latest) {

    if (twoD) {
      twoD.textContent = "--";
    }

    if (round) {
      round.textContent =
        "Updated = Waiting for result";
    }

    if (set) {
      set.textContent = "--";
    }

    if (value) {
      value.textContent = "--";
    }

    return;
  }


  /*
    CURRENT 2D
  */

  if (twoD) {
    twoD.textContent =
      safeText(latest.result_2d);
  }


  /*
    UPDATED EXACT DATE + TIME

    Example:
    Updated = 09/08/2026, 09:38:13 PM
  */

  if (round) {

    round.textContent =
      "Updated = " +
      formatUpdatedTime(
        latest.updated_at
      );

  }


  /*
    SET / VALUE
  */

  if (set) {
    set.textContent =
      safeText(latest.set_value);
  }


  if (value) {
    value.textContent =
      safeText(latest.value_value);
  }
}


/* ========================================
   LOAD TODAY RESULTS
======================================== */

async function loadToday() {

  try {

    const response =
      await fetch(
        "/api/results/today",
        {
          cache: "no-store"
        }
      );


    const data =
      await response.json();


    if (
      !response.ok ||
      !data.success
    ) {

      throw new Error(
        data.error ||
        "Unable to load results"
      );

    }


    const results =
      Array.isArray(data.results)
        ? data.results
        : [];


    updateHome(results);

    renderRounds(results);


  } catch (error) {

    console.error(
      "Tartay load error:",
      error
    );


    const round =
      document.getElementById("round");


    if (round) {

      round.textContent =
        "Updated = Connection error";

    }


    renderRounds([]);

  }
}


/* ========================================
   FIRST LOAD
======================================== */

loadToday();


/* ========================================
   AUTO REFRESH

   Refresh every 10 seconds so newly
   released scheduled rounds appear
   automatically.
======================================== */

setInterval(
  loadToday,
  10000
);
