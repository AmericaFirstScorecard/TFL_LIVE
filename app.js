/* app.js - TFL Live Monitor
   Requires:
   - d3 v7 (csvParse)
   - chart.js v4 (Chart global)
*/

(() => {
  // ✅ Put your real published CSV URLs here:
  // Matchup (your sheet with: Update #, Minutes Left, Team A, Team B, Team A Win Probability, Team A has Ball..., Quarter, Down, Distance, Yards to Goal, Team A Point, Team B Point)
  const MATCHUP_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxNr3jLVjL4e24TvQR9iSkJP0T_lBiA2Dh5G9iut5_zDksYHEnbsu8k8f5Eo888Aha_UWuZXRhFNV0/pub?gid=0&single=true&output=csv";

  // MVP (your odds output sheet)
  const MVP_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQp0jxVIwA59hH031QxJFBsXdQVIi7fNdPS5Ra2w1lK2UYA08rC0moSSqoKPSFL8BRZFh_hC4cO8ymk/pub?output=csv";

  const POLL_MS = 30_000;

  const MIN_DISPLAY_PROB = 0.01;
  const MAX_DISPLAY_PROB = 0.99;

  const SMOOTH_WINDOW = 5;
  const MOMENTUM_THRESHOLD = 0.025;
  const BIG_SWING_THRESHOLD = 0.12;

  const LOGO_MAP = {
    cards: "Cards.png",
    cardinals: "Cards.png",
    "arizona cardinals": "Cards.png",
    lou: "Cards.png",
    louis: "Cards.png",

    bengals: "bengals.png",
    "cincinnati bengals": "bengals.png",

    "49ers": "Sanfran.png",
    sanfran: "Sanfran.png",
    "san fran": "Sanfran.png",
    "san francisco": "Sanfran.png",
    "san francisco 49ers": "Sanfran.png",
    sf: "Sanfran.png",

    cowboys: "cowboys.png",
    "dallas cowboys": "cowboys.png",

    giants: "giants.png",
    "new york giants": "giants.png",
  };

  const state = {
    chart: null,
    baseline: null,
    matchupLoading: true,
    mvpLoading: true,
    sort: { key: "mvpScore", dir: "desc" },
    lastMvpRecords: [],
    sortHandlersAttached: false,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    if (typeof d3 === "undefined") {
      console.error("d3 is not loaded. Make sure d3 script is included before app.js");
      return;
    }
    if (typeof Chart === "undefined") {
      console.error("Chart.js is not loaded. Make sure chart.js script is included before app.js");
      return;
    }

    cacheEls();
    initTabs();
    initChart();

    // Log so you can VERIFY which URLs are actually running in the browser
    console.info("[TFL] MATCHUP_CSV_URL:", MATCHUP_CSV_URL);
    console.info("[TFL] MVP_CSV_URL:", MVP_CSV_URL);

    fetchMatchup();
    fetchMvp();

    setInterval(fetchMatchup, POLL_MS);
    setInterval(fetchMvp, POLL_MS);
  });

  function cacheEls() {
    const id = (x) => document.getElementById(x);

    els.gameStatus = id("gameStatus");
    els.pillRow = id("pillRow");
    els.pregameTag = id("pregameTag");

    els.teamAName = id("teamAName");
    els.teamBName = id("teamBName");
    els.teamALogo = id("teamALogo");
    els.teamBLogo = id("teamBLogo");

    els.teamARecord = id("teamARecord");
    els.teamBRecord = id("teamBRecord");

    els.teamAScore = id("teamAScore");
    els.teamBScore = id("teamBScore");

    els.possession = id("possession");
    els.quarter = id("quarter");
    els.clock = id("clock");
    els.downDistance = id("downDistance");
    els.ytg = id("ytg");
    els.lastUpdate = id("lastUpdate");

    els.teamListChip = id("teamListChip");

    els.momentumValue = id("momentumValue");
    els.swingValue = id("swingValue");
    els.clutchValue = id("clutchValue");
    els.baselineValue = id("baselineValue");

    els.winLoading = id("winLoading");
    els.winError = id("winError");

    els.mvpLoading = id("mvpLoading");
    els.mvpError = id("mvpError");
    els.mvpEmpty = id("mvpEmpty");
    els.mvpTableBody = id("mvpTableBody");
    els.mvpStatus = id("mvpStatus");
  }

  function initTabs() {
    const navItems = Array.from(document.querySelectorAll(".nav__item"));
    const tabs = {
      win: document.getElementById("tab-win"),
      mvp: document.getElementById("tab-mvp"),
    };

    function setTab(tab) {
      Object.values(tabs).forEach((el) => el && el.classList.remove("tab--active"));
      navItems.forEach((el) => el.classList.remove("nav__item--active"));
      const key = tab === "mvp" ? "mvp" : "win";
      tabs[key]?.classList.add("tab--active");
      navItems.find((el) => el.dataset.tab === key)?.classList.add("nav__item--active");
      window.location.hash = `#${key}`;
    }

    navItems.forEach((el) =>
      el.addEventListener("click", (e) => {
        e.preventDefault();
        setTab(el.dataset.tab);
      })
    );

    window.addEventListener("hashchange", () => {
      const tab = window.location.hash.replace("#", "") || "win";
      setTab(tab);
    });

    setTab(window.location.hash.replace("#", "") || "win");
  }

  function initChart() {
    const canvas = document.getElementById("winProbChart");
    if (!canvas) return;

    const ctx2d = canvas.getContext("2d");

    const gradientA = ctx2d.createLinearGradient(0, 0, 0, 320);
    gradientA.addColorStop(0, "rgba(96,165,250,0.4)");
    gradientA.addColorStop(1, "rgba(96,165,250,0.05)");

    const gradientB = ctx2d.createLinearGradient(0, 0, 0, 320);
    gradientB.addColorStop(0, "rgba(168,85,247,0.4)");
    gradientB.addColorStop(1, "rgba(168,85,247,0.05)");

    const baselinePlugin = {
      id: "baselineMarker",
      afterDatasetsDraw(chart) {
        if (state.baseline == null) return;
        const {
          ctx,
          chartArea: { left, right },
          scales: { y },
        } = chart;

        ctx.save();
        ctx.strokeStyle = "rgba(255,255,255,0.25)";
        ctx.setLineDash([6, 4]);

        const yPos = y.getPixelForValue(state.baseline * 100);
        ctx.beginPath();
        ctx.moveTo(left, yPos);
        ctx.lineTo(right, yPos);
        ctx.stroke();
        ctx.restore();
      },
      afterDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        chart.data.datasets.forEach((ds, i) => {
          const meta = chart.getDatasetMeta(i);
          const last = meta?.data?.[meta.data.length - 1];
          if (!last) return;
          ctx.fillStyle = ds.borderColor;
          ctx.beginPath();
          ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = "rgba(0,0,0,0.6)";
          ctx.stroke();
        });
        ctx.restore();
      },
    };

    state.chart = new Chart(canvas, {
      type: "line",
      data: {
        labels: [],
        datasets: [
          {
            label: "Team A",
            data: [],
            tension: 0.35,
            fill: true,
            spanGaps: true,
            borderColor: "rgba(96,165,250,1)",
            backgroundColor: gradientA,
            pointRadius: 0,
            borderWidth: 3,
          },
          {
            label: "Team B",
            data: [],
            tension: 0.35,
            fill: true,
            spanGaps: true,
            borderColor: "rgba(168,85,247,1)",
            backgroundColor: gradientB,
            pointRadius: 0,
            borderWidth: 3,
          },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: "#e5e7eb" } },
          tooltip: {
            callbacks: {
              label(ctx) {
                return `${ctx.dataset.label}: ${ctx.formattedValue}%`;
              },
            },
          },
        },
        scales: {
          x: {
            ticks: { color: "#9ca3af", maxRotation: 0 },
            grid: { color: "rgba(255,255,255,0.05)" },
          },
          y: {
            min: 0,
            max: 100,
            ticks: { color: "#9ca3af", callback: (val) => `${val}%` },
            grid: { color: "rgba(255,255,255,0.05)" },
          },
        },
      },
      plugins: [baselinePlugin],
    });
  }

  async function fetchText(url) {
    // cache buster to prevent stale CSV/script caching
    const u = new URL(url, window.location.href);
    u.searchParams.set("_cb", Date.now().toString());

    const res = await fetch(u.toString(), { cache: "no-store" });
    if (!res.ok) {
      // Show better diagnostics than just "Failed"
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${u.toString()}`);
    }
    const text = await res.text();

    // Google sometimes returns an HTML "access denied" or "not published" page
    if (/<html/i.test(text)) {
      throw new Error(`Got HTML instead of CSV for ${u.toString()} (sheet may not be published/public)`);
    }

    return text;
  }

  async function fetchMatchup() {
    setLoading(els.winLoading, true);
    toggleError(els.winError, false);

    const url = overrideUrl("matchup") || MATCHUP_CSV_URL;

    try {
      const text = await fetchText(url);
      const parsed = parseMatchupCSV(text);
      if (!parsed.snapshots.length) throw new Error("No matchup rows parsed");
      renderMatchup(parsed);
      state.matchupLoading = false;
      setLoading(els.winLoading, false);
    } catch (err) {
      console.error("[matchup] ", err);
      toggleError(els.winError, true);

      // Always show something so the app doesn't look dead
      const fallback = buildSampleMatchup();
      renderMatchup(fallback);
      state.matchupLoading = false;
      setLoading(els.winLoading, false);
    }
  }

  async function fetchMvp() {
    setLoading(els.mvpLoading, true);
    toggleError(els.mvpError, false);

    const url = overrideUrl("mvp") || MVP_CSV_URL;

    try {
      const text = await fetchText(url);
      const records = parseMvpCSV(text);
      state.lastMvpRecords = records;
      renderMvp(records);
      setLoading(els.mvpLoading, false);
      state.mvpLoading = false;
    } catch (err) {
      console.error("[mvp] ", err);
      toggleError(els.mvpError, true);

      const fallback = buildSampleMvp();
      state.lastMvpRecords = fallback;
      renderMvp(fallback);
      state.mvpLoading = false;
      setLoading(els.mvpLoading, false);
    }
  }

  // Matchup parser designed around your sheet headers
  function parseMatchupCSV(text) {
    const rows = d3.csvParse(text);
    if (!rows || !rows.length) {
      return { snapshots: [], teamA: "Team A", teamB: "Team B", teams: [], baseline: null };
    }

    const normRow = (row) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) out[String(k).trim().toLowerCase()] = v;
      return out;
    };

    const pick = (r, keys) => {
      for (const k of keys) {
        const v = r[k];
        if (v != null && String(v).trim() !== "") return v;
      }
      return null;
    };

    const parseMinutesLeft = (val) => {
      if (val == null) return null;
      const s = String(val).trim();
      const m = s.match(/^(\d+):(\d{2})$/);
      if (m) return parseInt(m[1], 10) + parseInt(m[2], 10) / 60;
      return parseNumber(s);
    };

    const parseProb = (val) => {
      const n = parseNumber(val);
      if (n == null) return null;
      const p = n > 1 ? n / 100 : n;
      return clampProb(p);
    };

    const last = normRow(rows[rows.length - 1]);

    const teamA = String(pick(last, ["away", "team a"]) || "Team A").trim();
    const teamB = String(pick(last, ["home", "team b"]) || "Team B").trim();

    const snapshots = rows.map((row, i) => {
      const r = normRow(row);

      const update = String(pick(r, ["update #", "update"]) || `U${i + 1}`).trim();
      const minuteLeft = parseMinutesLeft(pick(r, ["minutes left", "minutes_left", "ml"]));

      // Your sheet: "Team A Win Probability"
      const probA = parseProb(
        pick(r, ["team a win probability", "away win probability", "team a win prob", "away wp"])
      );
      const probB = probA != null ? clampProb(1 - probA) : null;

      const hasBall = parseNumber(pick(r, ["team a has ball (1=yes, 0=no)", "team a has ball"]));
      const possession = hasBall == null ? "" : hasBall === 1 ? teamA : teamB;

      const quarter = String(pick(r, ["quarter", "qtr"]) || "").trim();
      const down = String(pick(r, ["down"]) || "").trim();
      const distance = String(pick(r, ["distance", "dist"]) || "").trim();
      const ytg = String(pick(r, ["yards to goal", "ytg", "to-go", "to go"]) || "").trim();

      const scoreA = parseNumber(pick(r, ["team a point", "team a points", "away point", "away points"])) ?? 0;
      const scoreB = parseNumber(pick(r, ["team b point", "team b points", "home point", "home points"])) ?? 0;

      // Optional baseline/pregame
      const pregame = parseProb(pick(r, ["pregame", "baseline", "pregame baseline"]));

      return {
        update,
        minuteLeft,
        // In your UI code, "homeSeries" is based on winProbHome
        winProbAway: probA,
        winProbHome: probB,
        scoreA,
        scoreB,
        possession,
        quarter,
        down,
        distance,
        ytg,
        pregame,
      };
    });

    const baseline = snapshots.find((s) => s.pregame != null)?.pregame ?? snapshots[0]?.winProbHome ?? null;
    const teams = Array.from(new Set([teamA, teamB].filter(Boolean)));

    return { snapshots, teamA, teamB, teams, baseline };
  }

  function renderMatchup({ snapshots, teamA, teamB, teams, baseline }) {
    if (!snapshots.length) return;

    const labels = snapshots.map((s) => (s.minuteLeft ?? s.update));
    const home = smoothSeries(snapshots.map((s) => toPct(s.winProbHome)));
    const away = smoothSeries(snapshots.map((s) => toPct(s.winProbAway)));

    state.baseline = baseline != null ? baseline : null;
    if (els.baselineValue) els.baselineValue.textContent = baseline != null ? `${(baseline * 100).toFixed(1)}%` : "—";
    if (els.pregameTag) els.pregameTag.textContent = baseline != null ? `Pregame baseline: ${(baseline * 100).toFixed(1)}%` : "Pregame baseline: —";

    updateChart(labels, home, away, teamA, teamB);

    const latest = snapshots[snapshots.length - 1];

    if (els.gameStatus) {
      const isFinal = latest.minuteLeft != null && latest.minuteLeft <= 0;
      els.gameStatus.textContent = isFinal ? "Final" : "Live";
      els.gameStatus.classList.toggle("badge--ghost", isFinal);
    }

    if (els.teamAName) els.teamAName.textContent = teamA;
    if (els.teamBName) els.teamBName.textContent = teamB;

    if (els.teamAScore) els.teamAScore.textContent = String(latest.scoreA ?? 0);
    if (els.teamBScore) els.teamBScore.textContent = String(latest.scoreB ?? 0);

    if (els.possession) els.possession.textContent = latest.possession ? `Possession: ${latest.possession}` : "Possession —";
    if (els.quarter) els.quarter.textContent = latest.quarter ? `Q${latest.quarter}` : "Q-";
    if (els.clock) els.clock.textContent = latest.minuteLeft != null ? `${latest.minuteLeft} ML` : "ML —";

    if (els.downDistance) els.downDistance.textContent = latest.down ? `Down: ${latest.down}` : "Down —";
    if (els.ytg) els.ytg.textContent = latest.ytg || latest.distance ? `${latest.ytg || latest.distance} YTG` : "YTG —";

    if (els.teamListChip) els.teamListChip.textContent = teams.length ? `Teams: ${teams.join(", ")}` : "Teams: —";
    if (els.lastUpdate) els.lastUpdate.textContent = `Last update: ${latest.update}`;

    setLogo(els.teamALogo, teamA);
    setLogo(els.teamBLogo, teamB);

    const metrics = analyzeGame(home, labels, baseline);
    if (els.momentumValue) els.momentumValue.textContent = metrics.momentum;
    if (els.swingValue) els.swingValue.textContent = metrics.bigSwing;
    if (els.clutchValue) els.clutchValue.textContent = metrics.clutch;

    renderPills(metrics, baseline);

    setLoading(els.winLoading, false);
    toggleError(els.winError, false);
  }

  function updateChart(labels, home, away, teamA, teamB) {
    if (!state.chart) return;
    state.chart.data.labels = labels;

    // dataset[0] shows away, dataset[1] shows home (matches your earlier layout)
    state.chart.data.datasets[0].label = teamA;
    state.chart.data.datasets[1].label = teamB;

    state.chart.data.datasets[0].data = away.map(forceNumberOrNull);
    state.chart.data.datasets[1].data = home.map(forceNumberOrNull);

    state.chart.update("none");
  }

  function analyzeGame(homeSeries, labels, baseline) {
    const filtered = homeSeries.filter((v) => v != null && !Number.isNaN(v));
    const recent = filtered.slice(-3);
    const delta = recent.length >= 2 ? recent[recent.length - 1] - recent[0] : 0;

    const momentum =
      Math.abs(delta) >= MOMENTUM_THRESHOLD * 100 ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts` : "Stable";

    const bigSwing = computeBigSwing(filtered);
    const clutch = computeClutch(filtered, labels);

    renderBaselinePill(baseline);

    return { momentum, bigSwing, clutch };
  }

  function computeBigSwing(series) {
    let swing = 0;
    for (let i = 1; i < series.length; i++) {
      const a = series[i - 1];
      const b = series[i];
      if (a == null || b == null) continue;
      swing = Math.max(swing, Math.abs(b - a));
    }
    return swing >= BIG_SWING_THRESHOLD * 100 ? `${swing.toFixed(1)} pts` : "—";
  }

  function computeClutch(series, labels) {
    if (!series.length) return "—";
    const lastLabel = labels[labels.length - 1];
    const last = series[series.length - 1];
    if (last == null) return "—";
    const isClutch =
      typeof lastLabel === "number"
        ? lastLabel <= 5 && last >= 35 && last <= 65
        : last >= 35 && last <= 65;
    return isClutch ? "In clutch" : "—";
  }

  function renderPills(metrics, baseline) {
    if (!els.pillRow) return;
    els.pillRow.innerHTML = "";

    const pills = [];
    if (baseline != null) pills.push({ label: "Pregame", value: `${(baseline * 100).toFixed(1)}%`, tone: "accent" });
    if (metrics.momentum !== "Stable") pills.push({ label: "Momentum", value: metrics.momentum, tone: "accent" });
    if (metrics.bigSwing !== "—") pills.push({ label: "Big swing", value: metrics.bigSwing, tone: "warning" });
    if (metrics.clutch === "In clutch") pills.push({ label: "Clutch time", value: "Tight window", tone: "danger" });

    if (!pills.length) pills.push({ label: "Calm", value: "No major swings", tone: "ghost" });

    pills.forEach((pill) => {
      const div = document.createElement("div");
      div.className = `pill ${pill.tone ? `pill--${pill.tone}` : ""}`.trim();
      div.textContent = `${pill.label}: ${pill.value}`;
      els.pillRow.appendChild(div);
    });
  }

  function renderBaselinePill(baseline) {
    if (!els.pregameTag) return;
    if (baseline == null) return;
    els.pregameTag.textContent = `Pregame baseline: ${(baseline * 100).toFixed(1)}%`;
  }

  function smoothSeries(series) {
    // Ensure numbers/null only
    const cleaned = series.map(forceNumberOrNull);
    const values = cleaned.filter((v) => v != null);
    if (!values.length) return cleaned.map(() => null);

    const pad = Math.floor(SMOOTH_WINDOW / 2);
    const first = values[0];
    const last = values[values.length - 1];

    const padded = [];
    for (let i = 0; i < pad; i++) padded.push(first);
    padded.push(...values);
    for (let i = 0; i < pad; i++) padded.push(last);

    const smoothed = [];
    for (let i = 0; i < values.length; i++) {
      const slice = padded.slice(i, i + SMOOTH_WINDOW);
      const avg = slice.reduce((sum, v) => sum + v, 0) / slice.length;
      smoothed.push(parseFloat(avg.toFixed(2)));
    }

    let idx = 0;
    return cleaned.map((v) => (v == null ? null : smoothed[idx++]));
  }

  function clampProb(value) {
    if (value == null || Number.isNaN(value)) return null;
    const normalized = value > 1 ? value / 100 : value;
    return Math.min(MAX_DISPLAY_PROB, Math.max(MIN_DISPLAY_PROB, normalized));
  }

  function toPct(value) {
    if (value == null) return null;
    // percent scale 0..100 with 1 decimal
    return Math.round(value * 1000) / 10;
  }

  function parseNumber(val) {
    if (val == null) return null;
    const num = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
    return Number.isNaN(num) ? null : num;
  }

  function forceNumberOrNull(v) {
    if (v == null) return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return Number.isNaN(n) ? null : n;
  }

  function setLogo(el, name) {
    if (!el) return;
    const key = (name || "").toLowerCase().trim();
    const file = LOGO_MAP[key];
    if (file) {
      el.style.backgroundImage = `url(${logoPath(file)})`;
    } else {
      el.style.backgroundImage = "linear-gradient(135deg, rgba(96,165,250,0.2), rgba(168,85,247,0.2))";
    }
  }

  function logoPath(file) {
    // logos folder beside index.html
    return `logos/${file}`;
  }

  // MVP CSV parsing (robust against header casing)
  function parseMvpCSV(text) {
    const rows = d3.csvParse(text);
    if (!rows || !rows.length) return [];

    const normRow = (row) => {
      const out = {};
      for (const [k, v] of Object.entries(row)) out[String(k).trim().toLowerCase()] = v;
      return out;
    };

    const pick = (r, keys) => {
      for (const k of keys) {
        const v = r[k];
        if (v != null && String(v).trim() !== "") return v;
      }
      return null;
    };

    return rows
      .map((row) => {
        const r = normRow(row);
        const player = String(pick(r, ["player", "name"]) || "").trim();
        const team = String(pick(r, ["team"]) || "").trim();

        return {
          player: player || "Player",
          team: team || "Team",
          winPct: parseNumber(pick(r, ["win_pct", "win%", "win"])) || 0,
          mvpScore: parseNumber(pick(r, ["mvp_score", "score", "mvp"])) || 0,
          impliedWithVig: parseNumber(pick(r, ["implied_with_vig", "implied", "with_vig"])) ?? null,
          impliedNoVig: parseNumber(pick(r, ["no_vig", "implied_no_vig", "without_vig"])) ?? null,
          decimalOdds: String(pick(r, ["decimal", "decimal_odds"]) || "").trim(),
          americanOdds: String(pick(r, ["american", "american_odds"]) || "").trim(),
          pass: parseNumber(pick(r, ["pass"])) ?? null,
          rush: parseNumber(pick(r, ["rush"])) ?? null,
          recv: parseNumber(pick(r, ["recv"])) ?? null,
          def: parseNumber(pick(r, ["def"])) ?? null,
          win: parseNumber(pick(r, ["win_score", "win_component"])) ?? null,
          record: String(pick(r, ["record"]) || "").trim(),
        };
      })
      .filter((r) => r.player);
  }

  function renderMvp(records) {
    if (!els.mvpTableBody) return;

    const sorted = [...records].sort((a, b) => {
      const dir = state.sort.dir === "asc" ? 1 : -1;
      const aVal = a[state.sort.key] ?? 0;
      const bVal = b[state.sort.key] ?? 0;
      if (aVal === bVal) return 0;
      return (aVal > bVal ? 1 : -1) * dir;
    });

    els.mvpTableBody.innerHTML = "";

    if (!sorted.length) {
      if (els.mvpEmpty) els.mvpEmpty.hidden = false;
      return;
    }
    if (els.mvpEmpty) els.mvpEmpty.hidden = true;

    const frag = document.createDocumentFragment();

    sorted.forEach((row, idx) => {
      const tr = document.createElement("tr");
      if (idx < 5) tr.style.boxShadow = "inset 0 1px 0 rgba(96,165,250,0.2)";

      tr.innerHTML = `
        <td>
          <div class="player">
            <div class="player__avatar">${initials(row.player)}</div>
            <div>
              <div>${escapeHtml(row.player)}</div>
              <div class="details">MVP: ${Number(row.mvpScore).toFixed(1)}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="team-chip">
            <span>${escapeHtml(row.team)}</span>
            <span class="record">${escapeHtml(row.record || "")}</span>
          </div>
        </td>
        <td>${formatPct(row.winPct)}</td>
        <td>${Number(row.mvpScore).toFixed(2)}</td>
        <td>
          <div class="details">With Vig: ${formatPct(row.impliedWithVig)}</div>
          <div class="details">No Vig: ${formatPct(row.impliedNoVig)}</div>
        </td>
        <td>${row.decimalOdds || "—"}</td>
        <td>${row.americanOdds || "—"}</td>
        <td><button class="expand-btn" type="button" aria-label="Toggle details">View</button></td>
      `;

      const detail = document.createElement("tr");
      detail.className = "detail-row hidden";
      detail.innerHTML = `
        <td colspan="8">
          <div class="details">
            Pass: ${formatScore(row.pass)} • Rush: ${formatScore(row.rush)} • Recv: ${formatScore(row.recv)} •
            Def: ${formatScore(row.def)} • Win: ${formatScore(row.win)}
          </div>
        </td>
      `;

      tr.querySelector(".expand-btn")?.addEventListener("click", () => {
        detail.classList.toggle("hidden");
      });

      frag.appendChild(tr);
      frag.appendChild(detail);
    });

    els.mvpTableBody.appendChild(frag);
    if (els.mvpStatus) els.mvpStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;

    attachSortHandlersOnce();
  }

  function attachSortHandlersOnce() {
    if (state.sortHandlersAttached) return;
    state.sortHandlersAttached = true;

    document.querySelectorAll("#mvpTable thead th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (!key) return;

        if (state.sort.key === key) {
          state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc";
        } else {
          state.sort.key = key;
          state.sort.dir = "desc";
        }

        // Re-render using last records (don’t refetch just to sort)
        renderMvp(state.lastMvpRecords || []);
      });
    });
  }

  function formatPct(value) {
    if (value == null || Number.isNaN(value)) return "—";
    const normalized = value > 1 ? value : value * 100;
    return `${normalized.toFixed(1)}%`;
  }

  function formatScore(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return Number(value).toFixed(1);
  }

  function initials(name) {
    return String(name)
      .split(" ")
      .filter(Boolean)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setLoading(el, isLoading) {
    if (!el) return;
    el.hidden = !isLoading;
  }

  function toggleError(el, show) {
    if (!el) return;
    el.hidden = !show;
  }

  function buildSampleMatchup() {
    const samples = [];
    const pregame = 0.62;
    let current = pregame * 100;

    for (let i = 12; i >= 0; i--) {
      const drift = (Math.sin((12 - i) / 3) + Math.random() * 0.5 - 0.25) * 3;
      current = Math.min(99, Math.max(1, current + drift));

      samples.push({
        update: `U${12 - i + 1}`,
        minuteLeft: i,
        winProbHome: current / 100,
        winProbAway: 1 - current / 100,
        scoreA: Math.max(0, Math.round((12 - i) / 3)),
        scoreB: Math.max(0, Math.round((12 - i) / 2)),
        possession: (12 - i) % 2 === 0 ? "Home" : "Away",
        quarter: Math.min(4, Math.ceil((12 - i + 1) / 3)),
        down: ((12 - i) % 4) + 1,
        distance: 10,
        ytg: 10,
        pregame,
      });
    }

    return {
      snapshots: samples,
      teamA: "Away",
      teamB: "Home",
      teams: ["Away", "Home"],
      baseline: pregame,
    };
  }

  function buildSampleMvp() {
    return [
      {
        player: "Sample QB",
        team: "Cards",
        winPct: 0.65,
        mvpScore: 89.3,
        impliedWithVig: 0.2,
        impliedNoVig: 0.17,
        decimalOdds: "5.0",
        americanOdds: "+400",
        pass: 24.5,
        rush: 6.4,
        recv: 0,
        def: 1.2,
        win: 12.3,
        record: "10-2",
      },
      {
        player: "Star WR",
        team: "Cowboys",
        winPct: 0.6,
        mvpScore: 82.1,
        impliedWithVig: 0.15,
        impliedNoVig: 0.12,
        decimalOdds: "7.5",
        americanOdds: "+650",
        pass: 0,
        rush: 2.1,
        recv: 20.5,
        def: 0,
        win: 9.4,
        record: "9-3",
      },
    ];
  }

  function overrideUrl(key) {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  }
})();
