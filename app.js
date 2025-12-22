(() => {
  // =======================
  // CONFIG
  // =======================
  const MATCHUP_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxNr3jLVjL4e24TvQR9iSkJP0T_lBiA2Dh5G9iut5_zDksYHEnbsu8k8f5Eo888Aha_UWuZXRhFNV0/pub?gid=0&single=true&output=csv";

  const MVP_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQp0jxVIwA59hH031QxJFBsXdQVIi7fNdPS5Ra2w1lK2UYA08rC0moSSqoKPSFL8BRZFh_hC4cO8ymk/pub?output=xlsx";

  const POLL_MS = 30_000;

  const MIN_DISPLAY_PROB = 0.01;
  const MAX_DISPLAY_PROB = 0.99;

  const SMOOTH_WINDOW = 5;
  const MOMENTUM_THRESHOLD = 0.025;
  const BIG_SWING_THRESHOLD = 0.12;

  // TFL-provided team code mapping -> display name + logo slug
  // NOTE: update or extend as codes evolve.
  const TEAM_CODE_MAP = {
    "0": { name: "Louisville Cardinals", logo: "cards" },
    "1": { name: "Cincinnati Bengals", logo: "bengals" },
    "2": { name: "San Francisco 49ers", logo: "sanfran" },
    "3": { name: "Dallas Cowboys", logo: "cowboys" },
    "4": { name: "New York Giants", logo: "giants" },
    lou: { name: "Louisville Cardinals", logo: "cards" },
    cards: { name: "Louisville Cardinals", logo: "cards" },
    cin: { name: "Cincinnati Bengals", logo: "bengals" },
    bengals: { name: "Cincinnati Bengals", logo: "bengals" },
    dal: { name: "Dallas Cowboys", logo: "cowboys" },
    cowboys: { name: "Dallas Cowboys", logo: "cowboys" },
    ny: { name: "New York Giants", logo: "giants" },
    giants: { name: "New York Giants", logo: "giants" },
    "49ers": { name: "San Francisco 49ers", logo: "sanfran" },
    sanfran: { name: "San Francisco 49ers", logo: "sanfran" },
    "san francisco 49ers": { name: "San Francisco 49ers", logo: "sanfran" },
  };

  const LOGO_MAP = buildLogoMap();

  const STANDINGS_ALIASES = {
    lou: "lou",
    cards: "lou",
    cardinals: "lou",
    "louisville cardinals": "lou",
    cin: "cin",
    bengals: "cin",
    "cincinnati bengals": "cin",
    dal: "dal",
    cowboys: "dal",
    "dallas cowboys": "dal",
    "san francisco 49ers": "49ers",
    "sf 49ers": "49ers",
    "49ers": "49ers",
    sanfran: "49ers",
    ny: "ny",
    giants: "ny",
    "new york giants": "ny",
  };

  const TEAM_COLORS = {
    cards: "#97233F",
    lou: "#97233F",
    "louisville cardinals": "#97233F",
    bengals: "#FB4F14",
    cin: "#FB4F14",
    "cincinnati bengals": "#FB4F14",
    sanfran: "#AA0000",
    "49ers": "#AA0000",
    "san francisco 49ers": "#AA0000",
    cowboys: "#041E42",
    dal: "#041E42",
    "dallas cowboys": "#041E42",
    giants: "#0B2265",
    ny: "#0B2265",
    "new york giants": "#0B2265",
  };

  const MVP_WEIGHTS = { pass: 2.0, rush: 1.0, recv: 1.0, def: 1.0, wins: 2 };

  // =======================
  // STATE / DOM
  // =======================
  const state = {
    chart: null,
    baseline: null,
    matchupLoading: true,
    mvpLoading: true,
    standingsLoading: true,
    sort: { key: "mvpScore", dir: "desc" },
    lastMvpRecords: [],
    lastStandings: [],
    standingsLookup: new Map(),
    lastMatchup: null,
    sortHandlersAttached: false,
    logoExistCache: new Map(), // filename -> boolean
    lastScores: { a: null, b: null },
    deltaTimers: { a: null, b: null },
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    if (typeof d3 === "undefined") {
      console.error("d3 not found. Make sure d3 is loaded before app.js");
      return;
    }
    if (typeof Chart === "undefined") {
      console.error("Chart.js not found. Make sure chart.js is loaded before app.js");
      return;
    }

    cacheEls();
    initTabs();
    initChart();

    // Debug: proves what your deployed JS is using
    console.info("[TFL] MATCHUP_CSV_URL =", MATCHUP_CSV_URL);
    console.info("[TFL] MVP_CSV_URL =", MVP_CSV_URL);

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
    els.teamAPossession = id("teamAPossession");
    els.teamBPossession = id("teamBPossession");

    els.teamARecord = id("teamARecord");
    els.teamBRecord = id("teamBRecord");

    els.teamAScore = id("teamAScore");
    els.teamBScore = id("teamBScore");
    els.teamAScoreDelta = id("teamAScoreDelta");
    els.teamBScoreDelta = id("teamBScoreDelta");

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

    els.standingsLoading = id("standingsLoading");
    els.standingsError = id("standingsError");
    els.standingsBody = id("standingsTableBody");
    els.standingsStatus = id("standingsStatus");
  }

  function initTabs() {
    const navItems = Array.from(document.querySelectorAll(".nav__item"));
    const tabs = {
      win: document.getElementById("tab-win"),
      mvp: document.getElementById("tab-mvp"),
      standings: document.getElementById("tab-standings"),
    };

    function setTab(tab) {
      Object.values(tabs).forEach((el) => el && el.classList.remove("tab--active"));
      navItems.forEach((el) => el.classList.remove("nav__item--active"));
      const key = tabs[tab] ? tab : tab === "mvp" ? "mvp" : "win";
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
      setTab(window.location.hash.replace("#", "") || "win");
    });

    setTab(window.location.hash.replace("#", "") || "win");
  }

  function initChart() {
    const canvas = document.getElementById("winProbChart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    const gradientA = ctx.createLinearGradient(0, 0, 0, 320);
    gradientA.addColorStop(0, "rgba(96,165,250,0.4)");
    gradientA.addColorStop(1, "rgba(96,165,250,0.05)");

    const gradientB = ctx.createLinearGradient(0, 0, 0, 320);
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
            spanGaps: false,
            borderColor: "rgba(96,165,250,1)",
            backgroundColor: gradientA,
            pointRadius: 0,
            borderWidth: 3,
            cubicInterpolationMode: "monotone",
          },
          {
            label: "Team B",
            data: [],
            tension: 0.35,
            fill: true,
            spanGaps: false,
            borderColor: "rgba(168,85,247,1)",
            backgroundColor: gradientB,
            pointRadius: 0,
            borderWidth: 3,
            cubicInterpolationMode: "monotone",
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

  // =======================
  // NETWORK
  // =======================
  async function fetchText(url) {
    const u = new URL(url, window.location.href);
    // cache buster (safe for Google publish links)
    u.searchParams.set("_cb", Date.now().toString());

    const res = await fetch(u.toString(), {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      mode: "cors",
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${u.toString()}`);
    }

    const text = await res.text();

    // Published CSV should NOT be HTML
    if (/<html/i.test(text)) {
      throw new Error(
        `Got HTML instead of CSV for ${u.toString()} (sheet probably not published to web, or access blocked)`
      );
    }

    return text;
  }

  async function fetchArrayBuffer(url) {
    const u = new URL(url, window.location.href);
    u.searchParams.set("_cb", Date.now().toString());
    const res = await fetch(u.toString(), { method: "GET", cache: "no-store", redirect: "follow" });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${u.toString()}`);
    return res.arrayBuffer();
  }

  async function fetchMatchup() {
    setLoading(els.winLoading, true);
    toggleError(els.winError, false);

    const url = overrideUrl("matchup") || MATCHUP_CSV_URL;

    try {
      const text = await fetchText(url);
      const parsed = parseMatchupCSV(text);
      if (!parsed.snapshots.length) throw new Error("No matchup rows parsed");
      state.lastMatchup = parsed;
      renderMatchup(parsed);
      setLoading(els.winLoading, false);
    } catch (err) {
      console.error("[matchup]", err);
      showError(els.winError, `Matchup feed error: ${err.message}`);
      state.lastMatchup = buildSampleMatchup();
      renderMatchup(state.lastMatchup); // keep app alive
      setLoading(els.winLoading, false);
    }
  }

  async function fetchMvp() {
    setLoading(els.mvpLoading, true);
    toggleError(els.mvpError, false);
    setLoading(els.standingsLoading, true);
    toggleError(els.standingsError, false);

    const url = overrideUrl("mvp") || MVP_CSV_URL;

    try {
      const buffer = await fetchArrayBuffer(url);
      const { mvpRecords, standings } = parseMvpWorkbook(buffer);
      state.lastMvpRecords = mvpRecords;
      state.lastStandings = standings;
      state.standingsLookup = buildStandingsLookup(standings);
      renderMvp(mvpRecords);
      renderStandings(standings);
      if (state.lastMatchup) renderMatchup({ ...state.lastMatchup });
      setLoading(els.mvpLoading, false);
      setLoading(els.standingsLoading, false);
    } catch (err) {
      console.error("[mvp]", err);
      showError(els.mvpError, `MVP feed error: ${err.message}`);
      state.lastMvpRecords = buildSampleMvp();
      state.lastStandings = buildSampleStandings();
      state.standingsLookup = buildStandingsLookup(state.lastStandings);
      renderMvp(state.lastMvpRecords);
      renderStandings(state.lastStandings);
      if (state.lastMatchup) renderMatchup({ ...state.lastMatchup });
      setLoading(els.mvpLoading, false);
      setLoading(els.standingsLoading, false);
    }
  }

  // =======================
  // PARSING
  // =======================
  function parseMatchupCSV(text) {
    const rows = d3.csvParse(text);
    if (!rows || !rows.length) {
      return { snapshots: [], teamA: "Team A", teamB: "Team B", teams: [], baseline: null };
    }

    const columns = rows.columns || Object.keys(rows[0] || {});

    const norm = (obj) => {
      const out = {};
      for (const [k, v] of Object.entries(obj)) out[String(k).trim().toLowerCase()] = v;
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

    const [teamAKey, teamBKey] = pickTeamHeaders(columns);
    const teamAName = resolveTeam(teamAKey).displayName;
    const teamBName = resolveTeam(teamBKey).displayName;

    const snapshotRows = rows.slice(1);
    if (!snapshotRows.length) snapshotRows.push(rows[0]);

    let rollingScoreA = 0;
    let rollingScoreB = 0;

    const snapshots = snapshotRows.map((row, i) => {
      const r = norm(row);

      const update = String(pick(r, ["update #", "update"]) || `U${i + 1}`).trim();
      const minuteLeft = parseMinutesLeft(pick(r, ["minutes left", "minutes_left", "ml"]));

      // YOUR SHEET: Team A Win Probability is the primary one
      const probA = parseProb(pick(r, ["team a win probability", "away win probability", "team a win prob"]));
      const probB = probA != null ? clampProb(1 - probA) : null;

      const rawScoreA =
        parseNumber(pick(r, ["team a score", "team a point", "team a points"])) ??
        parseNumber(row[teamAKey]);
      const rawScoreB =
        parseNumber(pick(r, ["team b score", "team b point", "team b points"])) ??
        parseNumber(row[teamBKey]);
      if (rawScoreA != null) rollingScoreA = rawScoreA;
      if (rawScoreB != null) rollingScoreB = rawScoreB;
      const scoreA = rollingScoreA;
      const scoreB = rollingScoreB;

      const hasBall = parseNumber(pick(r, ["team a has ball (1=yes, 0=no)", "team a has ball"]));
      const possession = hasBall == null ? "" : hasBall === 1 ? teamAName : teamBName;

      const quarter = String(pick(r, ["quarter", "qtr"]) || "").trim();
      const down = String(pick(r, ["down"]) || "").trim();
      const distance = String(pick(r, ["distance", "dist"]) || "").trim();
      const ytg = String(pick(r, ["yards to goal", "ytg"]) || "").trim();

      const pregame = parseProb(pick(r, ["pregame", "baseline", "pregame win prob"])) ?? null;

      return {
        update,
        minuteLeft,
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

    const baseline =
      snapshots.find((s) => s.pregame != null)?.pregame ?? snapshots[0]?.winProbHome ?? null;
    const teams = Array.from(new Set([teamAName, teamBName].filter(Boolean)));

    return { snapshots, teams, baseline, teamA: teamAName, teamB: teamBName };
  }

  function parseMvpWorkbook(buffer) {
    if (typeof XLSX === "undefined") throw new Error("XLSX library not loaded");
    const workbook = XLSX.read(buffer, { type: "array" });
    const standings = parseStandingsSheet(workbook);
    const roster = parseRosterSheet(workbook);
    const passing = parsePassingSheet(workbook);
    const rushing = parseRushingSheet(workbook);
    const receiving = parseReceivingSheet(workbook);
    const defense = parseDefenseSheet(workbook);

    const players = new Map();
    const ensure = (name) => {
      if (!players.has(name)) players.set(name, { player: name });
      return players.get(name);
    };

    passing.forEach((p) => {
      const rec = ensure(p.player);
      Object.assign(rec, {
        team: rec.team || roster.get(p.player) || p.team,
        passRating: p.passRating,
        compPct: p.compPct,
        yards: p.yards,
        passTd: p.passTd,
        interceptions: p.interceptions,
        completions: p.completions,
        attempts: p.attempts,
      });
    });

    rushing.forEach((r) => {
      const rec = ensure(r.player);
      Object.assign(rec, {
        team: rec.team || roster.get(r.player) || r.team,
        rushYards: r.rushYards,
        rushTd: r.rushTd,
        returnTd: r.returnTd,
        totalTd: r.totalTd,
      });
    });

    receiving.forEach((r) => {
      const rec = ensure(r.player);
      Object.assign(rec, {
        team: rec.team || roster.get(r.player) || r.team,
        recvYards: r.recvYards,
        recvTd: r.recvTd,
        catches: r.catches,
        targets: r.targets,
      });
    });

    defense.forEach((d) => {
      const rec = ensure(d.player);
      Object.assign(rec, {
        team: rec.team || roster.get(d.player) || d.team,
        tackles: d.tackles,
        defInt: d.interceptions,
        sacks: d.sacks,
        defTd: d.defTd,
      });
    });

    const standingsMap = buildStandingsLookup(standings);

    const records = Array.from(players.values())
      .map((rec) => {
        const standing = lookupStanding(standingsMap, rec.team || roster.get(rec.player));
        const wins = standing?.wins ?? 0;
        const winPct = standing?.winPct ?? null;

        const { score: mvpScore, defScore } = computeMvpScore(rec, wins);

        return {
          ...rec,
          team: roster.get(rec.player) || rec.team || "Team",
          winPct,
          wins,
          defScore,
          mvpScore,
        };
      })
      .filter((r) => r.player);

    return {
      mvpRecords: records,
      standings,
      roster,
    };
  }

  function parsePassingSheet(workbook) {
    const sheetName =
      workbook.SheetNames.find((n) => n.toLowerCase().includes("passing")) || workbook.SheetNames[0];
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", range: 2 });
    return rows
      .map((row) => ({
        player: String(row.Player || row.player || "").trim(),
        team: String(row.Team || row.team || "").trim() || String(row["Team "] || "").trim(),
        passRating: parseNumber(row["Passer Rating"]),
        compPct: parseNumber(row["Comp%"]),
        yards: parseNumber(row.Yards),
        passTd: parseNumber(row["Pass TD"]),
        interceptions: parseNumber(row.INT),
        completions: parseNumber(row.Completions),
        attempts: parseNumber(row.Attempts),
      }))
      .filter((r) => r.player);
  }

  function parseRushingSheet(workbook) {
    const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().includes("rushing"));
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", range: 2 });
    return rows
      .map((row) => ({
        player: String(row.Player || row.player || "").trim(),
        team: String(row.Team || row.team || "").trim() || String(row["Team "] || "").trim(),
        rushYards: parseNumber(row["Rushing Yards"]),
        rushTd: parseNumber(row["Rushing TD"]),
        returnTd: parseNumber(row["Return TD"]),
        totalTd: parseNumber(row["Total TD"]),
      }))
      .filter((r) => r.player);
  }

  function parseReceivingSheet(workbook) {
    const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().includes("receiving"));
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", range: 2 });
    return rows
      .map((row) => ({
        player: String(row.Player || row.player || "").trim(),
        team: String(row.Team || row.team || "").trim() || String(row["Team "] || "").trim(),
        catches: parseNumber(row.Catches),
        targets: parseNumber(row.Targets),
        recvYards: parseNumber(row.Yards),
        recvTd: parseNumber(row["Rec TD"]),
      }))
      .filter((r) => r.player);
  }

  function parseDefenseSheet(workbook) {
    const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().includes("defense"));
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", range: 2 });
    return rows
      .map((row) => ({
        player: String(row.Player || row.player || "").trim(),
        team: String(row.Team || row.team || "").trim() || String(row["Team "] || "").trim(),
        tackles: parseNumber(row.Tackles),
        interceptions: parseNumber(row.INT),
        sacks: parseNumber(row.Sacks),
        defTd: parseNumber(row["Def TD"]),
      }))
      .filter((r) => r.player);
  }

  function computeMvpScore(rec, wins) {
    const defScore =
      (rec.tackles || 0) + (rec.defInt || 0) * 5 + (rec.sacks || 0) * 4 + (rec.defTd || 0) * 20;
    const score =
      (rec.passRating || 0) * MVP_WEIGHTS.pass +
      (rec.rushYards || 0) * MVP_WEIGHTS.rush +
      (rec.recvYards || 0) * MVP_WEIGHTS.recv +
      defScore * MVP_WEIGHTS.def +
      (wins || 0) * MVP_WEIGHTS.wins;

    return { score, defScore };
  }

  function parseRosterSheet(workbook) {
    const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().includes("roster"));
    const map = new Map();
    if (!sheetName) return map;
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "", range: 2 });
    rows.forEach((row) => {
      const player = String(row.Player || row.player || "").trim();
      const team = String(row.Team || row.team || "").trim();
      if (player && team) map.set(player, team);
    });
    return map;
  }

  function parseStandingsSheet(workbook) {
    const sheetName =
      workbook.SheetNames.find((n) => n.toLowerCase().includes("standing")) || workbook.SheetNames[0];
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: "",
      range: 2, // skip top padding rows
    });
    if (!rows.length) return [];

    return rows
      .map((row) => ({
        team: String(row.Team || row.team || "").trim(),
        games: parseNumber(row.G) ?? null,
        wins: parseNumber(row.W) ?? null,
        draws: parseNumber(row.D) ?? null,
        losses: parseNumber(row.L) ?? null,
        plusMinus: parseNumber(row["+/-"]) ?? null,
        points: parseNumber(row.P) ?? null,
        winPct: parseNumber(row["Win%"]) ?? null,
      }))
      .filter((r) => r.team);
  }

  // =======================
  // RENDERING
  // =======================
  function renderMatchup({ snapshots, teams, baseline, teamA, teamB }) {
    if (!snapshots.length) return;

    const maxMinute = Math.max(...snapshots.map((s) => s.minuteLeft ?? 0));
    const labels = snapshots.map((s) =>
      formatElapsed(Math.max(0, maxMinute - (s.minuteLeft ?? maxMinute)))
    );

    const home = smoothSeries(snapshots.map((s) => toPct(s.winProbHome)));
    const away = smoothSeries(snapshots.map((s) => toPct(s.winProbAway)));

    const teamAInfo = resolveTeam(teamA);
    const teamBInfo = resolveTeam(teamB);

    const pregameBaseline = baseline;
    const liveBaseline = computeLiveBaseline(home);
    state.baseline = liveBaseline != null ? liveBaseline / 100 : null;

    if (els.baselineValue) {
      const delta = pregameBaseline != null && liveBaseline != null ? liveBaseline - pregameBaseline * 100 : null;
      const deltaText = delta != null && Math.abs(delta) >= 0.05 ? ` (${formatDelta(delta)})` : "";
      els.baselineValue.textContent =
        liveBaseline != null ? `Game avg: ${liveBaseline.toFixed(1)}%${deltaText}` : "—";
    }
    if (els.pregameTag)
      els.pregameTag.textContent =
        pregameBaseline != null ? `Pregame: ${(pregameBaseline * 100).toFixed(1)}%` : "Pregame: —";

    updateChart(labels, home, away, teamAInfo, teamBInfo);

    const latest = snapshots[snapshots.length - 1];

    const isFinal = latest.minuteLeft != null && latest.minuteLeft <= 0;
    if (els.gameStatus) {
      els.gameStatus.textContent = isFinal ? "Final" : "Live";
      els.gameStatus.classList.toggle("badge--ghost", isFinal);
    }

    if (els.teamAName) els.teamAName.textContent = teamAInfo.displayName;
    if (els.teamBName) els.teamBName.textContent = teamBInfo.displayName;

    const teamARecord = findTeamRecord(teamAInfo.displayName, teamA);
    const teamBRecord = findTeamRecord(teamBInfo.displayName, teamB);
    if (els.teamARecord) els.teamARecord.textContent = teamARecord ? formatRecord(teamARecord) : "Record —";
    if (els.teamBRecord) els.teamBRecord.textContent = teamBRecord ? formatRecord(teamBRecord) : "Record —";

    updateScore(els.teamAScore, els.teamAScoreDelta, latest.scoreA, state.lastScores.a, "a");
    updateScore(els.teamBScore, els.teamBScoreDelta, latest.scoreB, state.lastScores.b, "b");
    state.lastScores = { a: latest.scoreA ?? 0, b: latest.scoreB ?? 0 };

    if (els.possession)
      els.possession.textContent = latest.possession
        ? `Possession: ${resolveTeam(latest.possession).displayName}`
        : "Possession —";
    if (els.quarter) els.quarter.textContent = latest.quarter ? `Q${latest.quarter}` : "Q-";
    if (els.clock) els.clock.textContent = latest.minuteLeft != null ? `${formatClock(latest.minuteLeft)} ML` : "ML —";

    if (els.downDistance) els.downDistance.textContent = latest.down ? `Down: ${latest.down}` : "Down —";
    if (els.ytg) els.ytg.textContent = latest.ytg || latest.distance ? `${latest.ytg || latest.distance} YTG` : "YTG —";
    updatePossessionIndicators(teamAInfo, teamBInfo, latest.possession);

    const resolvedTeamList = (teams || []).map((t) => resolveTeam(t).displayName);

    if (els.teamListChip)
      els.teamListChip.textContent = resolvedTeamList.length
        ? `Teams: ${resolvedTeamList.join(", ")}`
        : "Teams: —";
    if (els.lastUpdate) els.lastUpdate.textContent = `Last update: ${latest.update}`;

    setLogo(els.teamALogo, teamAInfo.logoKey);
    setLogo(els.teamBLogo, teamBInfo.logoKey);

    const metrics = analyzeGame(home, snapshots);
    if (els.momentumValue) els.momentumValue.textContent = metrics.momentum;
    if (els.swingValue) els.swingValue.textContent = metrics.bigSwing;
    if (els.clutchValue) els.clutchValue.textContent = metrics.clutch;

    renderPills(metrics, pregameBaseline, liveBaseline);

    toggleError(els.winError, false);
    setLoading(els.winLoading, false);
  }

  function updateChart(labels, home, away, teamA, teamB) {
    if (!state.chart) return;

    state.chart.data.labels = labels;
    state.chart.data.datasets[0].label = teamA.displayName;
    state.chart.data.datasets[1].label = teamB.displayName;

    // Force numeric/null only -> prevents Chart weirdness
    state.chart.data.datasets[0].data = away.map(forceNumberOrNull);
    state.chart.data.datasets[1].data = home.map(forceNumberOrNull);

    applyTeamColors(teamA, teamB);

    state.chart.update("none");
  }

  function renderMvp(records) {
    if (!els.mvpTableBody) return;

    const sorted = [...records].sort((a, b) => {
      const dir = state.sort.dir === "asc" ? 1 : -1;
      const av = a[state.sort.key] ?? 0;
      const bv = b[state.sort.key] ?? 0;
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * dir;
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

      const record = findTeamRecord(row.team);
      const recordText = record ? formatRecord(record) : "";
      const tdInt =
        row.passTd != null || row.interceptions != null
          ? `${row.passTd ?? 0} / ${row.interceptions ?? 0}`
          : "—";
      const passRating = row.passRating != null ? formatScore(row.passRating) : "—";

      tr.innerHTML = `
        <td>
          <div class="player">
            <div class="player__avatar">${initials(row.player)}</div>
            <div>
              <div>${escapeHtml(row.player)}</div>
              <div class="details">MVP Score: ${formatScore(row.mvpScore)}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="team-chip">
            <span>${escapeHtml(row.team)}</span>
            <span class="record">${escapeHtml(recordText)}</span>
          </div>
        </td>
        <td>${formatPct(row.winPct)}</td>
        <td>${formatScore(row.mvpScore)}</td>
        <td>${passRating}</td>
        <td>${row.yards != null ? Number(row.yards).toLocaleString() : "—"}</td>
        <td>${tdInt}</td>
        <td><button class="expand-btn" type="button">View</button></td>
      `;

      const detail = document.createElement("tr");
      detail.className = "detail-row hidden";
      detail.innerHTML = `
        <td colspan="8">
          <div class="details">
            Pass Rating: ${passRating} • Comp%: ${row.compPct != null ? formatPct(row.compPct) : "—"} •
            Completions/Attempts: ${formatScore(row.completions)} / ${formatScore(row.attempts)} •
            Rush Yds: ${formatScore(row.rushYards)} • Rec Yds: ${formatScore(row.recvYards)} • Def Score: ${formatScore(row.defScore)} •
            Wins: ${formatScore(row.wins)} • Weighting: Pass×${MVP_WEIGHTS.pass}, Rush×${MVP_WEIGHTS.rush}, Recv×${MVP_WEIGHTS.recv}, Def×${MVP_WEIGHTS.def}, Wins×${MVP_WEIGHTS.wins}
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
    toggleError(els.mvpError, false);
  }

  function renderStandings(rows) {
    if (!els.standingsBody) return;

    els.standingsBody.innerHTML = "";
    if (!rows.length) {
      toggleError(els.standingsError, true);
      return;
    }
    toggleError(els.standingsError, false);

    const frag = document.createDocumentFragment();
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const teamInfo = resolveTeam(row.team);

      const teamCell = document.createElement("td");
      const teamWrapper = document.createElement("div");
      teamWrapper.className = "standings-team";

      const logo = document.createElement("div");
      logo.className = "standings-team__logo";
      setLogo(logo, teamInfo.logoKey);

      const name = document.createElement("div");
      name.className = "standings-team__name";
      name.textContent = teamInfo.displayName;

      teamWrapper.appendChild(logo);
      teamWrapper.appendChild(name);
      teamCell.appendChild(teamWrapper);
      tr.appendChild(teamCell);

      const cells = [
        row.games ?? "—",
        row.wins ?? "—",
        row.draws ?? "—",
        row.losses ?? "—",
        row.plusMinus ?? "—",
        row.points ?? "—",
        row.winPct != null ? formatPct(row.winPct) : "—",
      ];

      cells.forEach((val) => {
        const td = document.createElement("td");
        td.textContent = val;
        tr.appendChild(td);
      });

      frag.appendChild(tr);
    });
    els.standingsBody.appendChild(frag);
    if (els.standingsStatus) els.standingsStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
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
        renderMvp(state.lastMvpRecords || []);
      });
    });
  }

  // =======================
  // METRICS
  // =======================
  function analyzeGame(homeSeries, snapshots) {
    const filtered = homeSeries.filter((v) => v != null && !Number.isNaN(v));
    const recent = filtered.slice(-3);
    const delta = recent.length >= 2 ? recent[recent.length - 1] - recent[0] : 0;

    const momentum =
      Math.abs(delta) >= MOMENTUM_THRESHOLD * 100 ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts` : "Stable";

    const bigSwing = computeBigSwing(filtered);
    const clutch = computeClutch(filtered, snapshots);

    return { momentum, bigSwing, clutch };
  }

  function computeBigSwing(series) {
    const cleaned = series.filter((v) => v != null && !Number.isNaN(v));
    if (cleaned.length < 2) return "—";

    let swing = 0;
    for (let i = 1; i < cleaned.length; i++) {
      swing = Math.max(swing, Math.abs(cleaned[i] - cleaned[i - 1]));
    }

    const rangeSwing = Math.max(...cleaned) - Math.min(...cleaned);
    const displaySwing = Math.max(swing, rangeSwing);

    return displaySwing > 0 ? `${displaySwing.toFixed(1)} pts` : "—";
  }

  function computeClutch(series, snapshots) {
    if (!series.length || !snapshots?.length) return "—";
    const last = series[series.length - 1];
    const lastSnap = snapshots[snapshots.length - 1];
    if (last == null || !lastSnap) return "—";

    const minutesLeft = lastSnap.minuteLeft;
    if (minutesLeft == null) return "—";

    const isTight = last >= 30 && last <= 70;
    if (minutesLeft <= 5 && isTight) return `Clutch (${formatClock(minutesLeft)} left)`;
    if (minutesLeft <= 5) return `Edge (${formatClock(minutesLeft)} left)`;

    return `${formatClock(minutesLeft)} left`;
  }

  function renderPills(metrics, pregameBaseline, liveBaseline) {
    if (!els.pillRow) return;
    els.pillRow.innerHTML = "";

    const pills = [];
    if (liveBaseline != null) {
      const delta = pregameBaseline != null ? liveBaseline - pregameBaseline * 100 : null;
      pills.push({
        label: "Baseline",
        value:
          delta != null && Math.abs(delta) >= 0.05
            ? `${liveBaseline.toFixed(1)}% (${formatDelta(delta)})`
            : `${liveBaseline.toFixed(1)}%`,
        tone: delta != null && delta < 0 ? "warning" : "accent",
      });
    }
    if (metrics.momentum !== "Stable") pills.push({ label: "Momentum", value: metrics.momentum, tone: "accent" });
    if (metrics.bigSwing !== "—") pills.push({ label: "Big swing", value: metrics.bigSwing, tone: "warning" });
    if (metrics.clutch && metrics.clutch !== "—")
      pills.push({ label: "Clutch window", value: metrics.clutch, tone: "danger" });

    if (!pills.length) pills.push({ label: "Calm", value: "No major swings", tone: "ghost" });

    pills.forEach((pill) => {
      const div = document.createElement("div");
      div.className = `pill ${pill.tone ? `pill--${pill.tone}` : ""}`.trim();
      div.textContent = `${pill.label}: ${pill.value}`;
      els.pillRow.appendChild(div);
    });
  }

  // =======================
  // HELPERS
  // =======================
  function computeLiveBaseline(series) {
    const cleaned = series.filter((v) => v != null && !Number.isNaN(v));
    if (!cleaned.length) return null;
    const avg = cleaned.reduce((sum, v) => sum + v, 0) / cleaned.length;
    return parseFloat(avg.toFixed(1));
  }

  function formatDelta(value) {
    if (value == null || Number.isNaN(value)) return "";
    const rounded = value.toFixed(1);
    return `${value >= 0 ? "+" : ""}${rounded}%`;
  }

  function buildLogoMap() {
    const map = {};
    Object.entries(TEAM_CODE_MAP).forEach(([code, info]) => {
      if (!info?.logo) return;
      const file = `${info.logo}.png`;
      map[code.toLowerCase()] = file;
      map[normalizeTeamKey(info.name)] = file;
      map[info.logo.toLowerCase()] = file;
    });
    return map;
  }

  function formatElapsed(minutes) {
    if (minutes == null || Number.isNaN(minutes)) return "0:00";
    const totalSeconds = Math.max(0, Math.round(minutes * 60));
    const mins = Math.floor(totalSeconds / 60);
    const secs = String(totalSeconds % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function smoothSeries(series) {
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

  function canonicalTeamKey(raw) {
    const cleaned = String(raw ?? "").trim();
    if (!cleaned) return null;

    // Numeric codes sometimes come through as floats (e.g., "4.0")
    const asNumber = Number(cleaned);
    if (!Number.isNaN(asNumber)) {
      const intKey = String(Math.trunc(asNumber));
      if (TEAM_CODE_MAP[intKey]) return intKey;
    }

    const norm = normalizeTeamKey(cleaned);
    if (TEAM_CODE_MAP[cleaned]) return cleaned;
    if (TEAM_CODE_MAP[norm]) return norm;
    if (STANDINGS_ALIASES[norm]) return STANDINGS_ALIASES[norm];
    return null;
  }

  function normalizeTeamKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase();
  }

  function resolveTeam(raw) {
    const cleaned = String(raw ?? "").trim();
    if (!cleaned) return { displayName: "Team", logoKey: "", canonicalKey: "" };

    const canonical = canonicalTeamKey(cleaned);
    const codeMatch = canonical ? TEAM_CODE_MAP[canonical] : null;
    const displayName = codeMatch?.name || cleaned;
    const logoKey = codeMatch?.logo || (canonical || normalizeTeamKey(displayName));

    return { displayName, logoKey, canonicalKey: canonical || normalizeTeamKey(displayName) };
  }

  function formatClock(minutesLeft) {
    if (minutesLeft == null || Number.isNaN(minutesLeft)) return "0:00";
    const totalSeconds = Math.max(0, Math.round(minutesLeft * 60));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function pickTeamHeaders(columns) {
    const found = findTeamColumns(columns);
    const fallbackA = columns.find((c) => /team\s*a/i.test(c));
    const fallbackB = columns.find((c) => /team\s*b/i.test(c));
    return [
      found[0] || fallbackA || columns[2] || columns[0] || "Team A",
      found[1] || fallbackB || columns[3] || columns[1] || "Team B",
    ];
  }

  function findTeamColumns(columns) {
    const seen = new Set();
    const matches = [];
    columns
      .map((col) => ({ col, key: canonicalTeamKey(col) }))
      .filter((entry) => entry.key)
      .forEach((entry) => {
        if (seen.has(entry.key)) return;
        matches.push(entry.col);
        seen.add(entry.key);
      });
    return matches;
  }

  function toPct(value) {
    if (value == null) return null;
    return Math.round(value * 1000) / 10; // 1 decimal
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

  function formatPct(value) {
    if (value == null || Number.isNaN(value)) return "—";
    const normalized = value > 1 ? value : value * 100;
    return `${normalized.toFixed(1)}%`;
  }

  function formatScore(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return Number(value).toFixed(1);
  }

  function formatRecord(row) {
    if (!row) return "Record —";
    const w = row.wins ?? "—";
    const l = row.losses ?? "—";
    const d = row.draws;
    const pct =
      row.winPct != null && row.winPct !== ""
        ? ` (${(row.winPct * 100).toFixed(1)}%)`
        : "";
    const parts = [w, l];
    if (d != null) parts.push(d);
    return `${parts.join("-")}${pct}`;
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

  function buildStandingsLookup(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const key = normalizeTeamKey(row.team);
      if (!key) return;
      map.set(key, row);
    });
    return map;
  }

  function lookupStanding(map, raw) {
    const norm = normalizeTeamKey(raw);
    if (!norm) return null;
    if (map.has(norm)) return map.get(norm);
    const alias = STANDINGS_ALIASES[norm];
    if (alias && map.has(alias)) return map.get(alias);
    return null;
  }

  function standingsKey(raw) {
    const norm = normalizeTeamKey(raw);
    if (!norm) return null;
    if (state.standingsLookup.has(norm)) return norm;
    const alias = STANDINGS_ALIASES[norm];
    if (alias && state.standingsLookup.has(alias)) return alias;
    return null;
  }

  function teamColor(key) {
    const norm = normalizeTeamKey(key);
    return TEAM_COLORS[norm] || "#60a5fa";
  }

  function teamColorKey(team) {
    return team.logoKey || team.canonicalKey || team.displayName;
  }

  function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const bigint = parseInt(clean.length === 3 ? clean.repeat(2) : clean, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  function applyTeamColors(teamA, teamB) {
    if (!state.chart) return;
    const [dsA, dsB] = state.chart.data.datasets;
    const colorA = teamColor(teamColorKey(teamA));
    const colorB = teamColor(teamColorKey(teamB));

    dsA.borderColor = colorA;
    dsA.backgroundColor = hexToRgba(colorA, 0.25);
    dsB.borderColor = colorB;
    dsB.backgroundColor = hexToRgba(colorB, 0.25);
  }

  function updateScore(el, deltaEl, nextValue, previousValue, key) {
    if (!el) return;
    const safeNext = Number.isFinite(Number(nextValue)) ? Number(nextValue) : 0;
    const safePrev = Number.isFinite(Number(previousValue)) ? Number(previousValue) : null;

    if (safePrev != null && safeNext < safePrev) {
      clearTimeout(state.deltaTimers[key]);
      deltaEl?.classList.remove("score__delta--show");
      el.textContent = String(safeNext);
      return;
    }

    if (safePrev != null && safeNext > safePrev) {
      triggerScoreDelta(deltaEl, safeNext - safePrev, key);
      animateScore(el);
    }

    el.textContent = String(safeNext);
  }

  function triggerScoreDelta(el, diff, key) {
    if (!el) return;
    el.textContent = `+${diff}`;
    el.classList.add("score__delta--show");
    clearTimeout(state.deltaTimers[key]);
    state.deltaTimers[key] = setTimeout(() => {
      el.classList.remove("score__delta--show");
    }, 2600);
  }

  function animateScore(el) {
    el.classList.remove("score__value--bump");
    // Force reflow
    // eslint-disable-next-line no-unused-expressions
    el.offsetWidth;
    el.classList.add("score__value--bump");
  }

  function findTeamRecord(...candidates) {
    for (const raw of candidates) {
      const key = standingsKey(raw);
      if (key) return state.standingsLookup.get(key);
    }
    return null;
  }

  function setLoading(el, isLoading) {
    if (!el) return;
    el.hidden = !isLoading;
  }

  function toggleError(el, show) {
    if (!el) return;
    el.hidden = !show;
  }

  function showError(el, msg) {
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
  }

  function logoPath(file) {
    // On GitHub Pages, this resolves relative to repo path correctly
    return `logos/${file}`;
  }

  async function logoExists(file) {
    // Same-origin check (works on GitHub Pages); avoids spamming broken image 404s
    if (state.logoExistCache.has(file)) return state.logoExistCache.get(file);

    const url = logoPath(file);
    const ok = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = `${url}?cb=${Date.now()}`;
    });

    state.logoExistCache.set(file, ok);
    return ok;
  }

  function variants(file) {
    // Try common casing variations
    const base = file;
    const lower = file.toLowerCase();
    const upperFirst =
      file.length > 0 ? file[0].toUpperCase() + file.slice(1) : file;

    // Also try TitleCase for names like sanfran.png -> Sanfran.png
    const titleish = lower.replace(/(^|\/)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());

    return Array.from(new Set([base, lower, upperFirst, titleish]));
  }

  async function setLogo(el, logoKey) {
    if (!el) return;
    const key = (logoKey || "").toLowerCase().trim();
    const mapped = LOGO_MAP[key];

    if (!mapped) {
      el.style.backgroundImage =
        "linear-gradient(135deg, rgba(96,165,250,0.2), rgba(168,85,247,0.2))";
      return;
    }

    for (const candidate of variants(mapped)) {
      // eslint-disable-next-line no-await-in-loop
      if (await logoExists(candidate)) {
        el.style.backgroundImage = `url(${logoPath(candidate)})`;
        return;
      }
    }

    el.style.backgroundImage =
      "linear-gradient(135deg, rgba(96,165,250,0.2), rgba(168,85,247,0.2))";
  }

  function updatePossessionIndicators(teamA, teamB, possessionRaw) {
    const aContainer = els.teamAPossession?.closest(".team");
    const bContainer = els.teamBPossession?.closest(".team");
    const possessionKey = canonicalTeamKey(possessionRaw) || normalizeTeamKey(possessionRaw);
    const teamAKey =
      canonicalTeamKey(teamA.canonicalKey || teamA.logoKey || teamA.displayName) ||
      normalizeTeamKey(teamA.displayName);
    const teamBKey =
      canonicalTeamKey(teamB.canonicalKey || teamB.logoKey || teamB.displayName) ||
      normalizeTeamKey(teamB.displayName);

    const teamAHasBall = !!(possessionKey && teamAKey && possessionKey === teamAKey);
    const teamBHasBall = !!(possessionKey && teamBKey && possessionKey === teamBKey);

    els.teamAPossession && (els.teamAPossession.style.opacity = teamAHasBall ? "1" : "");
    els.teamBPossession && (els.teamBPossession.style.opacity = teamBHasBall ? "1" : "");

    aContainer?.classList.toggle("team--has-ball", teamAHasBall);
    bContainer?.classList.toggle("team--has-ball", teamBHasBall);
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
        winProbHome: (100 - current) / 100,
        winProbAway: current / 100,
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
        team: "LOU",
        winPct: 0.65,
        mvpScore: 89.3,
        passRating: 104.2,
        completions: 91,
        attempts: 140,
        passTd: 18,
        interceptions: 6,
        yards: 2400,
        compPct: 0.65,
        rushYards: 320,
        recvYards: 0,
        defScore: 12,
        wins: 5,
      },
      {
        player: "Star WR",
        team: "DAL",
        winPct: 0.6,
        mvpScore: 82.1,
        passRating: 98.1,
        completions: 74,
        attempts: 96,
        passTd: 17,
        interceptions: 2,
        yards: 1419,
        compPct: 0.77,
        rushYards: 80,
        recvYards: 1100,
        defScore: 6,
        wins: 4,
      },
    ];
  }

  function buildSampleStandings() {
    return [
      { team: "LOU", games: 8, wins: 5, draws: 1, losses: 2, plusMinus: 105, points: 16, winPct: 0.69 },
      { team: "CIN", games: 7, wins: 5, draws: 0, losses: 2, plusMinus: 92, points: 15, winPct: 0.71 },
      { team: "49ERS", games: 7, wins: 4, draws: 1, losses: 2, plusMinus: -16, points: 13, winPct: 0.64 },
      { team: "DAL", games: 8, wins: 4, draws: 0, losses: 4, plusMinus: -88, points: 12, winPct: 0.5 },
      { team: "NY", games: 8, wins: 0, draws: 0, losses: 8, plusMinus: -93, points: 0, winPct: 0 },
    ];
  }

  function overrideUrl(key) {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  }
})();
