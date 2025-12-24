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
    "1": { name: "Dallas Cowboys", logo: "cowboys" },
    "2": { name: "Washington Commanders", logo: "commanders" },
    "3": { name: "Buffalo Bills", logo: "bills" },
    "4": { name: "Baltimore Ravens", logo: "ravens" },
    "5": { name: "New England Patriots", logo: "patriots" },
    lou: { name: "Louisville Cardinals", logo: "cards" },
    cards: { name: "Louisville Cardinals", logo: "cards" },
    was: { name: "Washington Commanders", logo: "commanders" },
    commanders: { name: "Washington Commanders", logo: "commanders" },
    dal: { name: "Dallas Cowboys", logo: "cowboys" },
    cowboys: { name: "Dallas Cowboys", logo: "cowboys" },
    ne: { name: "New England Patriots", logo: "patriots" },
    patriots: { name: "New England Patriots", logo: "patriots" },
    bal: { name: "Baltimore Ravens", logo: "ravens" },
    ravens: { name: "Baltimore Ravens", logo: "ravens" },
    buf: { name: "Buffalo Bills", logo: "bills" },
    bills: { name: "Buffalo Bills", logo: "bills" },
  };

  const LOGO_MAP = buildLogoMap();

  const STANDINGS_ALIASES = {
    lou: "lou",
    cards: "lou",
    cardinals: "lou",
    "louisville cardinals": "lou",
    was: "was",
    commanders: "was",
    "washington commanders": "was",
    dal: "dal",
    cowboys: "dal",
    "dallas cowboys": "dal",
    ne: "ne",
    patriots: "ny",
    "new england patriots": "ny",
    buf: "buf",
    bills: "buf",
    "buffalo bills": "buf",
    bal: "bal",
    ravens: "bal",
    "baltimore ravens": "bal",
  };

  const TEAM_COLORS = {
    cards: "#97233F",
    lou: "#97233F",
    "louisville cardinals": "#97233F",
    cowboys: "#041E42",
    dal: "#041E42",
    "dallas cowboys": "#041E42",
    ravens: "#5A1414",
    balt: "#5A1414",
    "baltimore ravens": "#5A1414",
    patriots: "#B0B7BC",
    ne: "#B0B7BC",
    "new england patriots": "#B0B7BC",
    bills: "#c70b30",
    buf: "#c70b30",
    "buffalo bills": "#c70b30",
    commanders: "#FFB612",
    was: "#FFB612",
    "washington commanders": "#FFB612",
  };

  const MVP_WEIGHTS = { pass: 2.0, rush: 1.0, recv: 1.0, def: 1.0, wins: 2 };

  // Bracket copy for latest semi results
  const SEMI_RESULTS = {
    semi1: {
      winnerTeam: "lou",
      loserTeam: "dal",
      score: "58-45",
    },
    semi2: {
      winnerTeam: "cin",
      loserTeam: "49ers",
      score: "45-21",
    },
  };

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
    newsRecords: [],
    rosterMap: new Map(),
    playersByTeam: new Map(),
    standingsLookup: new Map(),
    lastMatchup: null,
    lastMatchupFreshness: null,
    lastIsFinal: null,
    hasShownConfetti: false,
    matchupVersion: 0,
    matchupRequestInFlight: 0,
    sortHandlersAttached: false,
    logoExistCache: new Map(), // filename -> boolean
    lastScores: { a: null, b: null },
    deltaTimers: { a: null, b: null },
    matchupAbortController: null,
    mvpAbortController: null,
    mvpVersion: 0,
    lastMatchupFetchedAt: null,
    lastMatchupAcceptedAt: null,
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
    initDetailOverlay();
    initPlayerOverlay();

    // Debug: proves what your deployed JS is using
    console.info("[TFL] MATCHUP_CSV_URL =", MATCHUP_CSV_URL);
    console.info("[TFL] MVP_CSV_URL =", MVP_CSV_URL);

    startPolling();
  });

  function startPolling() {
    const refresh = () => {
      fetchMatchup();
      fetchMvp();
    };

    refresh();
    setInterval(refresh, POLL_MS);

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refresh();
    });
  }

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

    els.tickerQuarter = id("tickerQuarter");
    els.tickerClock = id("tickerClock");
    els.tickerDown = id("tickerDown");
    els.tickerYtg = id("tickerYtg");
    els.tickerPossession = id("tickerPossession");
    els.tickerBall = id("tickerBall");
    els.lastUpdate = id("lastUpdate");

    els.momentumValue = id("momentumValue");
    els.swingValue = id("swingValue");
    els.clutchValue = id("clutchValue");
    els.baselineValue = id("baselineValue");

    els.liveStatsGrid = id("liveStatsGrid");
    els.liveStatsEmpty = id("liveStatsEmpty");

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

    els.breakdownGrid = id("breakdownGrid");

    els.newsFeed = id("newsFeed");
    els.newsLoading = id("newsLoading");
    els.newsError = id("newsError");
    els.newsEmpty = id("newsEmpty");
    els.newsStatus = id("newsStatus");

    els.bracketDiagram = id("bracketDiagram");
    els.bracketStatus = id("bracketStatus");
    els.bracketLoading = id("bracketLoading");
    els.bracketError = id("bracketError");

    els.detailOverlay = id("detailOverlay");
    els.detailClose = id("detailClose");
    els.detailTitle = id("detailTitle");
    els.detailSubtitle = id("detailSubtitle");
    els.detailRecord = id("detailRecord");
    els.teamSummary = id("teamSummary");
    els.teamPlayers = id("teamPlayers");
    els.playerDetail = id("playerDetail");

    els.playerOverlay = id("playerOverlay");
    els.playerOverlayClose = id("playerOverlayClose");
    els.playerOverlayContent = id("playerOverlayContent");
  }

  function initTabs() {
    const navItems = Array.from(document.querySelectorAll(".nav__item"));
    const tabs = {
      win: document.getElementById("tab-win"),
      mvp: document.getElementById("tab-mvp"),
      standings: document.getElementById("tab-standings"),
      news: document.getElementById("tab-news"),
      bracket: document.getElementById("tab-bracket"),
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
        animation: {
          duration: 800,
          easing: "easeOutQuart",
        },
        maintainAspectRatio: false,
        transitions: {
          active: {
            animation: {
              duration: 700,
              easing: "easeOutCubic",
            },
          },
        },
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

  function initDetailOverlay() {
    const closeOverlay = () => {
      if (els.detailOverlay) els.detailOverlay.hidden = true;
    };
    els.detailClose?.addEventListener("click", closeOverlay);
    els.detailOverlay?.addEventListener("click", (e) => {
      if (e.target === els.detailOverlay || e.target.classList.contains("overlay__backdrop")) closeOverlay();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeOverlay();
    });
  }

  function initPlayerOverlay() {
    const closeOverlay = () => {
      if (els.playerOverlay) els.playerOverlay.hidden = true;
    };

    els.playerOverlayClose?.addEventListener("click", closeOverlay);
    els.playerOverlay?.addEventListener("click", (e) => {
      if (e.target === els.playerOverlay || e.target.classList.contains("overlay__backdrop")) closeOverlay();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.playerOverlay && !els.playerOverlay.hidden) closeOverlay();
    });
  }

  // =======================
  // NETWORK
  // =======================
  async function fetchText(url, signal) {
    const u = new URL(url, window.location.href);
    // cache buster (safe for Google publish links)
    u.searchParams.set("_cb", Date.now().toString());

    const res = await fetch(u.toString(), {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      mode: "cors",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      signal,
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

  async function fetchArrayBuffer(url, signal) {
    const u = new URL(url, window.location.href);
    u.searchParams.set("_cb", Date.now().toString());
    const res = await fetch(u.toString(), {
      method: "GET",
      cache: "no-store",
      redirect: "follow",
      headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${u.toString()}`);
    return res.arrayBuffer();
  }

  async function fetchMatchup() {
    setLoading(els.winLoading, true);
    toggleError(els.winError, false);
    const requestId = Date.now();
    state.matchupRequestInFlight = requestId;
    if (state.matchupAbortController) state.matchupAbortController.abort();
    const controller = new AbortController();
    state.matchupAbortController = controller;

    const url = overrideUrl("matchup") || MATCHUP_CSV_URL;

    try {
      const text = await fetchText(url, controller.signal);
      state.lastMatchupFetchedAt = Date.now();
      const parsed = parseMatchupCSV(text);
      if (!parsed.snapshots.length) throw new Error("No matchup rows parsed");
      if (requestId < state.matchupVersion) return;
      const latestSnapshot = parsed.snapshots[parsed.snapshots.length - 1];
      const nextFreshness = buildSnapshotFreshness(latestSnapshot, parsed.snapshots.length);
      state.matchupVersion = requestId;
      if (state.lastMatchupFreshness && nextFreshness && !isFreshSnapshot(nextFreshness, state.lastMatchupFreshness)) {
        console.warn("[matchup] Ignoring stale sheet data");
        setLoading(els.winLoading, false);
        return;
      }
      if (state.matchupAbortController === controller) state.matchupAbortController = null;
      state.lastMatchupFreshness = nextFreshness || state.lastMatchupFreshness;
      state.lastMatchup = parsed;
      state.lastMatchupAcceptedAt = Date.now();
      renderMatchup(parsed);
      setLoading(els.winLoading, false);
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error("[matchup]", err);
      showError(els.winError, `Matchup feed error: ${err.message}`);
      if (requestId >= state.matchupVersion) {
        state.matchupVersion = requestId;
        state.lastMatchupFetchedAt = Date.now();
        state.lastMatchupAcceptedAt = Date.now();
        state.lastMatchup = buildSampleMatchup();
        renderMatchup(state.lastMatchup); // keep app alive
      }
      if (state.matchupAbortController === controller) state.matchupAbortController = null;
      setLoading(els.winLoading, false);
    }
  }

  async function fetchMvp() {
    setLoading(els.mvpLoading, true);
    toggleError(els.mvpError, false);
    setLoading(els.standingsLoading, true);
    toggleError(els.standingsError, false);
    setLoading(els.newsLoading, true);
    toggleError(els.newsError, false);
    setLoading(els.bracketLoading, true);
    toggleError(els.bracketError, false);
    const requestId = Date.now();
    if (state.mvpAbortController) state.mvpAbortController.abort();
    const controller = new AbortController();
    state.mvpAbortController = controller;

    const url = overrideUrl("mvp") || MVP_CSV_URL;

    try {
      const buffer = await fetchArrayBuffer(url, controller.signal);
      if (requestId < state.mvpVersion) return;
      const { mvpRecords, standings, news, roster } = parseMvpWorkbook(buffer);
      state.mvpVersion = requestId;
      if (state.mvpAbortController === controller) state.mvpAbortController = null;
      state.lastMvpRecords = mvpRecords;
      state.lastStandings = standings;
      state.rosterMap = roster;
      state.playersByTeam = buildPlayersByTeam(mvpRecords);
      state.standingsLookup = buildStandingsLookup(standings);
      renderMvp(mvpRecords);
      renderStandings(standings);
      renderBracket(standings);
      state.newsRecords = news;
      renderNews(news);
      if (state.lastMatchup) renderMatchup({ ...state.lastMatchup });
      setLoading(els.mvpLoading, false);
      setLoading(els.standingsLoading, false);
      setLoading(els.newsLoading, false);
      setLoading(els.bracketLoading, false);
    } catch (err) {
      if (err?.name === "AbortError") return;
      console.error("[mvp]", err);
      if (requestId >= state.mvpVersion) {
        state.mvpVersion = requestId;
        if (state.mvpAbortController === controller) state.mvpAbortController = null;
        showError(els.mvpError, `MVP feed error: ${err.message}`);
        state.lastMvpRecords = buildSampleMvp();
        state.lastStandings = buildSampleStandings();
        state.rosterMap = new Map();
        state.playersByTeam = buildPlayersByTeam(state.lastMvpRecords);
        state.standingsLookup = buildStandingsLookup(state.lastStandings);
        renderMvp(state.lastMvpRecords);
        renderStandings(state.lastStandings);
        renderBracket(state.lastStandings);
        state.newsRecords = buildSampleNews();
        renderNews(state.newsRecords);
        if (state.lastMatchup) renderMatchup({ ...state.lastMatchup });
        setLoading(els.mvpLoading, false);
        setLoading(els.standingsLoading, false);
        setLoading(els.newsLoading, false);
        setLoading(els.bracketLoading, false);
        showError(els.newsError, `News feed error: ${err.message}`);
        showError(els.bracketError, `Bracket error: ${err.message}`);
      }
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

    const parseTimeToMinutes = (val) => {
      if (val == null) return null;
      const str = String(val).trim();
      const colon = str.match(/^(\d+):(\d{2})$/);
      if (colon) return Number(colon[1]) + Number(colon[2]) / 60;
      const num = parseNumber(str);
      return Number.isFinite(num) ? num : null;
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
    let rollingStats = {};

    const parseTeamStats = (row, prev = {}) => {
      const withFallback = (val, key) => (val != null ? val : prev[key] ?? null);
      const parseConversion = (made, att, combined) => {
        if (combined != null && combined !== "") return String(combined);
        if (made == null && att == null) return null;
        if (att == null) return `${made ?? 0}`;
        return `${made ?? 0}/${att}`;
      };

      const totalYardsA = withFallback(
        parseNumber(pick(row, ["team a total yards", "team a yards", "total yards a", "yards a"])),
        "totalYardsA"
      );
      const totalYardsB = withFallback(
        parseNumber(pick(row, ["team b total yards", "team b yards", "total yards b", "yards b"])),
        "totalYardsB"
      );
      const firstDownsA = withFallback(parseNumber(pick(row, ["team a first downs", "first downs a"])), "firstDownsA");
      const firstDownsB = withFallback(parseNumber(pick(row, ["team b first downs", "first downs b"])), "firstDownsB");

      const thirdMadeA = parseNumber(pick(row, ["team a 3rd made", "team a third made", "team a 3rd conversions"]));
      const thirdAttA = parseNumber(pick(row, ["team a 3rd att", "team a third att", "team a 3rd attempts"]));
      const thirdMadeB = parseNumber(pick(row, ["team b 3rd made", "team b third made", "team b 3rd conversions"]));
      const thirdAttB = parseNumber(pick(row, ["team b 3rd att", "team b third att", "team b 3rd attempts"]));

      const fourthMadeA = parseNumber(pick(row, ["team a 4th made", "team a fourth made", "team a 4th conversions"]));
      const fourthAttA = parseNumber(pick(row, ["team a 4th att", "team a fourth att", "team a 4th attempts"]));
      const fourthMadeB = parseNumber(pick(row, ["team b 4th made", "team b fourth made", "team b 4th conversions"]));
      const fourthAttB = parseNumber(pick(row, ["team b 4th att", "team b fourth att", "team b 4th attempts"]));

      const turnoversA = withFallback(parseNumber(pick(row, ["team a turnovers", "turnovers a", "giveaways a"])), "turnoversA");
      const turnoversB = withFallback(parseNumber(pick(row, ["team b turnovers", "turnovers b", "giveaways b"])), "turnoversB");

      const penaltiesA = withFallback(parseNumber(pick(row, ["penalties a", "team a penalties"])), "penaltiesA");
      const penaltiesB = withFallback(parseNumber(pick(row, ["penalties b", "team b penalties"])), "penaltiesB");

      const topA = withFallback(parseTimeToMinutes(pick(row, ["time of possession a", "top a"])), "topA");
      const topB = withFallback(parseTimeToMinutes(pick(row, ["time of possession b", "top b"])), "topB");

      const yardsPerPlayA = withFallback(parseNumber(pick(row, ["yards per play a", "team a ypp"])), "yardsPerPlayA");
      const yardsPerPlayB = withFallback(parseNumber(pick(row, ["yards per play b", "team b ypp"])), "yardsPerPlayB");

      const redZoneA = withFallback(pick(row, ["team a redzone", "red zone a", "rza"]), "redZoneA");
      const redZoneB = withFallback(pick(row, ["team b redzone", "red zone b", "rzb"]), "redZoneB");

      return {
        totalYardsA,
        totalYardsB,
        firstDownsA,
        firstDownsB,
        thirdMadeA: withFallback(thirdMadeA, "thirdMadeA"),
        thirdAttA: withFallback(thirdAttA, "thirdAttA"),
        thirdMadeB: withFallback(thirdMadeB, "thirdMadeB"),
        thirdAttB: withFallback(thirdAttB, "thirdAttB"),
        fourthMadeA: withFallback(fourthMadeA, "fourthMadeA"),
        fourthAttA: withFallback(fourthAttA, "fourthAttA"),
        fourthMadeB: withFallback(fourthMadeB, "fourthMadeB"),
        fourthAttB: withFallback(fourthAttB, "fourthAttB"),
        turnoversA,
        turnoversB,
        penaltiesA,
        penaltiesB,
        topA,
        topB,
        yardsPerPlayA,
        yardsPerPlayB,
        redZoneA,
        redZoneB,
        thirdConvA: withFallback(parseConversion(thirdMadeA, thirdAttA, pick(row, ["team a 3rd conv", "team a third conv"])), "thirdConvA"),
        thirdConvB: withFallback(parseConversion(thirdMadeB, thirdAttB, pick(row, ["team b 3rd conv", "team b third conv"])), "thirdConvB"),
        fourthConvA: withFallback(parseConversion(fourthMadeA, fourthAttA, pick(row, ["team a 4th conv", "team a fourth conv"])), "fourthConvA"),
        fourthConvB: withFallback(parseConversion(fourthMadeB, fourthAttB, pick(row, ["team b 4th conv", "team b fourth conv"])), "fourthConvB"),
      };
    };

    let latestStats = null;

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
      const teamStats = parseTeamStats(r, rollingStats);
      rollingStats = teamStats;
      latestStats = teamStats;

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
        teamStats,
        updateIndex: parseNumber(update) ?? i + 1,
      };
    });

    snapshots.sort((a, b) => {
      const aIdx = a.updateIndex ?? 0;
      const bIdx = b.updateIndex ?? 0;
      if (aIdx === bIdx) {
        const aMin = a.minuteLeft ?? 0;
        const bMin = b.minuteLeft ?? 0;
        return aMin - bMin;
      }
      return aIdx - bIdx;
    });

    const baseline =
      snapshots.find((s) => s.pregame != null)?.pregame ?? snapshots[0]?.winProbHome ?? null;
    const teams = Array.from(new Set([teamAName, teamBName].filter(Boolean)));

    return { snapshots, teams, baseline, teamA: teamAName, teamB: teamBName, latestStats };
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
    const news = parseNewsSheet(workbook);

  const players = new Map();
  const ensure = (name) => {
    if (!players.has(name)) players.set(name, { player: name });
    return players.get(name);
  };

  passing.forEach((p) => {
    const rec = ensure(p.player);
    Object.assign(rec, {
      team: rec.team || roster.get(p.player)?.team || p.team,
      image: rec.image || roster.get(p.player)?.image || null,
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
      team: rec.team || roster.get(r.player)?.team || r.team,
      image: rec.image || roster.get(r.player)?.image || null,
      rushYards: r.rushYards,
      rushTd: r.rushTd,
      returnTd: r.returnTd,
      totalTd: r.totalTd,
    });
    });

  receiving.forEach((r) => {
    const rec = ensure(r.player);
    Object.assign(rec, {
      team: rec.team || roster.get(r.player)?.team || r.team,
      image: rec.image || roster.get(r.player)?.image || null,
      recvYards: r.recvYards,
      recvTd: r.recvTd,
      catches: r.catches,
      targets: r.targets,
    });
    });

    defense.forEach((d) => {
      const rec = ensure(d.player);
      Object.assign(rec, {
        team: rec.team || roster.get(d.player)?.team || d.team,
        image: rec.image || roster.get(d.player)?.image || null,
      tackles: d.tackles,
      defInt: d.interceptions,
      sacks: d.sacks,
      defTd: d.defTd,
    });
    });

    roster.forEach((info, name) => {
      const rec = ensure(name);
      rec.team = rec.team || info.team;
      rec.image = rec.image || info.image || null;
    });

    const standingsMap = buildStandingsLookup(standings);

  const records = Array.from(players.values())
    .map((rec) => {
      const standing = lookupStanding(standingsMap, rec.team || roster.get(rec.player)?.team);
      const wins = standing?.wins ?? 0;
      const winPct = standing?.winPct ?? null;

        const { score: mvpScore, defScore } = computeMvpScore(rec, wins);

        return {
          ...rec,
          team: roster.get(rec.player)?.team || rec.team || "Team",
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
      news,
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

  function parseNewsSheet(workbook) {
    const sheetNames = workbook.SheetNames || [];
    const lastSheetName = sheetNames[sheetNames.length - 1];
    const lastSheetIsNews = lastSheetName && looksLikeNewsSheet(workbook.Sheets[lastSheetName]);
    const preferredSheet =
      (lastSheetIsNews && lastSheetName) ||
      sheetNames.find((n) => n.toLowerCase().includes("news")) ||
      lastSheetName;

    if (!preferredSheet) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[preferredSheet], { defval: "" });
    return rows
      .map((row, idx) => {
        const rawDate = row.Date || row.date || row.DATE || row.Timestamp || row.timestamp;
        const dateValue = parseDateValue(rawDate);
        return {
          id: idx,
          date: dateValue?.formatted ?? String(rawDate || "").trim(),
          dateValue: dateValue?.value ?? null,
          headline: String(row.Headline || row.headline || "").trim(),
          body: String(row.News || row.news || row.Story || "").trim(),
          author: String(row.Author || row.author || "").trim(),
          verified: ["true", "yes"].includes(String(row["Verified Writer"] || row.verified || "").toLowerCase()),
          likes: parseNumber(row.Likes),
          views: parseNumber(row.Views || row["Views..."]),
          image: String(row["image route (if applicable)"] || row.image || row.photo || "").trim(),
        };
      })
      .filter((r) => r.headline || r.body);
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
    const imageKeys = [
      "Image",
      "image",
      "Image URL",
      "Image Link",
      "Image link",
      "Photo",
      "photo",
      "player image",
    ];
    rows.forEach((row) => {
      const player = String(row.Player || row.player || "").trim();
      const team = String(row.Team || row.team || "").trim();
      const image = imageKeys
        .map((key) => row[key])
        .find((val) => val != null && String(val).trim() !== "");
      const imageUrl = String(image || "").trim();
      if (player && team) map.set(player, { team, image: imageUrl || null });
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
  function renderMatchup({ snapshots, teams, baseline, teamA, teamB, latestStats }) {
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
    const previousFinal = state.lastIsFinal;
    if (!isFinal) state.hasShownConfetti = false;
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

    const possessionTeam = latest.possession ? resolveTeam(latest.possession) : null;
    if (els.tickerPossession)
      els.tickerPossession.textContent = possessionTeam ? possessionTeam.displayName : "—";
    if (els.tickerBall) els.tickerBall.classList.toggle("ticker__ball--active", Boolean(possessionTeam));

    if (els.tickerQuarter) els.tickerQuarter.textContent = latest.quarter ? `Q${latest.quarter}` : "Q-";
    if (els.tickerClock) els.tickerClock.textContent = latest.minuteLeft != null ? `${formatClock(latest.minuteLeft)}` : "--:--";

    const downLabel = formatDownTicker(latest.down, latest.distance);
    if (els.tickerDown) els.tickerDown.textContent = downLabel;
    const ytgText = latest.ytg || latest.distance;
    if (els.tickerYtg) els.tickerYtg.textContent = ytgText ? `YTG ${ytgText}` : "YTG —";
    updatePossessionIndicators(teamAInfo, teamBInfo, latest.possession);

    const resolvedTeamList = (teams || []).map((t) => resolveTeam(t).displayName);

    if (els.lastUpdate) {
      const parts = [`Last update: ${latest.update}`];
      if (state.lastMatchupFetchedAt) parts.push(`Fetched at ${formatLocalTime(state.lastMatchupFetchedAt)}`);
      const dataAgeMs = state.lastMatchupAcceptedAt ? Date.now() - state.lastMatchupAcceptedAt : null;
      if (dataAgeMs != null) {
        parts.push(`Data age: ${formatDurationShort(dataAgeMs)}`);
        if (dataAgeMs > 2 * 60 * 1000) parts.push("Data may be delayed");
      }
      els.lastUpdate.textContent = parts.join(" • ");
    }

    setLogo(els.teamALogo, teamAInfo.logoKey);
    setLogo(els.teamBLogo, teamBInfo.logoKey);

    const winner =
      isFinal && latest.scoreA != null && latest.scoreB != null && latest.scoreA !== latest.scoreB
        ? latest.scoreA > latest.scoreB
          ? "A"
          : "B"
        : null;
    applyOutcomeStyles(winner);
    if (previousFinal === false && isFinal && winner) {
      const winnerTeam = winner === "A" ? teamAInfo : teamBInfo;
      launchConfetti(teamColor(teamColorKey(winnerTeam)));
    }
    if (previousFinal === null) state.lastIsFinal = isFinal;
    state.lastIsFinal = isFinal;

    const metrics = analyzeGame(home, snapshots);
    if (els.momentumValue) els.momentumValue.textContent = metrics.momentum;
    if (els.swingValue) els.swingValue.textContent = metrics.bigSwing;
    if (els.clutchValue) els.clutchValue.textContent = metrics.clutch;

    renderPills(metrics, pregameBaseline, liveBaseline);
    renderLiveStats(latestStats, teamAInfo, teamBInfo);
    const derivedStats = deriveMatchupStats(snapshots, teamAInfo, teamBInfo);
    renderBreakdown(derivedStats, teamAInfo, teamBInfo);

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

    state.chart.update();
  }

  function buildPlayerStatLines(player) {
    const passParts = [];
    const rating = formatScore(player.passRating);
    if (rating !== "—") appendIfValue(passParts, `PR ${rating}`);
    const compPct = formatPct(player.compPct);
    if (compPct !== "—") appendIfValue(passParts, compPct);
    const passYards = formatCount(player.yards);
    if (passYards !== "—") appendIfValue(passParts, `${passYards} yds`);
    if (player.passTd != null || player.interceptions != null)
      appendIfValue(passParts, `${player.passTd ?? 0}/${player.interceptions ?? 0} TD/INT`);
    if (player.completions != null || player.attempts != null)
      appendIfValue(passParts, `${formatCount(player.completions)} / ${formatCount(player.attempts)} C/A`);

    const rushParts = [];
    const rushYds = formatCount(player.rushYards);
    if (rushYds !== "—") appendIfValue(rushParts, `${rushYds} yds`);
    const rushTd = formatCount(player.rushTd);
    if (rushTd !== "—") appendIfValue(rushParts, `${rushTd} TD`);
    const returnTd = formatCount(player.returnTd);
    if (returnTd !== "—") appendIfValue(rushParts, `${returnTd} RET TD`);
    const totalTd = formatCount(player.totalTd);
    if (totalTd !== "—") appendIfValue(rushParts, `${totalTd} Total TD`);

    const recvParts = [];
    const recvYds = formatCount(player.recvYards);
    if (recvYds !== "—") appendIfValue(recvParts, `${recvYds} yds`);
    const recvTd = formatCount(player.recvTd);
    if (recvTd !== "—") appendIfValue(recvParts, `${recvTd} TD`);
    if (player.catches != null || player.targets != null)
      appendIfValue(recvParts, `${formatCount(player.catches)} / ${formatCount(player.targets)} C/T`);

    const defParts = [];
    const tackles = formatCount(player.tackles);
    if (tackles !== "—") appendIfValue(defParts, `${tackles} TAK`);
    const sacks = formatCount(player.sacks);
    if (sacks !== "—") appendIfValue(defParts, `${sacks} SCK`);
    const defInt = formatCount(player.defInt);
    if (defInt !== "—") appendIfValue(defParts, `${defInt} INT`);
    const defTd = formatCount(player.defTd);
    if (defTd !== "—") appendIfValue(defParts, `${defTd} TD`);

    const totals = [];
    const winPct = formatPct(player.winPct);
    if (winPct !== "—") appendIfValue(totals, `Win% ${winPct}`);
    const wins = formatCount(player.wins);
    if (wins !== "—") appendIfValue(totals, `${wins} Wins`);

    return [
      { label: "Pass", value: joinStatParts(passParts) },
      { label: "Rush", value: joinStatParts(rushParts) },
      { label: "Rec", value: joinStatParts(recvParts) },
      { label: "Def", value: joinStatParts(defParts) },
      ...(totals.length ? [{ label: "Totals", value: joinStatParts(totals) }] : []),
    ].filter((line) => line.value && line.value !== "—");
  }

  function buildPlayerMetrics(player) {
    return [
      { label: "Pass rating", value: formatScore(player.passRating) },
      { label: "Comp%", value: formatPct(player.compPct) },
      { label: "Comp / Att", value: formatCountPair(player.completions, player.attempts) },
      { label: "Pass yards", value: formatCount(player.yards) },
      {
        label: "TD / INT",
        value:
          player.passTd != null || player.interceptions != null
            ? `${formatCount(player.passTd)} / ${formatCount(player.interceptions)}`
            : "—",
      },
      { label: "Rush yds", value: formatCount(player.rushYards) },
      { label: "Rush TD", value: formatCount(player.rushTd) },
      { label: "Return TD", value: formatCount(player.returnTd) },
      { label: "Total TD", value: formatCount(player.totalTd) },
      { label: "Rec yds", value: formatCount(player.recvYards) },
      { label: "Rec TD", value: formatCount(player.recvTd) },
      { label: "Catches / Targets", value: formatCountPair(player.catches, player.targets) },
      { label: "Tackles", value: formatCount(player.tackles) },
      { label: "Sacks", value: formatCount(player.sacks) },
      { label: "Def INT", value: formatCount(player.defInt) },
      { label: "Def TD", value: formatCount(player.defTd) },
      { label: "Def score", value: formatScore(player.defScore) },
      { label: "Wins", value: formatCount(player.wins) },
      { label: "Win%", value: formatPct(player.winPct) },
      { label: "MVP Score", value: formatScore(player.mvpScore) },
    ];
  }

  function appendIfValue(list, value) {
    if (value == null) return;
    const str = String(value);
    if (str === "—" || str.trim() === "") return;
    list.push(str);
  }

  function joinStatParts(parts) {
    const clean = parts.filter(Boolean);
    return clean.length ? clean.join(" • ") : "—";
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
          ? `${row.passTd ?? 0}/${row.interceptions ?? 0}`
          : "—";
      const passRating = row.passRating != null ? formatScore(row.passRating) : "—";
      const statLines = buildPlayerStatLines(row);
      const statLinesHtml = (statLines.length ? statLines : [{ label: "Stats", value: "—" }])
        .map(
          (line) => `
              <div class="stat-line">
                <span class="stat-line__label">${line.label}</span>
                <span class="stat-line__value">${line.value}</span>
              </div>`
        )
        .join("");

      tr.innerHTML = `
        <td>
          <div class="player">
            ${playerAvatar(row)}
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
        <td>
          <div class="stat-lines">
            ${statLinesHtml}
          </div>
        </td>
        <td><button class="expand-btn" type="button">View</button></td>
      `;

      const openDetail = () => openPlayerOverlay(row);
      tr.querySelector(".expand-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openDetail();
      });
      tr.tabIndex = 0;
      tr.addEventListener("click", openDetail);
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openDetail();
        }
      });

      frag.appendChild(tr);
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
      const teamKey = canonicalTeamKey(teamInfo.canonicalKey || teamInfo.displayName) || normalizeTeamKey(teamInfo.displayName);

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

      tr.classList.add("standings-row");
      tr.tabIndex = 0;
      tr.addEventListener("click", () => openTeamDetail(row, teamInfo, teamKey));
      tr.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openTeamDetail(row, teamInfo, teamKey);
        }
      });

      frag.appendChild(tr);
    });
    els.standingsBody.appendChild(frag);
    if (els.standingsStatus) els.standingsStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
  }

  function openTeamDetail(row, teamInfo, teamKey) {
    if (!els.detailOverlay) return;
    const standing = row || lookupStanding(state.standingsLookup, teamKey);
    const normalizedKey = teamKey || canonicalTeamKey(teamInfo?.canonicalKey) || normalizeTeamKey(teamInfo?.displayName);
    const players = state.playersByTeam.get(normalizedKey) || [];

    renderTeamSummary(teamInfo, standing);
    renderTeamPlayers(players, teamInfo, standing);
    if (players.length) renderPlayerDetail(players[0], teamInfo, standing);
    else if (els.playerDetail) els.playerDetail.innerHTML = `<div class="state state--empty">No players recorded for ${teamInfo.displayName} yet.</div>`;

    if (els.detailOverlay) els.detailOverlay.hidden = false;
  }

  function renderTeamSummary(teamInfo, standing) {
    if (!els.teamSummary) return;
    const recordText = standing ? formatRecord(standing) : "Record —";
    const streak = standing?.points != null ? `${standing.points} pts` : "Points —";
    const diff = standing?.plusMinus != null ? `+/- ${standing.plusMinus}` : "Margin —";

    const crest = document.createElement("div");
    crest.className = "team-summary__crest";
    setLogo(crest, teamInfo.logoKey);

    const name = document.createElement("div");
    name.className = "team-summary__name";
    name.textContent = teamInfo.displayName;

    const meta = document.createElement("div");
    meta.className = "team-summary__meta";
    meta.innerHTML = `
      <span>${recordText}</span>
      <span>${streak}</span>
      <span>${diff}</span>
      <span>${standing?.winPct != null ? formatPct(standing.winPct) : "Win% —"}</span>
    `;

    els.detailTitle && (els.detailTitle.textContent = `${teamInfo.displayName} breakdown`);
    els.detailSubtitle && (els.detailSubtitle.textContent = "Roster, record, and player momentum");
    els.detailRecord && (els.detailRecord.textContent = recordText);

    const card = document.createElement("div");
    card.className = "team-summary__card";
    card.appendChild(crest);
    card.appendChild(name);
    card.appendChild(meta);
    els.teamSummary.innerHTML = "";
    els.teamSummary.appendChild(card);
  }

  function renderTeamPlayers(players, teamInfo, standing) {
    if (!els.teamPlayers) return;
    els.teamPlayers.innerHTML = "";

    if (!players.length) {
      els.teamPlayers.innerHTML = `<div class="state state--empty">No rostered players yet.</div>`;
      return;
    }

    players.forEach((player) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "player-chip";
      const statSummary = buildPlayerStatLines(player)
        .map((line) => `${line.label}: ${line.value}`)
        .join(" • ");
      card.innerHTML = `
        ${playerAvatar(player)}
        <div class="player-chip__body">
          <div class="player-chip__name">${escapeHtml(player.player)}</div>
          <div class="player-chip__meta">${statSummary || "No stat line yet"}</div>
          <div class="player-chip__meta">MVP: ${formatScore(player.mvpScore)} • Win%: ${formatPct(player.winPct)}</div>
        </div>
      `;

      card.addEventListener("click", () => renderPlayerDetail(player, teamInfo, standing));
      els.teamPlayers.appendChild(card);
    });
  }

  function renderPlayerDetail(player, teamInfo, standing) {
    if (!els.playerDetail) return;
    const metrics = buildPlayerMetrics(player);

    const card = document.createElement("div");
    card.className = "player-detail-card";
    card.innerHTML = `
      <div class="player-detail-card__header">
        ${playerAvatar(player)}
        <div>
          <div class="player-detail-card__name">${escapeHtml(player.player)}</div>
          <div class="player-detail-card__sub">${teamInfo.displayName} • ${standing ? formatRecord(standing) : "Record —"}</div>
        </div>
        <div class="badge">${formatScore(player.mvpScore)} MVP</div>
      </div>
      <div class="player-detail-card__stats">
        ${metrics
          .map(
            (m) => `
          <div class="player-detail-card__stat">
            <div class="player-detail-card__stat-label">${m.label}</div>
            <div class="player-detail-card__stat-value">${m.value}</div>
          </div>`
          )
          .join("")}
      </div>
    `;
    els.playerDetail.innerHTML = "";
    els.playerDetail.appendChild(card);
  }

  function openPlayerOverlay(player) {
    if (!els.playerOverlay || !els.playerOverlayContent) return;
    const teamInfo = resolveTeam(player.team);
    const standing = findTeamRecord(teamInfo.displayName, player.team);

    const metrics = buildPlayerMetrics(player);

    const modal = document.createElement("div");
    modal.className = "player-modal";
    modal.innerHTML = `
      <div class="player-modal__header">
        ${playerAvatar(player)}
        <div>
          <div class="player-modal__title" id="playerOverlayTitle">${escapeHtml(player.player)}</div>
          <div class="player-modal__subtitle">
            <span>${escapeHtml(teamInfo.displayName)}</span>
            <span>${standing ? escapeHtml(formatRecord(standing)) : "Record —"}</span>
            <span>Win%: ${formatPct(player.winPct)}</span>
          </div>
        </div>
        <div class="player-modal__badge">${formatScore(player.mvpScore)} MVP</div>
      </div>
      <div class="player-modal__grid">
        ${metrics
          .map(
            (m) => `
          <div class="player-modal__stat">
            <div class="player-modal__stat-label">${m.label}</div>
            <div class="player-modal__stat-value">${m.value}</div>
          </div>`
          )
          .join("")}
      </div>
    `;

    els.playerOverlayContent.innerHTML = "";
    els.playerOverlayContent.appendChild(modal);
    els.playerOverlay.hidden = false;
  }

  function renderBracket(rows) {
    if (!els.bracketDiagram) return;
    els.bracketDiagram.innerHTML = "";

    if (!rows || !rows.length) {
      toggleError(els.bracketError, true);
      return;
    }

    const seeds = buildSeeds(rows);
    const [seed1, seed2, seed3, seed4, seed5] = seeds;

    const configuredSemiOneWinner = seedByTeam(seeds, SEMI_RESULTS.semi1.winnerTeam);
    const configuredSemiOneLoser = seedByTeam(seeds, SEMI_RESULTS.semi1.loserTeam);
    const configuredSemiTwoWinner = seedByTeam(seeds, SEMI_RESULTS.semi2.winnerTeam);
    const configuredSemiTwoLoser = seedByTeam(seeds, SEMI_RESULTS.semi2.loserTeam);

    const semiOneWinner = configuredSemiOneWinner || seed1;
    const semiOneLoser = configuredSemiOneLoser || seed4;
    const semiTwoWinner = configuredSemiTwoWinner || seed2;
    const semiTwoLoser = configuredSemiTwoLoser || seed3;

    const hasSemiOneResult = Boolean(configuredSemiOneWinner && configuredSemiOneLoser);
    const hasSemiTwoResult = Boolean(configuredSemiTwoWinner && configuredSemiTwoLoser);

    const semiOneScore = hasSemiOneResult ? SEMI_RESULTS.semi1.score : null;
    const semiTwoScore = hasSemiTwoResult ? SEMI_RESULTS.semi2.score : null;

    const semiOneResult = formatSemiResult(semiOneWinner, semiOneLoser, semiOneScore);
    const semiTwoResult = formatSemiResult(semiTwoWinner, semiTwoLoser, semiTwoScore);

    const bracketGrid = document.createElement("div");
    bracketGrid.className = "bracket__grid";

    const semiOne = buildSemiCard({
      title: "Semifinal #1",
      slot: "left",
      topSeed: semiOneWinner,
      lowerSeed: semiOneLoser,
      winnerSeed: hasSemiOneResult ? semiOneWinner : null,
      score: semiOneScore,
      description: semiOneResult || "Waiting for Louisville vs Dallas to populate",
    });

    const final = buildFinalCard({
      title: "Tate Super Bowl",
      leftSeed: hasSemiOneResult ? semiOneWinner : seed1,
      rightSeed: hasSemiTwoResult ? semiTwoWinner : null,
      awaitingLabelRight: seed2 && seed3 ? "Winner of Semifinal #2" : "Awaiting #2/#3 winner",
      semiOneResult,
      semiTwoResult,
    });

    const semiTwo = buildSemiCard({
      title: "Semifinal #2",
      slot: "right",
      topSeed: semiTwoWinner,
      lowerSeed: semiTwoLoser,
      winnerSeed: hasSemiTwoResult ? semiTwoWinner : null,
      score: semiTwoScore,
      description: semiTwoResult || "Waiting for Bengals vs 49ers to populate",
    });

    bracketGrid.appendChild(semiOne);
    bracketGrid.appendChild(final);
    bracketGrid.appendChild(semiTwo);
    els.bracketDiagram.appendChild(bracketGrid);

    const footer = document.createElement("div");
    footer.className = "bracket__footer";
    footer.appendChild(buildEliminationNotice(seed5));
    if (semiOneResult) footer.appendChild(buildSemiRecap(semiOneWinner, semiOneLoser, semiOneScore, "Semi #1 result"));
    if (semiTwoResult) footer.appendChild(buildSemiRecap(semiTwoWinner, semiTwoLoser, semiTwoScore, "Semi #2 result"));
    els.bracketDiagram.appendChild(footer);

    if (els.bracketStatus) els.bracketStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    toggleError(els.bracketError, false);
  }

  function buildSemiCard({ title, slot, topSeed, lowerSeed, winnerSeed, score, description }) {
    const card = document.createElement("div");
    card.className = "bracket__round bracket__round--semi";
    if (slot === "left") card.classList.add("bracket__round--semi-left");
    if (slot === "right") card.classList.add("bracket__round--semi-right");
    card.innerHTML = `<div class="bracket__round-title">${title}</div>`;

    const matchup = document.createElement("div");
    matchup.className = "bracket__matchup";

    const winnerSeedId = winnerSeed?.seed;
    matchup.appendChild(
      seedChip(topSeed, {
        fallbackLabel: slot === "left" ? "Seed #1" : "Seed #2",
        status: winnerSeedId && winnerSeedId === topSeed?.seed ? "winner" : "pending",
        note: winnerSeedId && winnerSeedId === topSeed?.seed ? "Advanced" : "Awaiting kickoff",
      })
    );

    const connector = document.createElement("div");
    connector.className = "bracket__connector";
    connector.textContent = score || "vs";
    matchup.appendChild(connector);

    matchup.appendChild(
      seedChip(lowerSeed, {
        fallbackLabel: slot === "left" ? "Seed #4" : "Seed #3",
        status: winnerSeedId ? (winnerSeedId === lowerSeed?.seed ? "winner" : "eliminated") : "pending",
        note: winnerSeedId
          ? winnerSeedId === lowerSeed?.seed
            ? "Advanced"
            : "Eliminated"
          : "Awaiting kickoff",
      })
    );

    card.appendChild(matchup);

    if (description) {
      const note = document.createElement("div");
      note.className = "bracket__note";
      note.textContent = description;
      card.appendChild(note);
    }

    return card;
  }

  function buildFinalCard({ title, leftSeed, rightSeed, awaitingLabelRight, semiOneResult, semiTwoResult }) {
    const card = document.createElement("div");
    card.className = "bracket__round bracket__round--final";
    card.innerHTML = `<div class="bracket__round-title">${title}</div>`;

    const matchup = document.createElement("div");
    matchup.className = "bracket__matchup bracket__matchup--final";

    const leftAdvanced = Boolean(leftSeed && semiOneResult);
    const rightAdvanced = Boolean(rightSeed && (semiTwoResult || semiOneResult));
    matchup.appendChild(
      seedChip(leftSeed, {
        fallbackLabel: "Seed #1",
        status: leftAdvanced ? "winner" : "pending",
        note: leftAdvanced ? "Advanced from Semi #1" : "Awaiting #1/#4 winner",
      })
    );

    const connector = document.createElement("div");
    connector.className = "bracket__connector bracket__connector--final";
    connector.textContent = "vs";
    matchup.appendChild(connector);

    matchup.appendChild(
      seedChip(rightSeed, {
        fallbackLabel: awaitingLabelRight || "Awaiting opponent",
        status: rightAdvanced ? "winner" : "pending",
        seedLabel: awaitingLabelRight || "Awaiting opponent",
        note: rightAdvanced ? "Advanced from Semi #2" : awaitingLabelRight || "Awaiting opponent",
      })
    );

    card.appendChild(matchup);
    if (semiOneResult || semiTwoResult) {
      const note = document.createElement("div");
      note.className = "bracket__note";
      const notes = [];
      if (semiOneResult) notes.push(`Semi #1: ${semiOneResult}`);
      if (semiTwoResult) notes.push(`Semi #2: ${semiTwoResult}`);
      note.textContent = notes.join(" • ");
      card.appendChild(note);
    }
    return card;
  }

  function buildEliminationNotice(seed5) {
    const eliminated = document.createElement("div");
    eliminated.className = "bracket__eliminated";
    eliminated.textContent = seed5
      ? `Seed ${seed5.seed} (${resolveTeam(seed5.team).displayName}) was eliminated`
      : "Waiting on updated seeds…";
    return eliminated;
  }

  function buildSemiRecap(winnerSeed, loserSeed, score, label = "Semi result") {
    const recap = document.createElement("div");
    recap.className = "bracket__summary";
    const title = document.createElement("div");
    title.className = "bracket__summary-title";
    title.textContent = label;
    recap.appendChild(title);

    const body = document.createElement("div");
    body.className = "bracket__summary-body";
    body.appendChild(
      seedChip(winnerSeed, {
        fallbackLabel: "Winner",
        status: "winner",
        note: "Into Tate Bowl",
      })
    );
    body.appendChild(buildScoreBadge(score));
    body.appendChild(
      seedChip(loserSeed, {
        fallbackLabel: "Loser",
        status: "eliminated",
        note: "Eliminated",
      })
    );

    recap.appendChild(body);
    return recap;
  }

  function buildScoreBadge(score) {
    const badge = document.createElement("div");
    badge.className = "bracket__score-badge";
    badge.textContent = score || "vs";
    return badge;
  }

  function formatSemiResult(winnerSeed, loserSeed, score) {
    if (!winnerSeed || !loserSeed || !score) return null;
    const winner = resolveTeam(winnerSeed.team).displayName;
    const loser = resolveTeam(loserSeed.team).displayName;
    return `${winner} defeated ${loser} ${score}`;
  }

  function seedChip(seed, options = {}) {
    const { fallbackLabel = "Seed pending", status = "pending", seedLabel, note } =
      typeof options === "string" ? { fallbackLabel: options } : options;

    const chip = document.createElement("div");
    chip.className = "seed-chip";
    if (status) chip.classList.add(`seed-chip--${status}`);

    const logo = document.createElement("div");
    logo.className = "seed-chip__logo";
    if (seed) setLogo(logo, resolveTeam(seed.team).logoKey);
    chip.appendChild(logo);

    const meta = document.createElement("div");
    meta.className = "seed-chip__meta";
    const name = document.createElement("div");
    name.className = "seed-chip__name";
    name.textContent = seed ? resolveTeam(seed.team).displayName : fallbackLabel;
    const seedTag = document.createElement("div");
    seedTag.className = "seed-chip__seed";
    seedTag.textContent = seed ? `Seed ${seed.seed}` : seedLabel || "Awaiting seed";
    meta.appendChild(name);
    meta.appendChild(seedTag);
    if (note) {
      const statusLine = document.createElement("div");
      statusLine.className = "seed-chip__status";
      statusLine.textContent = note;
      meta.appendChild(statusLine);
    }

    chip.appendChild(meta);
    return chip;
  }

  function renderNews(news) {
    if (!els.newsFeed) return;
    els.newsFeed.innerHTML = "";
    if (!news || !news.length) {
      if (els.newsEmpty) els.newsEmpty.hidden = false;
      return;
    }
    if (els.newsEmpty) els.newsEmpty.hidden = true;
    toggleError(els.newsError, false);

    const sorted = [...news].sort((a, b) => (b.dateValue ?? 0) - (a.dateValue ?? 0));
    const frag = document.createDocumentFragment();

    sorted.forEach((item) => {
      const card = document.createElement("div");
      card.className = "news-card";

      const image = document.createElement("div");
      image.className = "news-card__image";
      if (item.image) image.style.backgroundImage = `url(${item.image})`;
      card.appendChild(image);

      const body = document.createElement("div");
      const headline = document.createElement("div");
      headline.className = "news-card__headline";
      headline.textContent = item.headline || "Breaking news";

      const meta = document.createElement("div");
      meta.className = "news-card__meta";
      if (item.date) meta.appendChild(textSpan(item.date));
      if (item.author) meta.appendChild(textSpan(item.verified ? `${item.author} ✅` : item.author));
      if (item.likes != null) meta.appendChild(textSpan(`❤️ ${formatCount(item.likes)}`));
      if (item.views != null) meta.appendChild(textSpan(`👁️ ${formatCount(item.views)}`));

      const story = document.createElement("div");
      story.className = "news-card__body";
      story.textContent = item.body || "—";

      body.appendChild(headline);
      body.appendChild(meta);
      body.appendChild(story);
      card.appendChild(body);
      frag.appendChild(card);
    });

    els.newsFeed.appendChild(frag);
    if (els.newsStatus) els.newsStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;
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

  function deriveMatchupStats(snapshots, teamAInfo, teamBInfo) {
    if (!snapshots?.length) return null;
    const ordered = [...snapshots].sort((a, b) => (b.minuteLeft ?? 0) - (a.minuteLeft ?? 0));

    let leadChanges = 0;
    let prevLeader = null;
    let currentRunA = 0;
    let currentRunB = 0;
    let longestRunA = 0;
    let longestRunB = 0;
    let timeLeadingA = 0;
    let timeLeadingB = 0;
    let timeTied = 0;
    let probSamples = 0;
    let probAwayTotal = 0;
    let probHomeTotal = 0;
    let possessionsA = 0;
    let possessionsB = 0;

    const scoreA = (snap) => (snap?.scoreA != null ? Number(snap.scoreA) : 0);
    const scoreB = (snap) => (snap?.scoreB != null ? Number(snap.scoreB) : 0);

    const teamAKey = canonicalTeamKey(teamAInfo?.canonicalKey || teamAInfo?.displayName);
    const teamBKey = canonicalTeamKey(teamBInfo?.canonicalKey || teamBInfo?.displayName);

    for (let i = 0; i < ordered.length; i++) {
      const snap = ordered[i];
      const prev = ordered[i - 1];
      const currScoreA = scoreA(snap);
      const currScoreB = scoreB(snap);
      const prevScoreA = scoreA(prev ?? snap);
      const prevScoreB = scoreB(prev ?? snap);

      const leader = currScoreA > currScoreB ? "a" : currScoreB > currScoreA ? "b" : "tied";
      if (prevLeader && leader !== prevLeader && leader !== "tied" && prevLeader !== "tied") {
        leadChanges += 1;
      }
      prevLeader = leader !== "tied" ? leader : prevLeader;

      const deltaA = currScoreA - prevScoreA;
      const deltaB = currScoreB - prevScoreB;
      currentRunA = deltaA > 0 ? currentRunA + deltaA : 0;
      currentRunB = deltaB > 0 ? currentRunB + deltaB : 0;
      longestRunA = Math.max(longestRunA, currentRunA);
      longestRunB = Math.max(longestRunB, currentRunB);

      if (snap.possession) {
        const possKey = canonicalTeamKey(snap.possession) || normalizeTeamKey(snap.possession);
        if (teamAKey && possKey === teamAKey) possessionsA += 1;
        if (teamBKey && possKey === teamBKey) possessionsB += 1;
      }

      if (snap.winProbAway != null && snap.winProbHome != null) {
        probSamples += 1;
        probAwayTotal += snap.winProbAway * 100;
        probHomeTotal += snap.winProbHome * 100;
      }

      const next = ordered[i + 1];
      if (next && snap.minuteLeft != null && next.minuteLeft != null) {
        const elapsed = Math.abs((snap.minuteLeft ?? 0) - (next.minuteLeft ?? 0));
        if (leader === "a") timeLeadingA += elapsed;
        else if (leader === "b") timeLeadingB += elapsed;
        else timeTied += elapsed;
      }
    }

    const finalSnap = ordered[ordered.length - 1];

    return {
      scoreA: scoreA(finalSnap),
      scoreB: scoreB(finalSnap),
      pointDiff: scoreA(finalSnap) - scoreB(finalSnap),
      leadChanges,
      longestRunA,
      longestRunB,
      timeLeadingA,
      timeLeadingB,
      timeTied,
      avgWinProbA: probSamples ? probAwayTotal / probSamples : null,
      avgWinProbB: probSamples ? probHomeTotal / probSamples : null,
      possessionsA,
      possessionsB,
    };
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

  function renderLiveStats(teamStats, teamAInfo, teamBInfo) {
    if (!els.liveStatsGrid || !els.liveStatsEmpty) return;
    els.liveStatsGrid.innerHTML = "";

    if (!teamStats) {
      els.liveStatsEmpty.hidden = false;
      return;
    }
    els.liveStatsEmpty.hidden = true;

    const cards = [
      { label: "Total yards", a: formatCount(teamStats.totalYardsA), b: formatCount(teamStats.totalYardsB) },
      { label: "First downs", a: formatCount(teamStats.firstDownsA), b: formatCount(teamStats.firstDownsB) },
      {
        label: "3rd down",
        a: formatConversionDisplay(teamStats.thirdConvA, teamStats.thirdMadeA, teamStats.thirdAttA),
        b: formatConversionDisplay(teamStats.thirdConvB, teamStats.thirdMadeB, teamStats.thirdAttB),
      },
      {
        label: "4th down",
        a: formatConversionDisplay(teamStats.fourthConvA, teamStats.fourthMadeA, teamStats.fourthAttA),
        b: formatConversionDisplay(teamStats.fourthConvB, teamStats.fourthMadeB, teamStats.fourthAttB),
      },
      { label: "Turnovers", a: formatCount(teamStats.turnoversA), b: formatCount(teamStats.turnoversB) },
      { label: "Penalties", a: formatCount(teamStats.penaltiesA), b: formatCount(teamStats.penaltiesB) },
      { label: "Yards / play", a: formatScore(teamStats.yardsPerPlayA), b: formatScore(teamStats.yardsPerPlayB) },
      {
        label: "Time of possession",
        a: formatPossessionClock(teamStats.topA),
        b: formatPossessionClock(teamStats.topB),
      },
      {
        label: "Red zone",
        a: formatConversionDisplay(teamStats.redZoneA, null, null),
        b: formatConversionDisplay(teamStats.redZoneB, null, null),
      },
    ];

    const chip = (team, value, tone) => {
      const div = document.createElement("div");
      div.className = `team-stat ${tone ? `team-stat--${tone}` : ""}`.trim();
      const logo = document.createElement("div");
      logo.className = "team-stat__logo";
      setLogo(logo, team.logoKey);
      const val = document.createElement("div");
      val.className = "team-stat__value";
      val.textContent = value ?? "—";
      div.appendChild(logo);
      div.appendChild(val);
      return div;
    };

    const frag = document.createDocumentFragment();
    cards.forEach((card) => {
      const container = document.createElement("div");
      container.className = "live-stat-card";

      const heading = document.createElement("div");
      heading.className = "live-stat-card__heading";
      heading.textContent = card.label;
      container.appendChild(heading);

      const values = document.createElement("div");
      values.className = "live-stat-card__values";
      values.appendChild(chip(teamAInfo, card.a, "left"));
      values.appendChild(chip(teamBInfo, card.b, "right"));
      container.appendChild(values);

      frag.appendChild(container);
    });

    els.liveStatsGrid.appendChild(frag);
  }

  function renderBreakdown(stats, teamAInfo, teamBInfo) {
    if (!els.breakdownGrid) return;
    els.breakdownGrid.innerHTML = "";

    if (!stats) {
      const msg = document.createElement("div");
      msg.className = "state state--empty";
      msg.textContent = "Team stats will appear once provided.";
      els.breakdownGrid.appendChild(msg);
      return;
    }

    const cards = [
      {
        label: "Score",
        a: formatCount(stats.scoreA),
        b: formatCount(stats.scoreB),
      },
      {
        label: "Avg win prob",
        a: stats.avgWinProbA != null ? `${stats.avgWinProbA.toFixed(1)}%` : "—",
        b: stats.avgWinProbB != null ? `${stats.avgWinProbB.toFixed(1)}%` : "—",
      },
      {
        label: "Longest scoring run",
        a: stats.longestRunA ? `+${stats.longestRunA}` : "—",
        b: stats.longestRunB ? `+${stats.longestRunB}` : "—",
      },
      {
        label: "Time leading",
        a: stats.timeLeadingA ? formatClock(stats.timeLeadingA) : "—",
        b: stats.timeLeadingB ? formatClock(stats.timeLeadingB) : "—",
        note: stats.timeTied ? `Tied for ${formatClock(stats.timeTied)}` : "",
      },
      {
        label: "Logged possessions",
        a: formatCount(stats.possessionsA),
        b: formatCount(stats.possessionsB),
      },
    ];

    const metaCards = [
      { label: "Lead changes", value: formatCount(stats.leadChanges) },
      { label: "Current margin", value: formatSigned(stats.pointDiff) },
    ];

    const frag = document.createDocumentFragment();

    const teamBadge = (team) => {
      const badge = document.createElement("div");
      badge.className = "team-stat__logo";
      setLogo(badge, team.logoKey);
      return badge;
    };

    const statChip = (team, value, tone) => {
      const chip = document.createElement("div");
      chip.className = `team-stat ${tone ? `team-stat--${tone}` : ""}`.trim();
      chip.appendChild(teamBadge(team));
      const val = document.createElement("div");
      val.className = "team-stat__value";
      val.textContent = value ?? "—";
      chip.appendChild(val);
      return chip;
    };

    cards.forEach((card) => {
      const div = document.createElement("div");
      div.className = "breakdown-card";
      const heading = document.createElement("div");
      heading.className = "breakdown-card__heading";
      heading.textContent = card.label;

      const values = document.createElement("div");
      values.className = "breakdown-card__values";
      values.appendChild(statChip(teamAInfo, card.a, "left"));
      values.appendChild(statChip(teamBInfo, card.b, "right"));

      div.appendChild(heading);
      div.appendChild(values);

      if (card.note) {
        const note = document.createElement("div");
        note.className = "breakdown-card__note";
        note.textContent = card.note;
        div.appendChild(note);
      }

      frag.appendChild(div);
    });

    metaCards.forEach((meta) => {
      const div = document.createElement("div");
      div.className = "breakdown-card breakdown-card--meta";
      const heading = document.createElement("div");
      heading.className = "breakdown-card__heading";
      heading.textContent = meta.label;
      const value = document.createElement("div");
      value.className = "breakdown-card__meta-value";
      value.textContent = meta.value ?? "—";
      div.appendChild(heading);
      div.appendChild(value);
      frag.appendChild(div);
    });

    els.breakdownGrid.appendChild(frag);
  }

  // =======================
  // HELPERS
  // =======================
  function buildSnapshotFreshness(snapshot, fallbackUpdateIndex = 0) {
    if (!snapshot) return null;
    const updateIndex = snapshot.updateIndex ?? parseNumber(snapshot.update) ?? fallbackUpdateIndex;
    const minuteLeft = snapshot.minuteLeft != null ? Number(snapshot.minuteLeft) : null;
    const scoreA = snapshot.scoreA != null ? Number(snapshot.scoreA) : null;
    const scoreB = snapshot.scoreB != null ? Number(snapshot.scoreB) : null;
    const scoreSum =
      scoreA != null && scoreB != null && Number.isFinite(scoreA) && Number.isFinite(scoreB)
        ? scoreA + scoreB
        : null;
    return { updateIndex, minuteLeft, scoreSum };
  }

  function isFreshSnapshot(next, prev) {
    if (!next) return true;
    if (!prev) return true;

    // Allow hard resets (new game, sheet cleared, or scores rewound).
    // In those cases the update counter can jump backwards, so treat them as fresh.
    const scoreRewind =
      Number.isFinite(next.scoreSum) && Number.isFinite(prev.scoreSum) && next.scoreSum < prev.scoreSum;
    const clockJumpedBack =
      Number.isFinite(next.minuteLeft) && Number.isFinite(prev.minuteLeft) && next.minuteLeft > prev.minuteLeft + 1;

    if (scoreRewind || clockJumpedBack) {
      const looksLikeNewGame =
        (next.updateIndex != null && next.updateIndex <= 1) &&
        (Number.isFinite(prev.minuteLeft)
          ? next.minuteLeft == null || next.minuteLeft > prev.minuteLeft + 10
          : true);
      if (!looksLikeNewGame) return false;
      return true;
    }

    if (next.updateIndex > prev.updateIndex) return true;
    if (next.updateIndex < prev.updateIndex) return false;

    const scoreAdvanced =
      Number.isFinite(next.scoreSum) && Number.isFinite(prev.scoreSum) && next.scoreSum > prev.scoreSum;

    if (Number.isFinite(next.minuteLeft) && Number.isFinite(prev.minuteLeft)) {
      if (next.minuteLeft < prev.minuteLeft) return true;
      if (next.minuteLeft > prev.minuteLeft) {
        // Some sheets use elapsed minutes instead of minutes remaining; if the score advanced, treat as fresh.
        if (scoreAdvanced) return true;
        return false;
      }
    }

    if (Number.isFinite(next.scoreSum) && Number.isFinite(prev.scoreSum)) {
      if (next.scoreSum > prev.scoreSum) return true;
      if (next.scoreSum < prev.scoreSum) return false;
    }

    return true;
  }

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

  function parseDateValue(raw) {
    if (!raw) return null;
    if (raw instanceof Date && !Number.isNaN(raw)) {
      return { value: raw.getTime(), formatted: raw.toLocaleString() };
    }
    if (typeof raw === "number" && XLSX?.SSF?.parse_date_code) {
      const parsed = XLSX.SSF.parse_date_code(raw);
      if (parsed) {
        const d = new Date(parsed.y, parsed.m - 1, parsed.d, parsed.H || 0, parsed.M || 0);
        return { value: d.getTime(), formatted: d.toLocaleString() };
      }
    }
    const date = new Date(raw);
    if (!Number.isNaN(date)) return { value: date.getTime(), formatted: date.toLocaleString() };
    return { value: null, formatted: String(raw) };
  }

  function looksLikeNewsSheet(sheet) {
    if (!sheet || typeof XLSX === "undefined") return false;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false });
    const header = rows?.[0] || [];
    const normalized = header.map((h) => String(h || "").toLowerCase());
    const hasHeadline = normalized.some((h) => h.includes("headline") || h.includes("news"));
    const hasDate = normalized.some((h) => h.includes("date") || h.includes("timestamp"));
    return hasHeadline && hasDate;
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

  function formatDownTicker(down, distance) {
    if (!down) return "—";
    const ordinals = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" };
    const downNum = Number(down);
    const downLabel = ordinals[downNum] || String(down).trim();
    if (!distance) return `${downLabel}`;
    return `${downLabel} & ${distance}`;
  }

  function formatClock(minutesLeft) {
    if (minutesLeft == null || Number.isNaN(minutesLeft)) return "0:00";
    const totalSeconds = Math.max(0, Math.round(minutesLeft * 60));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatPossessionClock(minutes) {
    if (minutes == null || Number.isNaN(minutes)) return "—";
    const totalSeconds = Math.round(minutes * 60);
    const mins = Math.floor(totalSeconds / 60);
    const secs = String(totalSeconds % 60).padStart(2, "0");
    return `${mins}:${secs}`;
  }

  function formatLocalTime(timestamp) {
    if (!timestamp) return "";
    try {
      return new Date(timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    } catch (err) {
      return "";
    }
  }

  function formatDurationShort(ms) {
    if (ms == null || Number.isNaN(ms)) return "";
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    if (totalMinutes < 60) return `${totalMinutes}m${seconds ? ` ${seconds}s` : ""}`;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}h${minutes ? ` ${minutes}m` : ""}`;
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

  function formatCountPair(a, b, separator = " / ") {
    const left = formatCount(a);
    const right = formatCount(b);
    if (left === "—" && right === "—") return "—";
    return `${left}${separator}${right}`;
  }

  function formatCount(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return Number(value).toLocaleString();
  }

  function formatSigned(value) {
    if (value == null || Number.isNaN(value)) return "—";
    const rounded = Number.isInteger(value) ? value : Number(value).toFixed(1);
    return value > 0 ? `+${rounded}` : String(rounded);
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

  function formatConversionDisplay(combined, made, att) {
    if (combined != null && combined !== "") return combined;
    if (made == null && att == null) return "—";
    if (att == null) return `${made ?? 0}`;
    return `${made ?? 0}/${att}`;
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

  function playerAvatar(rec) {
    const image = rec.image || state.rosterMap.get(rec.player)?.image || null;
    const hasImage = Boolean(image);
    const style = hasImage ? `style="background-image:url('${escapeHtml(image)}')"` : "";
    const cls = hasImage ? "player__avatar player__avatar--photo" : "player__avatar";
    const text = hasImage ? "" : escapeHtml(initials(rec.player));
    return `<div class="${cls}" ${style}>${text}</div>`;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function textSpan(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
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

  function buildPlayersByTeam(records) {
    const map = new Map();
    records.forEach((rec) => {
      const key = canonicalTeamKey(rec.team) || normalizeTeamKey(rec.team);
      if (!key) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(rec);
    });
    map.forEach((arr) =>
      arr.sort((a, b) => (b.mvpScore ?? 0) - (a.mvpScore ?? 0) || (b.yards ?? 0) - (a.yards ?? 0))
    );
    return map;
  }

  function buildSeeds(rows) {
    if (!rows?.length) return [];
    return [...rows]
      .filter((row) => row.team)
      .sort((a, b) => (b.points ?? 0) - (a.points ?? 0) || (b.winPct ?? 0) - (a.winPct ?? 0) || (b.wins ?? 0) - (a.wins ?? 0))
      .slice(0, 5)
      .map((row, idx) => ({ ...row, seed: idx + 1 }));
  }

  function seedByTeam(seeds, teamKey) {
    if (!Array.isArray(seeds) || !teamKey) return null;
    const targetKey = canonicalTeamKey(teamKey) || normalizeTeamKey(teamKey);
    if (!targetKey) return null;
    return (
      seeds.find((seed) => {
        const seedKey = canonicalTeamKey(seed.team) || normalizeTeamKey(seed.team);
        return seedKey === targetKey;
      }) || null
    );
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

  function applyOutcomeStyles(winner) {
    const aContainer = els.teamALogo?.closest(".team");
    const bContainer = els.teamBLogo?.closest(".team");
    aContainer?.classList.remove("team--winner", "team--loser");
    bContainer?.classList.remove("team--winner", "team--loser");
    if (!winner) return;

    if (winner === "A") {
      aContainer?.classList.add("team--winner");
      bContainer?.classList.add("team--loser");
    } else if (winner === "B") {
      bContainer?.classList.add("team--winner");
      aContainer?.classList.add("team--loser");
    }
  }

  function launchConfetti(color = "#60a5fa") {
    const winTab = document.getElementById("tab-win");
    if (winTab && !winTab.classList.contains("tab--active")) return;
    if (state.hasShownConfetti) return;
    state.hasShownConfetti = true;
    const canvas = document.createElement("canvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.position = "fixed";
    canvas.style.inset = "0";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "9999";
    document.body.appendChild(canvas);
    const ctx = canvas.getContext("2d");

    const pieces = Array.from({ length: 120 }).map(() => ({
      x: Math.random() * canvas.width,
      y: -Math.random() * canvas.height,
      size: 6 + Math.random() * 6,
      rotation: Math.random() * Math.PI * 2,
      speed: 2 + Math.random() * 3,
      drift: -2 + Math.random() * 4,
      color,
    }));

    const decay = 70;
    let frame = 0;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach((p) => {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();

        p.y += p.speed;
        p.x += p.drift;
        p.rotation += 0.05;
      });
      frame += 1;
      if (frame < decay) requestAnimationFrame(draw);
      else document.body.removeChild(canvas);
    }
    requestAnimationFrame(draw);
  }

  function buildSampleMatchup() {
    const samples = [];
    const pregame = 0.62;
    let current = pregame * 100;

    for (let i = 12; i >= 0; i--) {
      const drift = (Math.sin((12 - i) / 3) + Math.random() * 0.5 - 0.25) * 3;
      current = Math.min(99, Math.max(1, current + drift));

      const drives = 12 - i + 1;
      const teamStats = {
        totalYardsA: 250 + drives * 8,
        totalYardsB: 240 + drives * 6,
        firstDownsA: 10 + drives,
        firstDownsB: 9 + drives,
        thirdMadeA: 4,
        thirdAttA: 9,
        thirdMadeB: 3,
        thirdAttB: 8,
        fourthMadeA: 1,
        fourthAttA: 2,
        fourthMadeB: 0,
        fourthAttB: 1,
        turnoversA: 1,
        turnoversB: 0,
        penaltiesA: 3,
        penaltiesB: 4,
        yardsPerPlayA: 5.9,
        yardsPerPlayB: 5.2,
        redZoneA: "2/3",
        redZoneB: "1/2",
        topA: 16,
        topB: 13,
        thirdConvA: "4/9",
        thirdConvB: "3/8",
        fourthConvA: "1/2",
        fourthConvB: "0/1",
      };

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
        teamStats,
      });
    }

    return {
      snapshots: samples,
      teamA: "Away",
      teamB: "Home",
      teams: ["Away", "Home"],
      baseline: pregame,
      latestStats: samples[samples.length - 1]?.teamStats || null,
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
        yards: 19,
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

  function buildSampleNews() {
    return [
      {
        id: 1,
        date: new Date().toLocaleString(),
        dateValue: Date.now(),
        headline: "League Roundup",
        body: "Quick hits from around the league with injury news, roster moves, and standout performances.",
        author: "Desk Reporter",
        verified: true,
        likes: 1200,
        views: 45210,
        image: "",
      },
      {
        id: 2,
        date: new Date(Date.now() - 1000 * 60 * 60).toLocaleString(),
        dateValue: Date.now() - 1000 * 60 * 60,
        headline: "Film Room",
        body: "A closer look at how the Bengals adjusted their protection schemes to neutralize the edge rush.",
        author: "Analyst Corner",
        verified: false,
        likes: 860,
        views: 30110,
        image: "",
      },
    ];
  }

  function overrideUrl(key) {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  }
})();
