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


const roundsEl =
  document.getElementById("rounds");

const twoDEl =
  document.getElementById("twoD");

const roundEl =
  document.getElementById("round");

const setEl =
  document.getElementById("set");

const valueEl =
  document.getElementById("value");

const onlineEl =
  document.querySelector(".online");


let loadingResults = false;
let refreshTimer = null;


/* =========================
   ESCAPE
========================= */

function escapeHtml(value){

  return String(value ?? "")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");
}


/* =========================
   CREATE 8 ROUND CARDS
========================= */

function createRoundCards(){

  if(!roundsEl){
    return;
  }


  roundsEl.innerHTML =
    times.map(time => `

      <article
        class="round-card"
        data-round="${time}"
      >

        <div class="round-head">

          <span>Time</span>

          <span>Set</span>

          <span>Value</span>

          <span>2D</span>

        </div>


        <div class="round-body">

          <span class="round-time">
            ${time}
          </span>

          <span class="round-set">
            --
          </span>

          <span class="round-value">
            --
          </span>

          <span class="round-result">
            --
          </span>

        </div>

      </article>

    `).join("");
}


/* =========================
   ONLINE STATUS
========================= */

function setOnlineStatus(isOnline){

  if(!onlineEl){
    return;
  }


  if(isOnline){

    onlineEl.textContent =
      "● LIVE";

    onlineEl.style.opacity =
      "1";

  }else{

    onlineEl.textContent =
      "● OFFLINE";

    onlineEl.style.opacity =
      ".65";
  }
}


/* =========================
   UPDATE ROUND CARDS
========================= */

function updateRoundCards(results){

  times.forEach(time => {

    const card =
      document.querySelector(
        `[data-round="${time}"]`
      );


    if(!card){
      return;
    }


    const result =
      results.find(
        item =>
          item.round_time === time
      );


    const set =
      card.querySelector(
        ".round-set"
      );

    const value =
      card.querySelector(
        ".round-value"
      );

    const twoD =
      card.querySelector(
        ".round-result"
      );


    if(!result){

      set.textContent = "--";
      value.textContent = "--";
      twoD.textContent = "--";

      return;
    }


    set.textContent =
      result.set_value || "--";


    value.textContent =
      result.value_value || "--";


    twoD.textContent =
      result.result_2d || "--";

  });
}


/* =========================
   CURRENT RESULT
========================= */

function updateCurrentResult(results){

  if(
    !Array.isArray(results) ||
    results.length === 0
  ){

    if(twoDEl){
      twoDEl.textContent = "--";
    }

    if(roundEl){
      roundEl.textContent =
        "Waiting for result";
    }

    if(setEl){
      setEl.textContent = "--";
    }

    if(valueEl){
      valueEl.textContent = "--";
    }

    return;
  }


  /*
    Backend already sends
    released/public results.

    Last result = latest result.
  */

  const latest =
    results[
      results.length - 1
    ];


  if(twoDEl){

    twoDEl.textContent =
      latest.result_2d || "--";
  }


  if(roundEl){

    roundEl.textContent =
      latest.round_time ||
      "Waiting for result";
  }


  if(setEl){

    setEl.textContent =
      latest.set_value || "--";
  }


  if(valueEl){

    valueEl.textContent =
      latest.value_value || "--";
  }
}


/* =========================
   LOAD RESULTS
========================= */

async function loadTodayResults(){

  if(loadingResults){
    return;
  }


  loadingResults = true;


  try{

    const response =
      await fetch(
        `/api/results/today?t=${Date.now()}`,
        {
          method:"GET",
          cache:"no-store",

          headers:{
            "Accept":
              "application/json"
          }
        }
      );


    if(!response.ok){

      throw new Error(
        `HTTP ${response.status}`
      );
    }


    const data =
      await response.json();


    if(!data.success){

      throw new Error(
        data.error ||
        "Unable to load results"
      );
    }


    const results =
      Array.isArray(
        data.results
      )
        ? data.results
        : [];


    updateRoundCards(
      results
    );


    updateCurrentResult(
      results
    );


    setOnlineStatus(true);


  }catch(error){

    console.error(
      "Tartay result error:",
      error
    );


    setOnlineStatus(false);


  }finally{

    loadingResults = false;
  }
}


/* =========================
   SERVER STATUS
========================= */

async function checkStatus(){

  try{

    const response =
      await fetch(
        `/api/status?t=${Date.now()}`,
        {
          cache:"no-store"
        }
      );


    if(!response.ok){

      throw new Error(
        `HTTP ${response.status}`
      );
    }


    const data =
      await response.json();


    setOnlineStatus(
      data.status === "Online"
    );


  }catch(error){

    setOnlineStatus(false);
  }
}


/* =========================
   AUTO REFRESH
========================= */

function startAutoRefresh(){

  if(refreshTimer){

    clearInterval(
      refreshTimer
    );
  }


  refreshTimer =
    setInterval(
      () => {

        if(
          document.visibilityState
          === "visible"
        ){

          loadTodayResults();
        }

      },
      5000
    );
}


/* =========================
   INTERNET
========================= */

window.addEventListener(
  "online",
  () => {

    checkStatus();
    loadTodayResults();

  }
);


window.addEventListener(
  "offline",
  () => {

    setOnlineStatus(false);

  }
);


/* =========================
   RETURN TO PAGE
========================= */

document.addEventListener(
  "visibilitychange",
  () => {

    if(
      document.visibilityState
      === "visible"
    ){

      checkStatus();
      loadTodayResults();
    }

  }
);


window.addEventListener(
  "focus",
  () => {

    loadTodayResults();

  }
);


/* =========================
   START
========================= */

function startApp(){

  /*
    First create ALL 8 rounds.
  */

  createRoundCards();


  setOnlineStatus(
    navigator.onLine
  );


  checkStatus();

  loadTodayResults();

  startAutoRefresh();
}


startApp();
