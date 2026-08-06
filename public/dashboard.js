const RESULT_TIMES = [
  "5:00 PM", "6:00 PM", "7:00 PM", "8:00 PM",
  "9:00 PM", "10:00 PM", "11:00 PM", "12:00 AM"
];

const betForm = document.getElementById("betForm");
const saveButton = document.getElementById("saveButton");
const formMessage = document.getElementById("formMessage");
const resultMessage = document.getElementById("resultMessage");

if (!sessionStorage.getItem("tartay_user")) {
  location.href = "/";
}

betForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const customer_name = document.getElementById("customerName").value.trim();
  const phone = document.getElementById("phone").value.trim();
  const number = document.getElementById("number").value.trim();
  const amount = Number(document.getElementById("amount").value);
  const bet_type = document.getElementById("betType").value;

  if (!/^\d{2}$/.test(number)) {
    showBetMessage("2D Number must contain exactly 2 digits.", false);
    return;
  }

  saveButton.disabled = true;
  saveButton.textContent = "Saving...";

  try {
    const response = await fetch("/api/bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_name, phone, number, amount, bet_type })
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      showBetMessage(data.message || "Bet could not be saved.", false);
      return;
    }

    showBetMessage(`Bet saved successfully. ID: ${data.bet_id}`, true);
    betForm.reset();
    await loadBets();
  } catch {
    showBetMessage("Network error. Please try again.", false);
  } finally {
    saveButton.disabled = false;
    saveButton.textContent = "Save Bet";
  }
});

function showBetMessage(text, success) {
  formMessage.textContent = text;
  formMessage.className = `message ${success ? "success" : "error"}`;
}

async function loadBets() {
  const tableBody = document.getElementById("betTableBody");
  tableBody.innerHTML = '<tr><td colspan="8" class="empty-row">Loading...</td></tr>';

  try {
    const response = await fetch("/api/bets");
    const data = await response.json();

    if (!response.ok || !data.success) throw new Error();

    const bets = Array.isArray(data.bets) ? data.bets : [];
    updateSummary(bets);

    if (!bets.length) {
      tableBody.innerHTML = '<tr><td colspan="8" class="empty-row">No bets found.</td></tr>';
      return;
    }

    tableBody.innerHTML = bets.map((bet) => `
      <tr>
        <td>${escapeHtml(bet.id)}</td>
        <td>${escapeHtml(bet.customer_name)}</td>
        <td>${escapeHtml(bet.phone || "-")}</td>
        <td><strong>${escapeHtml(bet.number)}</strong></td>
        <td>${formatAmount(bet.amount)}</td>
        <td>${escapeHtml(bet.bet_type)}</td>
        <td>${escapeHtml(bet.status)}</td>
        <td>${escapeHtml(bet.created_at)}</td>
      </tr>
    `).join("");
  } catch {
    tableBody.innerHTML = '<tr><td colspan="8" class="empty-row">Bet list could not be loaded.</td></tr>';
  }
}

function updateSummary(bets) {
  const totalAmount = bets.reduce((sum, bet) => sum + Number(bet.amount || 0), 0);
  const customers = new Set(
    bets.map((bet) => String(bet.customer_name || "").trim()).filter(Boolean)
  );

  document.getElementById("totalBets").textContent = bets.length.toLocaleString();
  document.getElementById("totalAmount").textContent = formatAmount(totalAmount);
  document.getElementById("totalCustomers").textContent = customers.size.toLocaleString();
}

async function loadResults() {
  const grid = document.getElementById("resultGrid");
  grid.innerHTML = '<div class="empty-row">Loading results...</div>';

  try {
    const response = await fetch("/api/results");
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error();

    const byTime = new Map(
      (data.results || []).map((item) => [item.result_time, item])
    );

    grid.innerHTML = RESULT_TIMES.map((time) => {
      const item = byTime.get(time);
      const current = item?.result_number && item.result_number !== "--"
        ? item.result_number
        : "";

      return `
        <div class="result-admin-card">
          <div class="result-time">${time}</div>
          <input id="result-${slug(time)}" class="result-input" inputmode="numeric" maxlength="2" value="${escapeHtml(current)}" placeholder="--">
          <button class="primary-button small-button" type="button" onclick="saveResult('${time}')">Save</button>
        </div>
      `;
    }).join("");
  } catch {
    grid.innerHTML = '<div class="empty-row">Results could not be loaded.</div>';
  }
}

async function saveResult(time) {
  const input = document.getElementById(`result-${slug(time)}`);
  const result_number = input.value.trim();

  if (!/^\d{2}$/.test(result_number)) {
    showResultMessage("Result number must contain exactly 2 digits.", false);
    return;
  }

  try {
    const response = await fetch("/api/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result_time: time, result_number })
    });

    const data = await response.json();
    if (!response.ok || !data.success) {
      showResultMessage(data.message || "Result could not be saved.", false);
      return;
    }

    showResultMessage(`${time} result saved: ${result_number}`, true);
  } catch {
    showResultMessage("Network error. Please try again.", false);
  }
}

function showResultMessage(text, success) {
  resultMessage.textContent = text;
  resultMessage.className = `message ${success ? "success" : "error"}`;
}

function slug(value) {
  return value.toLowerCase().replaceAll(":", "").replaceAll(" ", "-");
}

function formatAmount(value) {
  return Number(value || 0).toLocaleString();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function logout() {
  sessionStorage.removeItem("tartay_user");
  location.href = "/";
}

loadResults();
loadBets();
