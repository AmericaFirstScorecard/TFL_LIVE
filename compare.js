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

  const TEAM_NAME_ALIASES = buildTeamNameAliases();
  const LOGO_MAP = buildLogoMap();

  const state = {
    standings: [],
    standingsLookup: new Map(),
    rosterMap: new Map(),
    playersByTeam: new Map(),
    scheduleGames: [],
    window: "current",
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    cacheEls();
    attachHandlers();
    loadData();
  });

  function cacheEls() {
    els.teamA = document.getElementById("compareTeamA");
    els.teamB = document.getElementById("compareTeamB");
    els.swap = document.getElementById("compareSwap");
    els.windowRow = document.getElementById("compareWindow");
    els.grid = document.getElementById("compareGrid");
    els.status = document.getElementById("compareStatus");
  }

  function attachHandlers() {
    if (els.teamA) els.teamA.addEventListener("change", render);
    if (els.teamB) els.teamB.addEventListener("change", render);
    if (els.swap)
      els.swap.addEventListener("click", () => {
        const a = els.teamA?.value;
        els.teamA.value = els.teamB?.value || "";
        els.teamB.value = a || "";
        render();
      });
    if (els.windowRow) {
      els.windowRow.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-window]");
        if (!btn) return;
        state.window = btn.dataset.window || "current";
        els.windowRow.querySelectorAll("[data-window]").forEach((node) => node.classList.remove("pill--active"));
        btn.classList.add("pill--active");
        render();
      });
    }
  }

  async function loadData() {
    try {
      await Promise.all([fetchMvp(), fetchSchedule()]);
      populateTeamSelects();
      render();
      if (els.status) els.status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      console.error(err);
      if (els.status) els.status.textContent = "Error loading feeds";
      if (els.grid) els.grid.innerHTML = `<div class="state state--error">Unable to load comparison data.</div>`;
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
    const { mvpRecords, standings, roster } = parseMvpWorkbook(buffer);
    state.rosterMap = roster;
    state.standings = standings;
    state.standingsLookup = buildStandingsLookup(standings);
    state.playersByTeam = buildPlayersByTeam(mvpRecords);
  }

  async function fetchSchedule() {
    const text = await fetchText(SCHEDULE_CSV_URL);
    state.scheduleGames = parseScheduleCSV(text);
  }

  function populateTeamSelects() {
    const teams = Array.from(new Set(state.standings.map((s) => s.team)));
    const fallback = Object.values(TEAM_CODE_MAP)
      .map((t) => t.name)
      .filter(Boolean);
    const seen = new Set();
    const options = [];
    [...teams, ...fallback]
      .filter(Boolean)
      .forEach((name) => {
        const info = resolveTeam(name);
        const key = info.canonicalKey || normalizeTeamKey(info.displayName);
        if (!key || seen.has(key)) return;
        seen.add(key);
        options.push(info);
      });

    options.sort((a, b) => (a.displayName || "").localeCompare(b.displayName || ""));

    const buildOptions = (sel) => {
      if (!sel) return;
      sel.innerHTML = "";
      options.forEach((info) => {
        const opt = document.createElement("option");
        opt.value = info.canonicalKey;
        opt.textContent = info.displayName;
        sel.appendChild(opt);
      });
    };

    buildOptions(els.teamA);
    buildOptions(els.teamB);
    if (els.teamA && els.teamA.options.length > 0) els.teamA.selectedIndex = 0;
    if (els.teamB && els.teamB.options.length > 1) els.teamB.selectedIndex = 1;
  }

  function render() {
    if (!els.grid) return;
    const teamAKey = canonicalTeamKey(els.teamA?.value);
    const teamBKey = canonicalTeamKey(els.teamB?.value);
    if (!teamAKey || !teamBKey || teamAKey === teamBKey) {
      els.grid.innerHTML = `<div class="state">Pick two different teams to begin.</div>`;
      return;
    }

    const profileA = buildTeamProfile(teamAKey);
    const profileB = buildTeamProfile(teamBKey);
    const verdict = buildVerdict(profileA, profileB);
    const windowLabel = windowDescription(state.window);

    const frag = document.createDocumentFragment();

    const verdictCard = document.createElement("div");
    verdictCard.className = "compare-card";
    verdictCard.innerHTML = `
      <div class="compare-headline">
        <div class="compare-headline__verdict">${escapeHtml(verdict.title)}</div>
        <div class="table__pill table__pill--muted">${escapeHtml(windowLabel)}</div>
      </div>
      <div class="compare-notes">${escapeHtml(verdict.reason)}</div>
    `;
    frag.appendChild(verdictCard);

    const sides = document.createElement("div");
    sides.className = "compare-sides";
    sides.appendChild(renderSide(profileA, verdict.leader === "a"));
    sides.appendChild(renderSide(profileB, verdict.leader === "b"));
    frag.appendChild(sides);

    const notes = document.createElement("div");
    notes.className = "compare-card";
    notes.innerHTML = `
      <div class="compare-card__title">Why this matchup matters</div>
      <div class="compare-notes">
        ${escapeHtml(verdict.context || "Recent form, win%, and scoring margin drive the verdict above.")}
      </div>
    `;
    frag.appendChild(notes);

    els.grid.innerHTML = "";
    els.grid.appendChild(frag);
  }

  function renderSide(profile, isLeader) {
    const wrap = document.createElement("div");
    wrap.className = "compare-side";

    const header = document.createElement("div");
    header.className = "compare-side__header";
    const logo = document.createElement("div");
    logo.className = "compare-side__logo";
    setLogo(logo, profile.teamInfo.logoKey);
    const label = document.createElement("div");
    label.innerHTML = `
      <div class="compare-side__name">${escapeHtml(profile.teamInfo.displayName)}</div>
      <div class="compare-side__meta">${escapeHtml(profile.recordText)}</div>
    `;
    header.appendChild(logo);
    header.appendChild(label);
    if (isLeader) {
      const badge = document.createElement("div");
      badge.className = "table__pill";
      badge.textContent = "Edge";
      header.appendChild(badge);
    }
    wrap.appendChild(header);

    const metrics = document.createElement("div");
    metrics.className = "compare-card";
    metrics.innerHTML = `<div class="compare-card__subtitle">Key metrics</div>`;

    const rows = document.createElement("div");
    rows.className = "compare-row";

    [
      { label: "Win%", value: formatPct(profile.winPct) },
      { label: "Avg margin", value: formatSigned(profile.avgMargin) },
      { label: "Avg points for", value: formatCount(profile.avgFor) },
      { label: "Avg points against", value: formatCount(profile.avgAgainst) },
      { label: "Offense yards", value: formatCount(profile.totals.offenseYards) },
      { label: "Total TD", value: formatCount(profile.totals.totalTd) },
      { label: "Pass yards", value: formatCount(profile.totals.passYards) },
      { label: "Rush yards", value: formatCount(profile.totals.rushYards) },
      { label: "Def INT", value: formatCount(profile.totals.defInt) },
      { label: "Sacks", value: formatCount(profile.totals.sacks) },
    ].forEach((metric) => {
      const row = document.createElement("div");
      row.className = "compare-metric";
      row.style.gridTemplateColumns = "1fr auto";
      row.innerHTML = `
        <div class="compare-metric__label">${escapeHtml(metric.label)}</div>
        <div class="compare-metric__value">${escapeHtml(metric.value)}</div>
      `;
      rows.appendChild(row);
    });

    metrics.appendChild(rows);
    wrap.appendChild(metrics);

    if (profile.players && profile.players.length) {
      const players = document.createElement("div");
      players.className = "compare-card";
      players.innerHTML = `<div class="compare-card__subtitle">Players to watch</div>`;
      const list = document.createElement("div");
      list.className = "compare-notes";
      list.innerHTML = profile.players
        .slice(0, 3)
        .map((p) => `${escapeHtml(p.player)} — MVP ${formatScore(p.mvpScore)}, Win% ${formatPct(p.winPct)}`)
        .join("<br>");
      players.appendChild(list);
      wrap.appendChild(players);
    }

    return wrap;
  }

  function buildTeamProfile(teamKey) {
    const teamInfo = resolveTeam(teamKey);
    const standing = lookupStanding(state.standingsLookup, teamKey) || lookupStanding(state.standingsLookup, teamInfo.displayName);
    const players = state.playersByTeam.get(teamKey) || state.playersByTeam.get(normalizeTeamKey(teamInfo.displayName)) || [];
    const totals = computeTeamTotals(players);
    const windowStats = buildGameWindowStats(teamKey, state.window);

    return {
      teamInfo,
      standing,
      players,
      totals,
      recordText: standing ? formatRecord(standing) : "Record —",
      winPct: standing?.winPct ?? null,
      avgFor: windowStats.avgFor,
      avgAgainst: windowStats.avgAgainst,
      avgMargin: windowStats.avgMargin,
    };
  }

  function buildGameWindowStats(teamKey, windowMode) {
    const games = (state.scheduleGames || []).filter((g) => teamInGame(g, teamKey));
    const completed = games
      .filter((g) => String(g.complete || "").toLowerCase() !== "no")
      .sort((a, b) => (b.week || 0) - (a.week || 0));

    let windowed = completed;
    if (windowMode === "last3") windowed = completed.slice(0, 3);
    if (windowMode === "last5") windowed = completed.slice(0, 5);
    if (windowMode === "last10") windowed = completed.slice(0, 10);
    if (windowMode === "playoffs") windowed = completed.filter((g) => /po|playoff/i.test(g.gameCode || g.gameCodeRaw || ""));
    // "all" and "current" fall back to completed list

    let forPts = 0;
    let againstPts = 0;
    let wins = 0;
    let losses = 0;
    let draws = 0;

    windowed.forEach((g) => {
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

    const gamesCount = wins + losses + draws || windowed.length || 1;
    return {
      avgFor: gamesCount ? forPts / gamesCount : null,
      avgAgainst: gamesCount ? againstPts / gamesCount : null,
      avgMargin: gamesCount ? (forPts - againstPts) / gamesCount : null,
      wins,
      losses,
      draws,
    };
  }

  function buildVerdict(a, b) {
    const scoreA = (a.winPct || 0) * 100 + (a.avgMargin || 0) * 2 + (a.totals.offenseYards || 0) / 1000;
    const scoreB = (b.winPct || 0) * 100 + (b.avgMargin || 0) * 2 + (b.totals.offenseYards || 0) / 1000;
    const leader = scoreA === scoreB ? "tie" : scoreA > scoreB ? "a" : "b";
    const leaderName = leader === "a" ? a.teamInfo.displayName : leader === "b" ? b.teamInfo.displayName : "Too close to call";
    const trailing = leader === "a" ? b : a;
    const leading = leader === "a" ? a : b;

    const reasons = [];
    if ((leading.winPct ?? 0) !== (trailing.winPct ?? 0))
      reasons.push(`${formatPct(leading.winPct)} Win% vs ${formatPct(trailing.winPct)}`);
    if (leading.avgMargin != null && trailing.avgMargin != null)
      reasons.push(`${formatSigned(leading.avgMargin)} avg margin vs ${formatSigned(trailing.avgMargin)}`);
    if (leading.totals.offenseYards || trailing.totals.offenseYards)
      reasons.push(`${formatCount(leading.totals.offenseYards)} offensive yards vs ${formatCount(trailing.totals.offenseYards)}`);

    return {
      leader,
      title: leader === "tie" ? "Dead even matchup" : `${leaderName} carry the edge`,
      reason: reasons.length ? reasons.join(" • ") : "Small sample sizes so far — check back once games complete.",
      context: `Window: ${windowDescription(state.window)}.`,
    };
  }

  function resolveTeam(raw) {
    const cleaned = String(raw ?? "").trim();
    if (!cleaned) return { displayName: "Team", logoKey: "", canonicalKey: "" };

    const canonical = canonicalTeamKey(cleaned);
    const codeMatch = canonical ? TEAM_CODE_MAP[canonical] : null;
    const displayName = codeMatch?.name || prettifyTeamName(cleaned);
    const logoKey = codeMatch?.logo || (canonical || normalizeTeamKey(displayName));

    return { displayName, logoKey, canonicalKey: canonical || normalizeTeamKey(displayName) };
  }

  function primaryTeamKey(key) {
    const info = TEAM_CODE_MAP[key];
    if (info?.logo || info?.name) {
      return normalizeTeamKey(info.logo || info.name);
    }
    return normalizeTeamKey(key);
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
    const alias = TEAM_NAME_ALIASES.get(norm);
    if (alias) return primaryTeamKey(alias);
    return norm;
  }

  function normalizeTeamKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase();
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
        const gameCode = String(pick(r, ["game code", "gamecode", "code"])).trim();

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
          gameCode,
          away,
          home,
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

    const rosterWithProfiles = mergeRosterWithRecords(roster, records);

    return { mvpRecords: records, standings: sortedStandings, roster: rosterWithProfiles };
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
      const team = String(row.Team || row.team || "").trim();
      const image = imageKeys
        .map((key) => row[key])
        .find((val) => val != null && String(val).trim() !== "");
      const imageUrl = String(image || "").trim();
      if (player && team) map.set(player, { team, image: imageUrl || null });
    });
    return map;
  }

  function mergeRosterWithRecords(roster, records) {
    const merged = new Map(roster || new Map());
    (records || []).forEach((rec) => {
      const name = rec?.player;
      if (!name) return;
      const existing = merged.get(name) || {};
      const team = existing.team || rec.team || "";
      const image = existing.image ?? null;
      merged.set(name, { team, image });
    });
    return merged;
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

  function windowDescription(mode) {
    switch (mode) {
      case "playoffs":
        return "Playoffs only (if tagged)";
      case "last3":
        return "Last 3 completed games";
      case "last5":
        return "Last 5 completed games";
      case "last10":
        return "Last 10 completed games";
      case "all":
        return "All completed games";
      default:
        return "Current season to date";
    }
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

  function buildTeamNameAliases() {
    const map = new Map();
    Object.entries(TEAM_CODE_MAP).forEach(([key, info]) => {
      if (!info?.name) return;
      const norm = normalizeTeamKey(info.name);
      const canonical = primaryTeamKey(key);
      if (!map.has(norm)) map.set(norm, canonical);
    });
    return map;
  }

  function prettifyTeamName(name) {
    const clean = String(name || "").trim();
    if (!clean) return "Team";
    return clean
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
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
