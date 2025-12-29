(() => {
  const MVP_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQp0jxVIwA59hH031QxJFBsXdQVIi7fNdPS5Ra2w1lK2UYA08rC0moSSqoKPSFL8BRZFh_hC4cO8ymk/pub?output=xlsx";

  const SCHEDULE_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXwm2d_zRf_4ecp0Czfmd5IRz92bzXLmQ3aY0X0aJ56Ua_vQjMrB2I7yCLYgLR48wLwDuGfjURL6jN/pub?gid=0&single=true&output=csv";

  const TEAM_CODE_MAP = {
    "0": { name: "Louisville Cardinals", logo: "cards" },
    "1": { name: "Dallas Cowboys", logo: "cowboys" },
    "2": { name: "Washington Redskins", logo: "redskins" },
    "3": { name: "Buffalo Bills", logo: "bills" },
    "4": { name: "Baltimore Ravens", logo: "ravens" },
    "5": { name: "New England Patriots", logo: "patriots" },
    lou: { name: "Louisville Cardinals", logo: "cards" },
    cards: { name: "Louisville Cardinals", logo: "cards" },
    was: { name: "Washington Redskins", logo: "redskins" },
    redskins: { name: "Washington Redskins", logo: "redskins" },
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

  const state = {
    standings: [],
    standingsLookup: new Map(),
    playersByTeam: new Map(),
    scheduleGames: [],
    game: null,
    legacy: null,
    legacyStandingsLookup: new Map(),
    legacyMap: null,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    cacheEls();
    loadData();
  });

  function cacheEls() {
    els.title = document.getElementById("previewTitle");
    els.subtitle = document.getElementById("previewSubtitle");
    els.status = document.getElementById("previewStatus");
    els.hero = document.getElementById("previewHero");
    els.grid = document.getElementById("previewGrid");
  }

  async function loadData() {
    try {
      await Promise.all([fetchMvp(), fetchSchedule(), fetchLegacy()]);
      resolveGameFromParams();
      renderPage();
    } catch (err) {
      console.error(err);
      if (els.status) els.status.textContent = "Error loading preview";
      if (els.grid) els.grid.innerHTML = `<div class="state state--error">Unable to load preview data.</div>`;
    }
  }

  async function fetchArrayBuffer(url) {
    const u = new URL(url, window.location.href);
    u.searchParams.set("_cb", Date.now().toString());
    const res = await fetch(u.toString(), { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  async function fetchText(url) {
    const u = new URL(url, window.location.href);
    u.searchParams.set("_cb", Date.now().toString());
    const res = await fetch(u.toString(), { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (/<html/i.test(text)) throw new Error("Sheet not published");
    return text;
  }

  async function fetchMvp() {
    const buffer = await fetchArrayBuffer(MVP_CSV_URL);
    const { mvpRecords, standings } = parseMvpWorkbook(buffer);
    state.playersByTeam = buildPlayersByTeam(mvpRecords);
    state.standings = standings;
    state.standingsLookup = buildStandingsLookup(standings);
  }

  async function fetchSchedule() {
    const text = await fetchText(SCHEDULE_CSV_URL);
    state.scheduleGames = parseScheduleCSV(text);
  }

  async function fetchLegacy() {
    if (!window.Legacy?.loadLegacyData) return;
    try {
      const legacy = await window.Legacy.loadLegacyData();
      state.legacy = legacy;
      state.legacyMap = legacy?.legacyMap || null;
      state.legacyStandingsLookup = buildStandingsLookup(legacy?.standings || []);
    } catch (err) {
      console.warn("[preview] Unable to load legacy data", err);
    }
  }

  function resolveGameFromParams() {
    const params = new URLSearchParams(window.location.search);
    const target = params.get("game") || params.get("code") || "";
    if (!target) return;
    const normalized = normalizeGameCode(target) || target;

    const direct = state.scheduleGames.find(
      (g) => normalizeGameCode(g.gameCode) === normalized || normalizeGameCode(g.gameCodeRaw) === normalized
    );

    if (direct) {
      state.game = direct;
      return;
    }

    const slugMatch = state.scheduleGames.find((g) => buildGameSlug(g) === target);
    if (slugMatch) state.game = slugMatch;
  }

  function renderPage() {
    if (!state.game) {
      if (els.subtitle) els.subtitle.textContent = "Pick a matchup from the schedule to preview it.";
      if (els.grid) els.grid.innerHTML = `<div class="state">No game found. Try opening from the schedule tab.</div>`;
      return;
    }

    const away = resolveTeam(state.game.away);
    const home = resolveTeam(state.game.home);
    const status = formatStatus(state.game);
    const title = `${away.displayName} @ ${home.displayName}`;
    if (els.title) els.title.textContent = `Week ${state.game.week}: ${title}`;
    if (els.subtitle) els.subtitle.textContent = `Game code ${state.game.gameCode || "—"}`;
    if (els.status) els.status.textContent = status.badge;

    renderHero(away, home, status);
    renderComparison(away, home, status);
  }

  function renderHero(away, home, status) {
    if (!els.hero) return;
    const awayStanding = lookupStanding(state.standingsLookup, away.canonicalKey) || lookupStanding(state.standingsLookup, away.displayName);
    const homeStanding = lookupStanding(state.standingsLookup, home.canonicalKey) || lookupStanding(state.standingsLookup, home.displayName);

    const hero = document.createElement("div");
    hero.className = "compare-sides";
    hero.appendChild(heroTeam(away, awayStanding, "Away"));
    const center = document.createElement("div");
    center.className = "preview-vs";
    center.innerHTML = `<div>${escapeHtml(status.badge)}</div><div class="preview-meta">${escapeHtml(status.meta)}</div>`;
    hero.appendChild(center);
    hero.appendChild(heroTeam(home, homeStanding, "Home"));

    els.hero.innerHTML = "";
    els.hero.appendChild(hero);
  }

  function heroTeam(team, standing, label) {
    const wrap = document.createElement("div");
    wrap.className = "compare-side";
    const header = document.createElement("div");
    header.className = "compare-side__header";
    const logo = document.createElement("div");
    logo.className = "compare-side__logo";
    setLogo(logo, team.logoKey);
    const labelEl = document.createElement("div");
    labelEl.innerHTML = `
      <div class="compare-side__name">${escapeHtml(team.displayName)}</div>
      <div class="compare-side__meta">${escapeHtml(label)} • ${escapeHtml(standing ? formatRecord(standing) : "Record —")}</div>
    `;
    header.appendChild(logo);
    header.appendChild(labelEl);
    wrap.appendChild(header);
    return wrap;
  }

  function renderComparison(away, home, status) {
    if (!els.grid) return;
    const profileAway = buildTeamProfile(away.canonicalKey);
    const profileHome = buildTeamProfile(home.canonicalKey);
    const verdict = buildVerdict(profileAway, profileHome);
    const probability = buildWinProbability(profileAway, profileHome);
    const awayLogo = logoFile(away.logoKey);
    const homeLogo = logoFile(home.logoKey);

    const frag = document.createDocumentFragment();

    const summary = document.createElement("div");
    summary.className = "compare-card";
    summary.innerHTML = `
      <div class="compare-headline">
        <div class="compare-headline__verdict">${escapeHtml(verdict.title)}</div>
        <div class="table__pill table__pill--muted">${escapeHtml(status.badge)}</div>
      </div>
      <div class="compare-notes">${escapeHtml(verdict.reason)}</div>
    `;
    frag.appendChild(summary);

    const predictor = document.createElement("div");
    predictor.className = "compare-card predictor-card";
    predictor.innerHTML = `
      <div class="compare-card__title">Matchup predictor</div>
      <div class="predictor">
        <div class="predictor__summary">
          <div class="predictor__team-badge">
            <div class="predictor__team-logo"${awayLogo ? ` style=\"background-image:url('logos/${awayLogo}')\"` : ""}></div>
            <div class="predictor__team-copy">
              <div class="predictor__team-label">Away</div>
              <div class="predictor__team-name">${escapeHtml(away.displayName)}</div>
              <div class="predictor__team-pct">${(probability.awayPct * 100).toFixed(1)}%</div>
            </div>
          </div>
          <div class="predictor__ring" style="--pct-away:${(probability.awayPct * 100).toFixed(1)};--pct-home:${(probability.homePct * 100).toFixed(1)};">
            <div class="predictor__ring-track"></div>
            <div class="predictor__ring-fill"></div>
            <div class="predictor__logos">
              <div class="predictor__logo predictor__logo--left"${awayLogo ? ` style=\"background-image:url('logos/${awayLogo}')\"` : ""}></div>
              <div class="predictor__logo predictor__logo--right"${homeLogo ? ` style=\"background-image:url('logos/${homeLogo}')\"` : ""}></div>
            </div>
            <div class="predictor__center"></div>
          </div>
          <div class="predictor__team-badge predictor__team-badge--home">
            <div class="predictor__team-logo"${homeLogo ? ` style=\"background-image:url('logos/${homeLogo}')\"` : ""}></div>
            <div class="predictor__team-copy">
              <div class="predictor__team-label">Home</div>
              <div class="predictor__team-name">${escapeHtml(home.displayName)}</div>
              <div class="predictor__team-pct predictor__team-pct--home">${(probability.homePct * 100).toFixed(1)}%</div>
            </div>
          </div>
        </div>
        <div class="predictor__details">
          <div class="predictor__bar predictor__bar--combined">
            <div class="predictor__bar-legend">
              <div class="predictor__bar-label">
                <span class="predictor__label-dot predictor__label-dot--away"></span>
                <span>${escapeHtml(away.displayName)}</span>
              </div>
              <div class="predictor__bar-label predictor__bar-label--home">
                <span>${escapeHtml(home.displayName)}</span>
                <span class="predictor__label-dot predictor__label-dot--home"></span>
              </div>
            </div>
            <div class="predictor__bar-track predictor__bar-track--split">
              <div class="predictor__bar-fill predictor__bar-fill--away" style="--pct:${probability.awayPct};"></div>
              <div class="predictor__bar-fill predictor__bar-fill--home" style="--pct:${probability.homePct};"></div>
            </div>
            <div class="predictor__bar-values">
              <div class="predictor__bar-value">${(probability.awayPct * 100).toFixed(1)}%</div>
              <div class="predictor__bar-value predictor__bar-value--home">${(probability.homePct * 100).toFixed(1)}%</div>
            </div>
          </div>
          <div class="predictor__note">${escapeHtml(probability.note)}</div>
        </div>
      </div>
    `;
    frag.appendChild(predictor);

    const stats = document.createElement("div");
    stats.className = "compare-card";
    stats.innerHTML = `<div class="compare-card__title">Stat matchup</div>`;

    const matchup = document.createElement("div");
    matchup.className = "preview-matchup";

    const headerRow = document.createElement("div");
    headerRow.className = "preview-matchup__header";
    headerRow.innerHTML = `
      <div class="preview-matchup__team">${escapeHtml(profileAway.teamName)}</div>
      <div class="preview-metric__label">Metric</div>
      <div class="preview-matchup__team">${escapeHtml(profileHome.teamName)}</div>
    `;
    matchup.appendChild(headerRow);

    [
      { label: "Win%", a: formatPct(profileAway.winPct), b: formatPct(profileHome.winPct) },
      { label: "Avg margin (last 3)", a: formatSigned(profileAway.window.avgMargin), b: formatSigned(profileHome.window.avgMargin) },
      { label: "Avg points for (last 3)", a: formatCount(profileAway.window.avgFor), b: formatCount(profileHome.window.avgFor) },
      { label: "Offense yards", a: formatCount(profileAway.totals.offenseYards), b: formatCount(profileHome.totals.offenseYards) },
      { label: "Total TD", a: formatCount(profileAway.totals.totalTd), b: formatCount(profileHome.totals.totalTd) },
      { label: "Def INT", a: formatCount(profileAway.totals.defInt), b: formatCount(profileHome.totals.defInt) },
      { label: "Sacks", a: formatCount(profileAway.totals.sacks), b: formatCount(profileHome.totals.sacks) },
    ].forEach((metric) => {
      const row = document.createElement("div");
      row.className = "preview-metric";
      row.innerHTML = `
        <div class="preview-metric__value preview-metric__value--left">${escapeHtml(metric.a)}</div>
        <div class="preview-metric__label">${escapeHtml(metric.label)}</div>
        <div class="preview-metric__value">${escapeHtml(metric.b)}</div>
      `;
      matchup.appendChild(row);
    });

    stats.appendChild(matchup);
    frag.appendChild(stats);

    const storylines = document.createElement("div");
    storylines.className = "compare-card";
    storylines.innerHTML = `<div class="compare-card__title">What to watch</div>`;
    const bullets = document.createElement("ul");
    bullets.className = "compare-notes";
    bullets.style.listStyle = "disc";
    bullets.style.paddingLeft = "18px";
    [
      `${away.displayName} recent form: ${formatSigned(profileAway.window.avgMargin)} avg margin over last ${profileAway.window.games} completed.`,
      `${home.displayName} recent form: ${formatSigned(profileHome.window.avgMargin)} avg margin over last ${profileHome.window.games} completed.`,
      `Top performers: ${topPlayers(profileAway)} vs ${topPlayers(profileHome)}.`,
      status.isFinal ? "This matchup is final — tap back to the live dashboard for the recap card." : "Game not started yet — live win probability will appear on the dashboard."
    ].forEach((note) => {
      const li = document.createElement("li");
      li.textContent = note;
      bullets.appendChild(li);
    });
    storylines.appendChild(bullets);
    frag.appendChild(storylines);

    els.grid.innerHTML = "";
    els.grid.appendChild(frag);
  }

  function topPlayers(profile) {
    const list = (profile.players || []).slice(0, 2).map((p) => `${p.player} (MVP ${formatScore(p.mvpScore)})`);
    return list.length ? list.join(", ") : "No leaders yet";
  }

  function buildTeamProfile(teamKey) {
    const standing = lookupStanding(state.standingsLookup, teamKey);
    const players = state.playersByTeam.get(teamKey) || [];
    const allTime = lookupStanding(state.legacyStandingsLookup, teamKey);
    return {
      teamName: resolveTeam(teamKey).displayName,
      players,
      totals: computeTeamTotals(players),
      winPct: standing?.winPct ?? null,
      window: buildGameWindowStats(teamKey, 3),
      gamesPlayed: standing?.games ?? null,
      allTime,
      legacyImpact: computeLegacyImpact(players),
    };
  }

  function buildGameWindowStats(teamKey, size) {
    const games = (state.scheduleGames || [])
      .filter((g) => teamInGame(g, teamKey) && String(g.complete || "").toLowerCase() !== "no")
      .sort((a, b) => (b.week || 0) - (a.week || 0))
      .slice(0, size);

    let forPts = 0;
    let againstPts = 0;
    let wins = 0;
    let losses = 0;
    let draws = 0;

    games.forEach((g) => {
      const isHome = isTeamKey(g.home, teamKey);
      const own = isHome ? g.scoreHome : g.scoreAway;
      const opp = isHome ? g.scoreAway : g.scoreHome;
      if (!Number.isFinite(own) || !Number.isFinite(opp)) return;
      forPts += own;
      againstPts += opp;
      if (own > opp) wins += 1;
      else if (own < opp) losses += 1;
      else draws += 1;
    });

    const gamesCount = wins + losses + draws || games.length || 1;
    return {
      avgFor: gamesCount ? forPts / gamesCount : null,
      avgAgainst: gamesCount ? againstPts / gamesCount : null,
      avgMargin: gamesCount ? (forPts - againstPts) / gamesCount : null,
      games: games.length,
    };
  }

  function buildVerdict(a, b) {
    const scoreA = (a.winPct || 0) * 100 + (a.window.avgMargin || 0) * 2 + (a.totals.offenseYards || 0) / 1000;
    const scoreB = (b.winPct || 0) * 100 + (b.window.avgMargin || 0) * 2 + (b.totals.offenseYards || 0) / 1000;
    const leader = scoreA === scoreB ? "tie" : scoreA > scoreB ? "away" : "home";
    const leaderName = leader === "away" ? "Away team" : leader === "home" ? "Home team" : "Too close to call";
    const reason = leader === "tie" ? "Teams are neck and neck across win% and recent form." : "Edge based on win% and scoring margin.";
    return { leader, title: `${leaderName} edge`, reason };
  }

  function buildWinProbability(away, home) {
    const awayStrength = teamStrength(away);
    const homeStrength = teamStrength(home);
    const diff = awayStrength - homeStrength;
    const baseProbAway = 1 / (1 + Math.exp(-diff * 4));

    const recencyCoverage = Math.min(((away.window.games || 0) + (home.window.games || 0)) / 6, 1);
    const scheduleCoverage = Math.min(((away.gamesPlayed || 0) + (home.gamesPlayed || 0)) / 10, 1);
    const historyCoverage = Math.min(((away.allTime?.games || 0) + (home.allTime?.games || 0)) / 40, 1);
    const talentCoverage = Math.min(((away.players?.length || 0) + (home.players?.length || 0)) / 16, 1);
    const shrink = 0.25 * (1 - (recencyCoverage * 0.4 + scheduleCoverage * 0.25 + historyCoverage * 0.25 + talentCoverage * 0.1));
    const probAway = 0.5 + (baseProbAway - 0.5) * (1 - Math.max(0, shrink));
    const probHome = 1 - probAway;

    const confidence = Math.abs(probAway - 0.5);
    const tilt = probAway > 0.5 ? "Away lean" : probHome > 0.5 ? "Home lean" : "Dead even";
    const confidenceLabel =
      confidence > 0.2
        ? "High confidence — historical edge, standings, and player firepower align."
        : confidence > 0.1
        ? "Moderate confidence — slight edge from historical record and recent form."
        : "Low confidence — thin sample or evenly matched.";

    const coverageNote = historyCoverage < 0.35
      ? "Limited all-time sample available."
      : recencyCoverage < 0.35
      ? "Recent form sample is light."
      : "Using all-time standings plus current leaders.";

    return {
      awayPct: probAway,
      homePct: probHome,
      note: `${tilt}. ${confidenceLabel} ${coverageNote}`,
    };
  }

  function teamStrength(profile) {
    const winScore = profile.winPct != null ? profile.winPct : 0.5;
    const allTimeWin = profile.allTime?.winPct ?? winScore ?? 0.5;
    const blendedWin = winScore * 0.65 + allTimeWin * 0.35;

    const margin = profile.window.avgMargin ?? 0;
    const marginScore = 0.5 + Math.tanh(margin / 18) / 2;
    const offenseScore = Math.min((profile.totals.offenseYards || 0) / 1800, 1);
    const recencyWeight = Math.min((profile.window.games || 0) / 3, 1);
    const legacyWeight = profile.legacyImpact ?? 0;
    const sampleDepth = Math.min((profile.allTime?.games || 0) / 50, 1);

    const raw =
      blendedWin * 0.5 +
      marginScore * 0.2 * recencyWeight +
      offenseScore * 0.12 +
      legacyWeight * 0.12 +
      sampleDepth * 0.06;

    return Math.max(0.05, Math.min(0.95, raw));
  }

  function formatStatus(game) {
    const complete = String(game.complete || "").toLowerCase();
    const isFinal = complete === "yes";
    const isLive = complete === "live";
    const badge = isFinal ? "Final" : isLive ? "Live" : "Preview";
    const metaParts = [`Kick: ${game.startTime || "TBD"}`, `Game code: ${game.gameCode || "—"}`];
    if (isFinal && Number.isFinite(game.scoreHome) && Number.isFinite(game.scoreAway)) {
      metaParts.unshift(`Final score ${game.away} ${game.scoreAway ?? ""} @ ${game.home} ${game.scoreHome ?? ""}`);
    }
    return { badge, meta: metaParts.join(" • "), isFinal };
  }

  function teamInGame(game, targetKey) {
    return isTeamKey(game.away, targetKey) || isTeamKey(game.home, targetKey);
  }

  function isTeamKey(raw, target) {
    const key = canonicalTeamKey(raw) || normalizeTeamKey(raw);
    return key && target && key === target;
  }

  function parseScheduleCSV(text) {
    const rows = d3.csvParse(text);
    if (!rows || !rows.length) return [];

    const normRow = (obj) => {
      const out = {};
      for (const [k, v] of Object.entries(obj || {})) {
        out[String(k).trim().toLowerCase()] = v;
      }
      return out;
    };

    const pick = (r, keys) => {
      for (const k of keys) {
        const v = r[k];
        if (v != null && String(v).trim() !== "") return v;
      }
      return "";
    };

    const toInt = (v) => {
      const n = parseInt(String(v ?? "").trim(), 10);
      return Number.isFinite(n) ? n : null;
    };

    const toScore = (v) => {
      const n = parseNumber(v);
      return Number.isFinite(n) ? n : null;
    };

    const isYes = (v) => {
      const s = String(v ?? "").trim().toLowerCase();
      return s === "yes" || s === "y" || s === "true" || s === "1";
    };

    return rows
      .map((row) => {
        const r = normRow(row);

        const week = toInt(pick(r, ["round #", "round", "week", "wk", "w"]));
        const away = String(pick(r, ["team away", "away", "away team", "team_away"])).trim();
        const home = String(pick(r, ["team home", "home", "home team", "team_home"])).trim();
        const gameCodeRaw = String(pick(r, ["game code", "gamecode", "code"])).trim();
        const gameCode = normalizeGameCode(gameCodeRaw) || (gameCodeRaw || null);

        const completeCell = String(
          pick(r, [
            "game complete (yes, no, live)",
            "game complete (yes, no)",
            "game complete",
            "complete",
            "final",
          ])
        )
          .trim()
          .toLowerCase();

        const complete = completeCell === "live" ? "live" : isYes(completeCell) ? "yes" : "no";

        const startTime = String(
          pick(r, [
            "game start time (if text display the text otherwise displays time)",
            "game start time",
            "start time",
            "time",
          ])
        ).trim();

        const scoreHome = toScore(pick(r, ["score home", "home score"]));
        const scoreAway = toScore(pick(r, ["score away", "away score"]));

        if (!week || !away || !home) return null;

        return {
          week,
          away,
          home,
          gameCodeRaw,
          gameCode,
          complete,
          startTime,
          scoreHome,
          scoreAway,
        };
      })
      .filter(Boolean);
  }

  function parseMvpWorkbook(buffer) {
    if (typeof XLSX === "undefined") throw new Error("XLSX missing");
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

    const sortedStandings = sortStandings(standings);
    const standingsMap = buildStandingsLookup(sortedStandings);

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

    return { mvpRecords: records, standings: sortedStandings, roster };
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
      if (!player) return;
      const team = String(row.Team || row.team || "").trim();
      const image = imageKeys
        .map((key) => row[key])
        .find((val) => val != null && String(val).trim() !== "");
      const imageUrl = String(image || "").trim();
      const rosterTeam = team || "Inactive";
      map.set(player, { team: rosterTeam, image: imageUrl || null });
    });
    return map;
  }

  function parseStandingsSheet(workbook) {
    const sheetName =
      workbook.SheetNames.find((n) => n.toLowerCase().includes("standing")) || workbook.SheetNames[0];
    if (!sheetName) return [];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      defval: "",
      range: 2,
    });
    if (!rows.length) return [];

    return sortStandings(
      rows
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
        .filter((r) => r.team)
    );
  }

  function sortStandings(rows) {
    return [...(rows || [])].sort(compareStandings);
  }

  function compareStandings(a, b) {
    return (
      (b.points ?? -Infinity) - (a.points ?? -Infinity) ||
      (b.winPct ?? -Infinity) - (a.winPct ?? -Infinity) ||
      (b.wins ?? -Infinity) - (a.wins ?? -Infinity) ||
      (b.plusMinus ?? -Infinity) - (a.plusMinus ?? -Infinity) ||
      (a.team || "").localeCompare(b.team || "")
    );
  }

  function buildStandingsLookup(rows) {
    const map = new Map();
    rows.forEach((row) => {
      const norm = normalizeTeamKey(row.team);
      const canonical = canonicalTeamKey(row.team);
      [norm, canonical].forEach((key) => {
        if (!key) return;
        map.set(key, row);
      });
    });
    return map;
  }

  function lookupStanding(map, raw) {
    const norm = normalizeTeamKey(raw);
    if (!norm) return null;
    if (map.has(norm)) return map.get(norm);
    return null;
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

  function computeMvpScore(rec, wins) {
    const defScore =
      (rec.tackles || 0) + (rec.defInt || 0) * 5 + (rec.sacks || 0) * 4 + (rec.defTd || 0) * 20;
    const score =
      (rec.passRating || 0) * 2 +
      (rec.rushYards || 0) * 1 +
      (rec.recvYards || 0) * 1 +
      defScore * 1 +
      (wins || 0) * 2;

    return { score, defScore };
  }

  function computeTeamTotals(players) {
    const totals = {
      passYards: 0,
      rushYards: 0,
      recvYards: 0,
      passTd: 0,
      rushTd: 0,
      recvTd: 0,
      returnTd: 0,
      totalTd: 0,
      tackles: 0,
      sacks: 0,
      defInt: 0,
    };

    const add = (key, value) => {
      const n = parseNumber(value);
      totals[key] += Number.isFinite(n) ? n : 0;
    };

    players.forEach((p) => {
      add("passYards", p.yards);
      add("rushYards", p.rushYards);
      add("recvYards", p.recvYards);
      add("passTd", p.passTd);
      add("rushTd", p.rushTd);
      add("recvTd", p.recvTd);
      add("returnTd", p.returnTd);
      add(
        "totalTd",
        p.totalTd ?? (p.passTd || 0) + (p.rushTd || 0) + (p.recvTd || 0) + (p.returnTd || 0)
      );
      add("tackles", p.tackles);
      add("sacks", p.sacks);
      add("defInt", p.defInt);
    });

    totals.offenseYards = totals.passYards + totals.rushYards + totals.recvYards;
    return totals;
  }

  function computeLegacyImpact(players) {
    if (!players?.length || !state.legacyMap || !window.Legacy?.normalizeName) return 0;
    const normalize = window.Legacy.normalizeName;
    const scores = players
      .map((p) => state.legacyMap.get(normalize(p.player))?.score || 0)
      .filter((score) => score > 0)
      .sort((a, b) => b - a)
      .slice(0, 3);

    if (!scores.length) return 0;
    const topScore = state.legacy?.leaderboard?.[0]?.score || 0;
    const scaled = topScore ? scores.reduce((sum, val) => sum + val, 0) / (topScore * 2.5) : 0;
    return Math.max(0, Math.min(1, scaled));
  }

  function buildGameSlug(game) {
    const parts = [
      "week",
      game?.week ?? "",
      normalizeTeamKey(game?.away || ""),
      "vs",
      normalizeTeamKey(game?.home || ""),
    ].filter(Boolean);
    return parts.join("-");
  }

  function normalizeGameCode(raw) {
    const str = String(raw ?? "").trim();
    if (!str) return null;
    const match = str.match(/#?\s*([\d]+)/);
    if (match) return `#${match[1]}`;
    return str.startsWith("#") ? str : `#${str}`;
  }

  function primaryTeamKey(key) {
    const info = TEAM_CODE_MAP[key];
    if (info?.logo || info?.name) {
      return normalizeTeamKey(info.logo || info.name);
    }
    return normalizeTeamKey(key);
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

  function canonicalTeamKey(raw) {
    const cleaned = String(raw ?? "").trim();
    if (!cleaned) return null;

    const asNumber = Number(cleaned);
    if (!Number.isNaN(asNumber)) {
      const intKey = String(Math.trunc(asNumber));
      if (TEAM_CODE_MAP[intKey]) return primaryTeamKey(intKey);
    }

    const norm = normalizeTeamKey(cleaned);
    if (TEAM_CODE_MAP[cleaned]) return primaryTeamKey(cleaned);
    if (TEAM_CODE_MAP[norm]) return primaryTeamKey(norm);
    return norm;
  }

  function normalizeTeamKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase();
  }

  function setLogo(el, key) {
    if (!el) return;
    const file = LOGO_MAP[key?.toLowerCase()] || LOGO_MAP[normalizeTeamKey(key)];
    if (file) {
      el.style.backgroundImage = `url('logos/${file}')`;
    } else {
      el.style.background = "radial-gradient(circle, rgba(96,165,250,0.2), rgba(168,85,247,0.12))";
    }
  }

  function logoFile(key) {
    return LOGO_MAP[key?.toLowerCase()] || LOGO_MAP[normalizeTeamKey(key)] || "";
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

  function formatRecord(row) {
    if (!row) return "Record —";
    const w = row.wins ?? "—";
    const l = row.losses ?? "—";
    const d = row.draws;
    const pct = row.winPct != null && row.winPct !== "" ? ` (${(row.winPct * 100).toFixed(1)}%)` : "";
    const parts = [w, l];
    if (d != null) parts.push(d);
    return `${parts.join("-")}${pct}`;
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

  function formatSigned(value) {
    if (value == null || Number.isNaN(value)) return "—";
    const n = Number(value);
    if (n > 0) return `+${n.toFixed(1)}`;
    if (n < 0) return n.toFixed(1);
    return "0.0";
  }

  function formatCount(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 });
  }

  function parseNumber(val) {
    if (val == null) return null;
    const num = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
    return Number.isNaN(num) ? null : num;
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
