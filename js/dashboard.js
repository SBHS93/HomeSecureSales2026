import { db } from "./firebase-init.js";
import {
    collection,
    onSnapshot,
    query,
    orderBy,
    where,
    getDoc,
    doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================
   CONSTANTS
============================================================ */
const EXTRAS_AGENT = "Extras";
const CORE_TEAM = ["CRAIG", "JAMIE", "JOHN", "LAR", "SHANE", EXTRAS_AGENT];
const SWEEP_TEAM = ["AMY", "KEITH", "ROSS", "SUDEEP"];

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

function sameDay(dateStr) {
  return dateStr === todayStr();
}

// ✅ Weekly logic (uses the date entered in the sales form: YYYY-MM-DD)
function inCurrentWeekByDate(dateStr) {
  if (!dateStr) return false;

  const saleDate = new Date(dateStr + "T00:00:00.000Z");

  const mondayStart = getMondayStartUTC(new Date());
  const sundayEnd = new Date(mondayStart);
  sundayEnd.setUTCDate(sundayEnd.getUTCDate() + 6);
  sundayEnd.setUTCHours(23, 59, 59, 999);

  return saleDate >= mondayStart && saleDate <= sundayEnd;
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

  // Exclude Extras from winners
  const eligibleMembers = teamMembers.filter(a => a !== EXTRAS_AGENT);

  // REVENUE = upfront + monitoring averages
  const revenueScores = eligibleMembers.map(agent => ({
    agent,
    score: stats[agent].avgUpfront + stats[agent].avgMonitoring
  }));

  revenueScores.sort((a, b) => b.score - a.score);
  const teamRevenueWinner = revenueScores[0]?.agent || null;

  // CROWN = highest monthly
  const monthlyScores = eligibleMembers.map(agent => ({
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
   LIVE VISUALS: RECENT SALES TICKER + CELEBRATION MODE
============================================================ */

// Put your GIF URLs/paths here (local files or hosted URLs).
// Example local paths if you store them in your project: "./gifs/Craig.gif"
const AGENT_SALE_GIFS = {
  Craig: "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExbnRqYnQ5bDkwY3VremVrdmNna3FjMW40ZnVueXkzbHpwcDU4OHQxOCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/2O39eSY8bXDEd8fstT/giphy.gif",
  Jamie: "https://media1.tenor.com/m/B9u7ieoD8pQAAAAd/football-simpsons.gif",
  John: "https://media1.tenor.com/m/2VH-Vgmk2lkAAAAd/liverpool-vs-everton-redfox9.gif",
  Dean: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExNWNqNmR6YTVoZjVpOHdjOTdqOTRmeTJveWtkZDN0aThiNGp2bTZlNSZlcD12MV9pbnRlcm5hbF9naWQmY3Q9Zw/7FyMQm2vBiTjG/giphy.gif",
  Lar: "https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExYmFyZGNzOHk1ZGVsbDEzbDIwNTlwazY1eDU5YjBnZmx0cHA1NDJtOCZlcD12MV9pbnRlcm5hbF9naWQmY3Q9Zw/6niIcVJf6Ddfy/giphy.gif",
  Shane: "https://media1.tenor.com/m/RSc9Gw10HnsAAAAd/shrek-smirk-shrek-sus.gif",
  Bradley: "https://media1.tenor.com/m/yWteb8ReV3QAAAAd/shawn-michaels.gif",
  Keith: "https://media.tenor.com/EAlz6eFaJSsAAAAM/tongue-cow.gif",
  Ross: "https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExNnBuYjhnOGFhMGRpNmFtZWRwcnE0Z3Yzc3NwcmVnNDNqaHBiZW5scyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/71MyDPEhbICELAZNdO/giphy.gif",
  Sudeep: "https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExNnVlYTFkenVib3hzb252aDAwMGVwcHo3b29ndHRyNTF2ZHI4YXNtZiZlcD12MV9pbnRlcm5hbF9naWQmY3Q9Zw/lszAB3TzFtRaU/giphy.gif",
  default: "https://media1.tenor.com/m/731Wq9NV4GIAAAAC/sales-glen-glen-ross.gif"
};

let saleGifHideTimer = null;
let celebrationSoundEnabled = localStorage.getItem("celebrationSoundEnabled") !== "false";

// Random sale celebration sounds.
// Keep the sounds folder at the same level as index.html/admin.html/sales-form.html.
const CELEBRATION_SOUND_URLS = [
  "./sounds/sale-sound-1.mp3",
  "./sounds/sale-sound-2.mp3",
  "./sounds/sale-sound-3.mp3",
  "./sounds/sale-sound-4.mp3",
  "./sounds/sale-sound-5.mp3",
  "./sounds/sale-sound-6.mp3",
  "./sounds/sale-sound-7.mp3"
];

const CELEBRATION_SOUND_LENGTH_MS = 5000;

let activeCelebrationAudio = null;
let celebrationAudioUnlocked = false;
let lastCelebrationSoundUrl = null;

function createCelebrationAudio(url) {
  const audio = new Audio(url);
  audio.preload = "auto";
  audio.volume = 1.0;
  return audio;
}

function pickRandomCelebrationSoundUrl() {
  if (CELEBRATION_SOUND_URLS.length === 1) return CELEBRATION_SOUND_URLS[0];

  let url = CELEBRATION_SOUND_URLS[Math.floor(Math.random() * CELEBRATION_SOUND_URLS.length)];

  // Avoid the same sound twice in a row where possible.
  if (url === lastCelebrationSoundUrl) {
    url = CELEBRATION_SOUND_URLS[Math.floor(Math.random() * CELEBRATION_SOUND_URLS.length)];
  }

  lastCelebrationSoundUrl = url;
  return url;
}

function unlockCelebrationAudio() {
  if (celebrationAudioUnlocked) return;

  const audio = createCelebrationAudio(CELEBRATION_SOUND_URLS[0]);
  audio.muted = true;
  audio.currentTime = 0;

  audio.play().then(() => {
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    celebrationAudioUnlocked = true;
  }).catch(() => {
    audio.muted = false;
  });
}

window.addEventListener("pointerdown", unlockCelebrationAudio, { once: true });
window.addEventListener("keydown", unlockCelebrationAudio, { once: true });

function formatEuro(value) {
  const n = Number(value || 0);
  return "€" + n.toFixed(2);
}

function saleTimestampToDate(sale) {
  if (sale.timestamp?.toDate) return sale.timestamp.toDate();
  if (sale.timestamp?.seconds) return new Date(sale.timestamp.seconds * 1000);
  if (sale.date) return new Date(sale.date + "T12:00:00");
  return new Date();
}

function timeAgo(date) {
  const diffSeconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  if (diffSeconds < 60) return "just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? "" : "s"} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}

function ensureLiveVisualStyles() {
  if (document.getElementById("live-visual-style")) return;

  const style = document.createElement("style");
  style.id = "live-visual-style";
  style.textContent = `
    #recent-sales-ticker{
      width: 100%;
      margin: 18px 0 28px 0;
      border-radius: 18px;
      display: flex;
      align-items: center;
      gap: 14px;
      background: linear-gradient(90deg, #004053, #00627a);
      color: #fff;
      border: 3px solid #F36E21;
      box-shadow: 0 8px 24px rgba(0,0,0,.18);
      overflow: hidden;
      min-height: 58px;
      font-size: 19px;
      font-weight: 800;
    }
    #recent-sales-label{
      flex: 0 0 auto;
      align-self: stretch;
      display: flex;
      align-items: center;
      padding: 0 18px;
      background: #F36E21;
      color: #fff;
      letter-spacing: .3px;
      white-space: nowrap;
    }
    #recent-sales-track-wrap{
      overflow: hidden;
      flex: 1;
      white-space: nowrap;
    }
    #recent-sales-track{
      display: inline-block;
      padding-left: 100%;
      animation: recentSalesScroll 38s linear infinite;
    }
    #recent-sales-ticker:hover #recent-sales-track{
      animation-play-state: paused;
    }
    .ticker-sale-item{
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-right: 42px;
    }
    .ticker-agent{
      color: #FDB71A;
    }
    @keyframes recentSalesScroll{
      from { transform: translateX(0); }
      to { transform: translateX(-100%); }
    }
    #celebration-sound-toggle,
    #celebration-test-btn{
      position: fixed;
      right: 14px;
      z-index: 99991;
      border: none;
      border-radius: 999px;
      padding: 10px 14px;
      font-size: 14px;
      font-weight: 900;
      cursor: pointer;
      background: #FDB71A;
      color: #102027;
      box-shadow: 0 8px 22px rgba(0,0,0,.25);
    }
    #celebration-sound-toggle{ bottom: 14px; }
    #celebration-test-btn{ bottom: 58px; background: #F36E21; color: #fff; }
    #sale-gif-overlay{
      position: fixed;
      inset: 0;
      display: none;
      align-items: center;
      justify-content: center;
      background: radial-gradient(circle at center, rgba(253,183,26,.16), rgba(0,0,0,.72));
      z-index: 99999;
      overflow: hidden;
    }
    #sale-gif-overlay.show{ display: flex; }
    #sale-gif-card{
      position: relative;
      background: rgba(0,0,0,.88);
      border: 4px solid #FDB71A;
      border-radius: 24px;
      padding: 18px;
      width: min(1100px, 74vw);
      max-width: 92vw;
      box-shadow: 0 24px 80px rgba(0,0,0,.55), 0 0 44px rgba(253,183,26,.55);
      text-align: center;
      animation: celebrationPop .35s ease-out;
    }
    #sale-gif-text{
      color: #fff;
      font-weight: 950;
      margin-bottom: 6px;
      font-size: clamp(34px, 5vw, 72px);
      letter-spacing: .4px;
      text-transform: uppercase;
      text-shadow: 0 4px 20px rgba(0,0,0,.55);
    }
    #sale-gif-details{
      color: #FDB71A;
      font-size: clamp(20px, 2.2vw, 34px);
      font-weight: 900;
      margin-bottom: 14px;
    }
    #sale-gif-img{
      width: 100%;
      max-height: 62vh;
      object-fit: contain;
      border-radius: 16px;
      display: block;
      background: #000;
    }
    .confetti-piece{
      position: fixed;
      top: -20px;
      width: 12px;
      height: 18px;
      opacity: .95;
      z-index: 100000;
      animation: confettiFall 2.8s linear forwards;
    }
    @keyframes celebrationPop{
      from { transform: scale(.84); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    @keyframes confettiFall{
      0% { transform: translateY(-30px) rotate(0deg); }
      100% { transform: translateY(110vh) rotate(720deg); }
    }
    @media (max-width: 700px){
      #recent-sales-ticker{ font-size: 15px; min-height: 48px; margin: 14px 0 20px 0; border-radius: 14px; }
      #recent-sales-label{ padding: 0 10px; }
      #celebration-sound-toggle{ bottom: 60px; right: 8px; }
      #celebration-test-btn{ bottom: 104px; right: 8px; }
      #sale-gif-card{ width: 92vw; }
    }
  `;
  document.head.appendChild(style);
}

function ensureSoundToggle() {
  if (document.getElementById("celebration-sound-toggle")) return;

  const btn = document.createElement("button");
  btn.id = "celebration-sound-toggle";
  btn.type = "button";
  btn.textContent = celebrationSoundEnabled ? "🔊 Sound ON" : "🔇 Sound OFF";
  btn.title = "Toggle sale celebration sound";

  btn.addEventListener("click", () => {
    unlockCelebrationAudio();
    celebrationSoundEnabled = !celebrationSoundEnabled;
    localStorage.setItem("celebrationSoundEnabled", String(celebrationSoundEnabled));
    btn.textContent = celebrationSoundEnabled ? "🔊 Sound ON" : "🔇 Sound OFF";
    if (celebrationSoundEnabled) playCelebrationSound();
  });

  document.body.appendChild(btn);
}


function ensureCelebrationTestButton() {
  if (document.getElementById("celebration-test-btn")) return;

  const btn = document.createElement("button");
  btn.id = "celebration-test-btn";
  btn.type = "button";
  btn.textContent = "🎉 Test";
  btn.title = "Test the sale celebration popup, confetti, and sound";

  btn.addEventListener("click", () => {
    celebrationSoundEnabled = true;
    localStorage.setItem("celebrationSoundEnabled", "true");
    const soundBtn = document.getElementById("celebration-sound-toggle");
    if (soundBtn) soundBtn.textContent = "🔊 Sound ON";
    unlockCelebrationAudio();
    showSaleGif("Craig", { upfront: 299, monitoring: 45, date: todayStr() });
  });

  document.body.appendChild(btn);
}

function playFallbackCelebrationTone() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(0.8, ctx.currentTime + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 3);
    master.connect(ctx.destination);

    const freqs = [523.25, 659.25, 783.99, 1046.5];
    freqs.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, ctx.currentTime + index * 0.04);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.08 + index * 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 2.8);
      osc.connect(gain);
      gain.connect(master);
      osc.start(ctx.currentTime + index * 0.04);
      osc.stop(ctx.currentTime + 3);
    });
  } catch (err) {
    console.warn("Fallback celebration sound could not play:", err);
  }
}

function playCelebrationSound() {
  if (!celebrationSoundEnabled) return;

  try {
    if (activeCelebrationAudio) {
      activeCelebrationAudio.pause();
      activeCelebrationAudio.currentTime = 0;
    }

    const soundUrl = pickRandomCelebrationSoundUrl();
    activeCelebrationAudio = createCelebrationAudio(soundUrl);
    activeCelebrationAudio.currentTime = 0;
    activeCelebrationAudio.volume = 1.0;

    activeCelebrationAudio.play().then(() => {
      celebrationAudioUnlocked = true;

      setTimeout(() => {
        if (activeCelebrationAudio) {
          activeCelebrationAudio.pause();
          activeCelebrationAudio.currentTime = 0;
        }
      }, CELEBRATION_SOUND_LENGTH_MS);
    }).catch((err) => {
      console.warn("Celebration sound did not play. Check that the sounds folder is uploaded beside index.html, or click the page once first:", err);
      playFallbackCelebrationTone();
    });
  } catch (err) {
    console.warn("Celebration sound could not play:", err);
    playFallbackCelebrationTone();
  }
}

function launchConfetti() {
  const colors = ["#F36E21", "#FDB71A", "#2ecc71", "#ffffff", "#00bcd4"];
  const count = 90;

  for (let i = 0; i < count; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = Math.random() * 0.45 + "s";
    piece.style.animationDuration = 2.1 + Math.random() * 1.6 + "s";
    piece.style.transform = `rotate(${Math.random() * 360}deg)`;
    document.body.appendChild(piece);

    setTimeout(() => piece.remove(), 4200);
  }
}

function ensureSaleGifOverlay() {
  ensureLiveVisualStyles();
  ensureSoundToggle();
  ensureCelebrationTestButton();

  if (document.getElementById("sale-gif-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "sale-gif-overlay";
  overlay.setAttribute("aria-hidden", "true");

  const card = document.createElement("div");
  card.id = "sale-gif-card";

  const text = document.createElement("div");
  text.id = "sale-gif-text";

  const details = document.createElement("div");
  details.id = "sale-gif-details";

  const img = document.createElement("img");
  img.id = "sale-gif-img";
  img.alt = "Sale celebration";

  card.appendChild(text);
  card.appendChild(details);
  card.appendChild(img);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  overlay.addEventListener("click", () => {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
    clearTimeout(saleGifHideTimer);
  });
}

function showSaleGif(agentName, sale = {}) {
  ensureSaleGifOverlay();

  const overlay = document.getElementById("sale-gif-overlay");
  const text = document.getElementById("sale-gif-text");
  const details = document.getElementById("sale-gif-details");
  const img = document.getElementById("sale-gif-img");
  if (!overlay || !text || !details || !img) return;

  const url = AGENT_SALE_GIFS[agentName] || AGENT_SALE_GIFS.default;
  const upfront = formatEuro(sale.upfront);
  const monitoring = formatEuro(sale.monitoring);

  text.textContent = `${agentName} made a sale!`;
  details.textContent = `${upfront} upfront • ${monitoring} monitoring`;
  img.src = url;

  overlay.classList.add("show");
  overlay.setAttribute("aria-hidden", "false");

  launchConfetti();
  playCelebrationSound();

  clearTimeout(saleGifHideTimer);
  saleGifHideTimer = setTimeout(() => {
    overlay.classList.remove("show");
    overlay.setAttribute("aria-hidden", "true");
  }, 9000);
}

function ensureRecentSalesTicker() {
  ensureLiveVisualStyles();

  if (document.getElementById("recent-sales-ticker")) return;

  const ticker = document.createElement("div");
  ticker.id = "recent-sales-ticker";

  const label = document.createElement("div");
  label.id = "recent-sales-label";
  label.textContent = "🔥 Recent Sales";

  const wrap = document.createElement("div");
  wrap.id = "recent-sales-track-wrap";

  const track = document.createElement("div");
  track.id = "recent-sales-track";
  track.textContent = "Waiting for sales...";

  wrap.appendChild(track);
  ticker.appendChild(label);
  ticker.appendChild(wrap);

  const kpiContainer = document.querySelector(".kpi-container");
  if (kpiContainer && kpiContainer.parentNode) {
    kpiContainer.insertAdjacentElement("afterend", ticker);
  } else {
    document.body.insertBefore(ticker, document.body.firstChild);
  }
}

function updateRecentSalesTicker(sales) {
  ensureRecentSalesTicker();

  const track = document.getElementById("recent-sales-track");
  if (!track) return;

  const recentSales = [...sales]
    .sort((a, b) => saleTimestampToDate(b).getTime() - saleTimestampToDate(a).getTime())
    .slice(0, 10);

  if (recentSales.length === 0) {
    track.textContent = "No sales recorded yet.";
    return;
  }

  track.innerHTML = recentSales.map((sale) => {
    const agent = sale.agent || EXTRAS_AGENT;
    const when = timeAgo(saleTimestampToDate(sale));
    return `
      <span class="ticker-sale-item">
        <span>💰</span>
        <span class="ticker-agent">${agent}</span>
        <span>${formatEuro(sale.upfront)} upfront</span>
        <span>•</span>
        <span>${formatEuro(sale.monitoring)} monitoring</span>
        <span>•</span>
        <span>${when}</span>
      </span>
    `;
  }).join("");
}

window.addEventListener("DOMContentLoaded", () => {
  ensureSaleGifOverlay();
  ensureRecentSalesTicker();
});

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
// Only load sales from the current year so the dashboard stays fast
// while keeping the Yearly column correct for this year.
const startOfYear = `${new Date().getFullYear()}-01-01`;

const q = query(
    collection(db, "sales"),
    where("date", ">=", startOfYear),
    orderBy("date", "asc")
);

// Prevent GIF spam on first load (only show for new adds after initial snapshot)
let isInitialSalesSnapshot = true;

onSnapshot(q, async (snapshot) => {
    await loadTargets();

    // Highlight the agent who just made a sale
    snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
            const sale = change.doc.data();
            const agentName = (sale.agent && (CORE_TEAM.includes(sale.agent) || SWEEP_TEAM.includes(sale.agent))) ? sale.agent : EXTRAS_AGENT;
            highlightRow(agentName);

            // ✅ Only show GIF + sound for new sales AFTER initial load
            if (!isInitialSalesSnapshot) {
              showSaleGif(agentName, sale);
            }
        }
    });

    // Build the array of sales
    const sales = [];
    snapshot.forEach(doc => sales.push(doc.data()));

    // Update visual ticker
    updateRecentSalesTicker(sales);

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
            monthlyUpfrontTotal: 0,
            monthlyMonitoringTotal: 0,
            monthlyCount: 0,
            avgUpfront: 0,
            avgMonitoring: 0
        };
    });

    sales.forEach(s => {
        const a = (s.agent && agentStats[s.agent]) ? s.agent : EXTRAS_AGENT;

        agentStats[a].count++;
        agentStats[a].upfrontTotal += Number(s.upfront);
        agentStats[a].monitoringTotal += Number(s.monitoring);


        // ✅ Month totals for averages (reset each month)
        if (inCurrentMonth(s.date)) {
            agentStats[a].monthlyCount++;
            agentStats[a].monthlyUpfrontTotal += Number(s.upfront);
            agentStats[a].monthlyMonitoringTotal += Number(s.monitoring);
        }
        if (sameDay(s.date)) agentStats[a].daily++;
        if (inCurrentWeekByDate(s.date)) agentStats[a].weekly++;
        if (inCurrentMonth(s.date)) agentStats[a].monthly++;
        if (inCurrentYear(s.date)) agentStats[a].yearly++;
    });

    // Calculate averages
    Object.keys(agentStats).forEach(a => {
        const s = agentStats[a];
        // ✅ Monthly averages (reset each month)
        if (s.monthlyCount > 0) {
            s.avgUpfront = s.monthlyUpfrontTotal / s.monthlyCount;
            s.avgMonitoring = s.monthlyMonitoringTotal / s.monthlyCount;
        } else {
            s.avgUpfront = 0;
            s.avgMonitoring = 0;
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

        totalUpfront += s.monthlyUpfrontTotal;
        totalMonitoring += s.monthlyMonitoringTotal;
        totalCount += s.monthlyCount;
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

    const sorted = members.sort((a, b) => {
        if (a === EXTRAS_AGENT) return 1;
        if (b === EXTRAS_AGENT) return -1;
        return stats[b].monthly - stats[a].monthly;
    });

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
    if (agent === EXTRAS_AGENT) return "";
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
