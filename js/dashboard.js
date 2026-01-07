import { db } from "./firebase-init.js";
import {
    collection,
    onSnapshot,
    query,
    orderBy,
    getDoc,
    doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================
   CONSTANTS
============================================================ */
const CORE_TEAM = ["Craig", "Jamie", "John", "Johnny", "Lar", "Shane"];
const SWEEP_TEAM = ["Bradley", "Keith", "Ross"];

// Rank tracking
let lastRankings = { CORE: {}, SWEEP: {} };

/* ============================================================
   DATE HELPERS
============================================================ */
function todayStr() {
  // UTC YYYY-MM-DD
  return new Date().toISOString().split("T")[0];
}

function getMondayStartUTC(now = new Date()) {
  const d = new Date(now);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Monday
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0); // Monday 00:00 UTC
  return d;
}

function getWeekRangeUTC(now = new Date()) {
  const mondayStart = getMondayStartUTC(now);
  const sundayEnd = new Date(mondayStart);
  sundayEnd.setUTCDate(sundayEnd.getUTCDate() + 6);
  sundayEnd.setUTCHours(23, 59, 59, 999); // Sunday end UTC
  return { mondayStart, sundayEnd };
}

function saleDateTimeUTC(s) {
  // Prefer Firestore timestamp (most reliable)
  if (s?.timestamp?.toDate) return s.timestamp.toDate();

  // Fallback: treat stored YYYY-MM-DD as UTC midnight
  return new Date(s.date + "T00:00:00.000Z");
}

function sameDay(dateStr) {
  return dateStr === todayStr();
}

// ✅ Weekly logic (Option B): uses timestamp
function inCurrentWeekSale(s) {
  const dt = saleDateTimeUTC(s);
  const { mondayStart, sundayEnd } = getWeekRangeUTC(new Date());
  return dt >= mondayStart && dt <= sundayEnd;
}

function inCurrentMonth(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getUTCMonth() === now.getUTCMonth() && d.getUTCFullYear() === now.getUTCFullYear();
}

function inCurrentYear(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getUTCFullYear() === now.getUTCFullYear();
}

/* ============================================================
   OTHER HELPERS
============================================================ */
function getRankingsForTeam(teamMembers, stats) {

  // REVENUE = upfront + monitoring averages
  const revenueScores = teamMembers.map(agent => ({
    agent,
    score: stats[agent].avgUpfront + stats[agent].avgMonitoring
  }));

  revenueScores.sort((a, b) => b.score - a.score);
  const teamRevenueWinner = revenueScores[0]?.agent || null;

  // CROWN = highest monthly
  const monthlyScores = teamMembers.map(agent => ({
    agent,
    score: stats[agent].monthly
  }));

  monthlyScores.sort((a, b) => b.score - a.score);
  const teamCrownWinner = monthlyScores[0]?.agent || null;

  return { teamRevenueWinner, teamCrownWinner };
}

function highlightRow(agentName) {
  const row = document.querySelector(`tr[data-agent="${agentName}"]`);
  if (!row) return;

  row.classList.add("row-highlight");

  setTimeout(() => {
    row.classList.remove("row-highlight");
  }, 5000);
}

function setupMonthlyOverrideUI() {
  const el = document.getElementById("kpi-monthly");
  if (!el) return;

  el.style.cursor = "pointer";
  el.title = "Click to override Monthly total (Shift+Click to clear)";

  el.addEventListener("click", (e) => {
    if (e.shiftKey) {
      localStorage.removeItem("monthlyAdj");
      return;
    }

    const current = el.textContent;
    const input = prompt("Set Monthly Sales display total:", current);
    if (input === null) return;

    const n = Number(input);
    if (!Number.isFinite(n) || n < 0) {
      alert("Please enter a valid non-negative number.");
      return;
    }

    const computed = window.__computedMonthly ?? 0;
    const adj = Math.floor(n) - computed;
    localStorage.setItem("monthlyAdj", String(adj));
  });
}

window.addEventListener("DOMContentLoaded", setupMonthlyOverrideUI);

/* ============================================================
   SALE GIF POPUP (NEW)
============================================================ */

// Put your GIF URLs/paths here (local files or hosted URLs).
// Example local paths if you store them in your project: "./gifs/Craig.gif"
const AGENT_SALE_GIFS = {
  Craig: "https://i.pinimg.com/originals/58/79/48/587948a4f2ea9f54326ed45c75f4b8a7.gif",
  Jamie: "https://media1.tenor.com/m/B9u7ieoD8pQAAAAd/football-simpsons.gif",
  John: "https://media1.tenor.com/m/2VH-Vgmk2lkAAAAd/liverpool-vs-everton-redfox9.gif",
  Johnny: "https://media1.tenor.com/m/6jVUh917E1oAAAAd/trevor-nyakane-trevor.gif",
  Lar: "https://media3.giphy.com/media/v1.Y2lkPTZjMDliOTUyc2xnN2RpMG5wdGM3c3V3ZnlrYmpjN2p6dTZnc2cxbTIzbWF1NWVuNyZlcD12MV9naWZzX3NlYXJjaCZjdD1n/Q6lrzliWvxS6c/giphy.gif",
  Shane: "https://media1.tenor.com/m/RSc9Gw10HnsAAAAd/shrek-smirk-shrek-sus.gif",
  Bradley: "https://i.giphy.com/media/Ri7d8I18cto2jufOKc/giphy.gif",
  Keith: "https://media.tenor.com/EAlz6eFaJSsAAAAM/tongue-cow.gif",
  Ross: "https://media.giphy.com/media/DiGKElg3wsvy8/giphy.gif",
  default: "https://saleshive.com/wp-content/uploads/2020/07/saleshive-sale.gif"
};

let saleGifHideTimer = null;

function ensureSaleGifOverlay() {
  if (document.getElementById("sale-gif-overlay")) return;

  // Inject CSS once
  const style = document.createElement("style");
  style.id = "sale-gif-style";
  style.textContent = `
    #sale-gif-overlay{
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(0,0,0,.55);
      z-index: 99999;
    }
    #sale-gif-overlay.show{ display: flex; }
    #sale-gif-card{
      background: rgba(0,0,0,.85);
      border-radius: 16px;
      padding: 16px;
      max-width: min(520px, 90vw);
      box-shadow: 0 20px 60px rgba(0,0,0,.45);
      text-align: center;
    }
    #sale-gif-text{
      color: #fff;
      font-weight: 800;
      margin-bottom: 10px;
      font-size: 18px;
      letter-spacing: .2px;
    }
    #sale-gif-img{
      width: 100%;
      height: auto;
      border-radius: 12px;
      display: block;
    }
  `;
  document.head.appendChild(style);

  // Overlay DOM
  const overlay = document.createElement("div");
  overlay.id = "sale-gif-overlay";
  overlay.setAttribute("aria-hidden", "true");

  const card = document.createElement("div");
  card.id = "sale-gif-card";

  const text = document.createElement("div");
  text.id = "sale-gif-text";

  const img = document.createElement("img");
  img.id = "sale-gif-img";
  img.alt = "Sale celebration";

  card.appendChild(text);
  card.appendChild(img);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Click to dismiss
  overlay.addEventListener("click", () => {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
    clearTimeout(saleGifHideTimer);
  });
}

function showSaleGif(agentName) {
  ensureSaleGifOverlay();

  const overlay = document.getElementById("sale-gif-overlay");
  const text = document.getElementById("sale-gif-text");
  const img = document.getElementById("sale-gif-img");
  if (!overlay || !text || !img) return;

  const url = AGENT_SALE_GIFS[agentName] || AGENT_SALE_GIFS.default;

  text.textContent = `${agentName} made a sale!`;
  img.src = url;

  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");

  clearTimeout(saleGifHideTimer);
  saleGifHideTimer = setTimeout(() => {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
  }, 6000);
}

window.addEventListener("DOMContentLoaded", ensureSaleGifOverlay);

/* ============================================================
   LOAD TARGETS FROM FIRESTORE
============================================================ */
let targets = {
    daily: 0,
    weekly: 0,
    monthly: 0,
    avgRevenue: 0,
    avgUpfront: 0
};

async function loadTargets() {
    const ref = doc(db, "targets", "main");
    const snap = await getDoc(ref);
    if (snap.exists()) {
        targets = snap.data();
    }
}

/* ============================================================
   REAL-TIME DATA LISTENER
============================================================ */
const q = query(collection(db, "sales"), orderBy("timestamp", "asc"));

// Prevent GIF spam on first load (only show for new adds after initial snapshot)
let isInitialSalesSnapshot = true;

onSnapshot(q, async (snapshot) => {
    await loadTargets();

    // Highlight the agent who just made a sale
    snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
            const sale = change.doc.data();
            highlightRow(sale.agent);

            // ✅ Only show GIF for new sales AFTER initial load
            if (!isInitialSalesSnapshot) {
              showSaleGif(sale.agent);
            }
        }
    });

    // Build the array of sales
    const sales = [];
    snapshot.forEach(doc => sales.push(doc.data()));

    // Update dashboard
    processSales(sales);

    // flip after first snapshot completes
    isInitialSalesSnapshot = false;
});

/* ============================================================
   MAIN PROCESSING FUNCTION
============================================================ */
function processSales(sales) {
    const agentStats = {};

    [...CORE_TEAM, ...SWEEP_TEAM].forEach(a => {
        agentStats[a] = {
            daily: 0,
            weekly: 0,
            monthly: 0,
            yearly: 0,
            upfrontTotal: 0,
            monitoringTotal: 0,
            count: 0,
            avgUpfront: 0,
            avgMonitoring: 0
        };
    });

    sales.forEach(s => {
        const a = s.agent;
        if (!agentStats[a]) return;

        agentStats[a].count++;
        agentStats[a].upfrontTotal += Number(s.upfront);
        agentStats[a].monitoringTotal += Number(s.monitoring);

        if (sameDay(s.date)) agentStats[a].daily++;
        if (inCurrentWeekSale(s)) agentStats[a].weekly++;
        if (inCurrentMonth(s.date)) agentStats[a].monthly++;
        if (inCurrentYear(s.date)) agentStats[a].yearly++;
    });

    // Calculate averages
    Object.keys(agentStats).forEach(a => {
        const s = agentStats[a];
        if (s.count > 0) {
            s.avgUpfront = s.upfrontTotal / s.count;
            s.avgMonitoring = s.monitoringTotal / s.count;
        }
    });

    updateKPIs(agentStats);
    updateTeams(agentStats);
}

/* ============================================================
   KPI UPDATES + PROGRESS BARS
============================================================ */
function updateKPIs(stats) {
    let daily = 0, weekly = 0, monthly = 0, totalUpfront = 0, totalMonitoring = 0, totalCount = 0;

    Object.values(stats).forEach(s => {
        daily += s.daily;
        weekly += s.weekly;
        monthly += s.monthly;

        totalUpfront += s.upfrontTotal;
        totalMonitoring += s.monitoringTotal;
        totalCount += s.count;
    });

    const avgRevenue = totalCount > 0 ? (totalMonitoring) / totalCount : 0;
    const avgUpfront = totalCount > 0 ? totalUpfront / totalCount : 0;

// ✅ Monthly adjustment (localStorage) — keeps increasing with new sales
const monthlyAdj = Number(localStorage.getItem("monthlyAdj") || 0);
const monthlyDisplay = monthly + monthlyAdj;

// expose computed monthly so the click handler can calculate the adjustment
window.__computedMonthly = monthly;

    // Update counts
    document.getElementById("kpi-daily").textContent = daily;
    document.getElementById("kpi-weekly").textContent = weekly;
    document.getElementById("kpi-monthly").textContent = monthlyDisplay;
    document.getElementById("kpi-avg-revenue").textContent = "€" + avgRevenue.toFixed(2);
    document.getElementById("kpi-avg-upfront").textContent = "€" + avgUpfront.toFixed(2);

    // Update progress bars
    updateBar("daily", daily, targets.daily);
    updateBar("weekly", weekly, targets.weekly);
    updateBar("monthly", monthlyDisplay, targets.monthly);
    updateBar("avg-revenue", avgRevenue, targets.avgRevenue);
    updateBar("avg-upfront", avgUpfront, targets.avgUpfront);
}

function updateBar(type, value, target) {
    const bar = document.getElementById(`kpi-${type}-bar`);
    const text = document.getElementById(`kpi-${type}-progress`);

    const pct = target > 0 ? Math.min((value / target) * 100, 100) : 0;

    text.textContent = `${value.toFixed ? value.toFixed(2) : value} / ${target}`;

    bar.style.width = pct + "%";

    if (pct < 70) bar.style.background = "#F36E21";      // Orange
    else if (pct < 100) bar.style.background = "#FDB71A"; // Yellow
    else bar.style.background = "#2ecc71";                // Green
}

/* ============================================================
   TEAM PROCESSOR
============================================================ */
function updateTeams(stats) {
    populateTeamTable("CORE", CORE_TEAM, stats, document.getElementById("core-team-body"));
    populateTeamTable("SWEEP", SWEEP_TEAM, stats, document.getElementById("sweep-team-body"));
}

function populateTeamTable(teamName, members, stats, tbody) {

    // Get winners (crown + revenue)
    const { teamRevenueWinner, teamCrownWinner } = getRankingsForTeam(members, stats);

    const sorted = members.sort((a, b) => stats[b].monthly - stats[a].monthly);

    tbody.innerHTML = "";

    sorted.forEach((agent, index) => {
        const s = stats[agent];
        const newRank = index + 1;
        const oldRank = lastRankings[teamName][agent] || newRank;

        const movedUp = newRank < oldRank;
        const rowClass = movedUp ? "rank-up" : "";

        const row = `
            <tr class="${rowClass}" data-agent="${agent}">
                <td>${agent}</td>
                <td class="badge-cell">
                    ${getBadges(agent, s, teamName, teamRevenueWinner, teamCrownWinner)}
                </td>
                <td>${s.daily}</td>
                <td>${s.weekly}</td>
                <td>${s.monthly}</td>
                <td>€${s.avgUpfront.toFixed(2)}</td>
                <td>€${s.avgMonitoring.toFixed(2)}</td>
                <td>${s.yearly}</td>
                <td>${newRank}</td>
            </tr>
        `;

        tbody.innerHTML += row;

        lastRankings[teamName][agent] = newRank;
    });
}

/* ============================================================
   BADGE SYSTEM (NEW TOOLTIP VERSION)
============================================================ */
function getBadges(agent, s, teamName, teamRevenueWinner, teamCrownWinner) {
    const badges = [];

    // -----------------------
    // 1. DAILY STREAK BADGES (TEAM SPECIFIC)
    // -----------------------
    if (teamName === "CORE") {
        if (s.daily >= 7)
            badges.push(`<span class="badge badge-power" data-tooltip="POWER – 7+ daily">⚡</span>`);
        else if (s.daily >= 5)
            badges.push(`<span class="badge badge-fire" data-tooltip="ON FIRE – 5+ daily">🔥</span>`);
        else if (s.daily >= 3)
            badges.push(`<span class="badge badge-hot" data-tooltip="HOT – 3+ daily">🌶️</span>`);
    } 
    else if (teamName === "SWEEP") {
        if (s.daily >= 5)
            badges.push(`<span class="badge badge-power" data-tooltip="POWER – 5+ daily">⚡</span>`);
        else if (s.daily >= 3)
            badges.push(`<span class="badge badge-fire" data-tooltip="ON FIRE – 3+ daily">🔥</span>`);
        else if (s.daily >= 1)
            badges.push(`<span class="badge badge-hot" data-tooltip="HOT – 1+ daily">🌶️</span>`);
    }

    // -----------------------
    // 2. WEEKLY PERFORMANCE BADGES (TEAM SPECIFIC)
    // -----------------------
    if (teamName === "CORE") {
        if (s.weekly >= 20)
            badges.push(`<span class="badge badge-destroy" data-tooltip="DESTROYER – 20+ weekly">💀</span>`);
        else if (s.weekly >= 15)
            badges.push(`<span class="badge badge-rocket" data-tooltip="ROCKET – 15+ weekly">🚀</span>`);
    } 
    else if (teamName === "SWEEP") {
        if (s.weekly >= 8)
            badges.push(`<span class="badge badge-destroy" data-tooltip="DESTROYER – 8+ weekly">💀</span>`);
        else if (s.weekly >= 6)
            badges.push(`<span class="badge badge-rocket" data-tooltip="ROCKET – 6+ weekly">🚀</span>`);
    }

    // -----------------------
    // 3. CROWN BADGE (Top Monthly in Team)
    // -----------------------
    if (agent === teamCrownWinner) {
        badges.push(`<span class="badge badge-crown" data-tooltip="Top Monthly Seller">👑</span>`);
    }

    // -----------------------
    // 4. TOP REVENUE BADGE
    // -----------------------
    if (agent === teamRevenueWinner) {
        badges.push(`<span class="badge badge-money" data-tooltip="Top Combined Revenue (Upfront + Monitoring)">💰</span>`);
    }

    return badges.join("");
}