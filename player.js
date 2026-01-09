(() => {
  const MVP_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQp0jxVIwA59hH031QxJFBsXdQVIi7fNdPS5Ra2w1lK2UYA08rC0moSSqoKPSFL8BRZFh_hC4cO8ymk/pub?output=xlsx";

  const SCHEDULE_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vRXwm2d_zRf_4ecp0Czfmd5IRz92bzXLmQ3aY0X0aJ56Ua_vQjMrB2I7yCLYgLR48wLwDuGfjURL6jN/pub?gid=0&single=true&output=csv";

  const SEASON_WORKBOOK_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQfDvxdXmvl9dMNWi6x5y3XMyl-FjZ6wTdwpP-ZfKTlUyS_FUgRqpGeQs05wAtI1JVnRGzrenQqW6OR/pub?output=xlsx";

  const TEAM_CODE_MAP = {
    "0": { name: "Louisville Cardinals", logo: "cards" },
    "1": { name: "Dallas Cowboys", logo: "cowboys" },
    "2": { name: "New York Giants", logo: "giants" },
    "3": { name: "Tampa Bay Buccaneers", logo: "bucs" },
    lou: { name: "Louisville Cardinals", logo: "cards" },
    cards: { name: "Louisville Cardinals", logo: "cards" },
    dal: { name: "Dallas Cowboys", logo: "cowboys" },
    cowboys: { name: "Dallas Cowboys", logo: "cowboys" },
    nyg: { name: "New York Giants", logo: "giants" },
    giants: { name: "New York Giants", logo: "giants" },
    bucs: { name: "Tampa Bay Buccaneers", logo: "bucs" },
    buccaneers: { name: "Tampa Bay Buccaneers", logo: "bucs" },
  };

  const MVP_WEIGHTS = {
    passEfficiency: 2.4,
    accuracy: 0.3,
    passYards: 0.35,
    skillYards: 0.65,
    passTouchdown: 14,
    skillTouchdown: 18,
    returnTouchdown: 22,
    turnover: -10,
    defensive: 1.2,
    win: 1.5,
    winPct: 12,
    versatility: 8,
  };
  const LOGO_MAP = buildLogoMap();
  const TEAM_NAME_ALIASES = buildTeamNameAliases();

  const state = {
    playerName: "",
    playerRecord: null,
    rosterMap: new Map(),
    rosterLookup: new Map(),
    standings: [],
    standingsLookup: new Map(),
    players: [],
    scheduleGames: [],
    teamInfo: null,
    teamKey: "",
    seasonStats: { seasons: new Map(), allTime: new Map(), order: [] },
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    cacheEls();
    const params = new URLSearchParams(window.location.search);
    const nameParam = params.get("name") || params.get("player") || "";
    const teamParam = params.get("team") || "";
    if (!nameParam) return showError("Player not found. Try opening from a team page.");

    state.playerName = nameParam;
    state.teamKey = teamParam;
    const backTarget = teamParam ? `team.html?team=${encodeURIComponent(teamParam)}` : "index.html";
    if (els.playerBackLink) els.playerBackLink.href = backTarget;

    loadData();
  });

  async function loadData() {
    try {
      await Promise.all([fetchMvp(), fetchSchedule(), fetchSeasonStats()]);
      resolvePlayer();
      renderPage();
    } catch (err) {
      console.error(err);
      showError("Unable to load player data. Please try again.");
    }
  }

  function cacheEls() {
    els.playerName = document.getElementById("playerName");
    els.playerAvatar = document.getElementById("playerAvatar");
    els.playerMeta = document.getElementById("playerMeta");
    els.playerTeamLink = document.getElementById("playerTeamLink");
    els.playerHardware = document.getElementById("playerHardware");
    els.playerHardwareEmpty = document.getElementById("playerHardwareEmpty");
    els.playerStats = document.getElementById("playerStats");
    els.playerSchedule = document.getElementById("playerSchedule");
    els.playerScheduleEmpty = document.getElementById("playerScheduleEmpty");
    els.playerError = document.getElementById("playerError");
    els.playerBackLink = document.getElementById("playerBackLink");
    els.playerHistoryBody = document.getElementById("playerHistoryBody");
    els.playerHistoryEmpty = document.getElementById("playerHistoryEmpty");
    els.playerStatus = document.getElementById("playerStatus");
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
    state.rosterLookup = buildRosterLookup(roster);
    state.standings = standings;
    state.standingsLookup = buildStandingsLookup(standings);
    state.players = mvpRecords;
  }

  async function fetchSchedule() {
    const text = await fetchText(SCHEDULE_CSV_URL);
    state.scheduleGames = parseScheduleCSV(text);
  }

  async function fetchSeasonStats() {
    const buffer = await fetchArrayBuffer(SEASON_WORKBOOK_URL);
    state.seasonStats = parseSeasonWorkbook(buffer);
  }

  function resolvePlayer() {
    const target = normalizeTeamKey(state.playerName);
    state.playerRecord =
      state.players.find((p) => normalizeTeamKey(p.player) === target) ||
      state.players.find((p) => normalizeTeamKey(p.player).includes(target));

    if (state.playerRecord) {
      const team = state.playerRecord.team;
      if (team && team !== "Inactive") {
        state.teamInfo = resolveTeam(team);
        state.teamKey = state.teamInfo.canonicalKey;
      }
    } else if (state.teamKey) {
      state.teamInfo = resolveTeam(state.teamKey);
      state.teamKey = state.teamInfo.canonicalKey;
    } else {
      const roster = lookupRosterInfo(state.playerName);
      if (roster?.team && roster.team !== "Inactive") {
        state.teamInfo = resolveTeam(roster.team);
        state.teamKey = state.teamInfo.canonicalKey;
      }
    }
  }

  function renderPage() {
    renderHero();
    renderHardware();
    renderStats();
    renderHistoricalStats();
    renderSchedule(state.scheduleGames);
  }

  function renderHero() {
    const player = state.playerRecord;
    const isActive = Boolean(player && player.team && player.team !== "Inactive");
    const displayName = player?.player || state.playerName;
    if (els.playerName) els.playerName.textContent = displayName;
    setPlayerAvatar(els.playerAvatar, player || { player: displayName });

    const metaParts = [];
    if (!isActive) metaParts.push("Inactive player");
    if (player) {
      metaParts.push(`MVP ${formatScore(player.mvpScore)}`);
      if (player.winPct != null) metaParts.push(`Win% ${formatPct(player.winPct)}`);
    }
    const teamLabel = isActive
      ? state.teamInfo
        ? state.teamInfo.displayName
        : state.teamKey || "Team"
      : "Inactive";
    if (metaParts.length === 0) metaParts.push("Awaiting stats");
    if (els.playerMeta) els.playerMeta.textContent = metaParts.join(" • ");

    if (els.playerTeamLink) {
      if (isActive && state.teamInfo?.displayName) {
        const teamUrl = teamPageUrl(state.teamInfo);
        els.playerTeamLink.innerHTML = `<a class="team-link" href="${teamUrl}">Team: ${escapeHtml(teamLabel)}</a>`;
      } else {
        els.playerTeamLink.textContent = "No active team";
      }
    }

    if (els.playerStatus) {
      els.playerStatus.hidden = false;
      els.playerStatus.textContent = isActive ? "Active player" : "Inactive player";
      els.playerStatus.className = `badge ${isActive ? "badge--accent" : "badge--warning"}`;
    }
  }

  function renderHardware() {
    if (!els.playerHardware) return;
    els.playerHardware.innerHTML = "";
    const awards = window.listHardwareForPlayer?.(state.playerName) || [];
    const filtered = awards.filter((a) => a.recipients?.length);

    if (!filtered.length) {
      if (els.playerHardwareEmpty) els.playerHardwareEmpty.hidden = false;
      return;
    }
    if (els.playerHardwareEmpty) els.playerHardwareEmpty.hidden = true;

    const frag = document.createDocumentFragment();
    filtered.forEach((award) => {
      const recipients = award.recipients?.length
        ? award.recipients.map((r) => escapeHtml(r.display || r.id)).join(", ")
        : "Unassigned";
      const card = document.createElement("div");
      card.className = "hardware-card";
      card.innerHTML = `
        <div class="hardware-card__header">
          <div class="hardware-card__image" style="background-image:url('${escapeHtml(award.image)}')"></div>
          <div>
            <div class="hardware-card__title">${escapeHtml(award.name)}</div>
            <div class="hardware-card__description">${escapeHtml(award.description || "")}</div>
          </div>
        </div>
        <div class="hardware-card__recipients">
          <div class="hardware-pill">${recipients}</div>
        </div>
      `;
      frag.appendChild(card);
    });

    els.playerHardware.appendChild(frag);
  }

  function renderStats() {
    if (!els.playerStats) return;
    els.playerStats.innerHTML = "";
    const player = state.playerRecord;
    const standing = lookupStanding(state.standingsLookup, state.teamInfo?.displayName);

    const cards = [];
    cards.push({ label: "Team", value: state.teamInfo?.displayName || "—" });
    cards.push({ label: "MVP Score", value: player ? formatScore(player.mvpScore) : "—" });
    cards.push({ label: "Win%", value: player ? formatPct(player.winPct) : "—" });
    cards.push({ label: "Wins", value: player ? formatCount(player.wins) : "—" });
    if (standing) cards.push({ label: "Team Record", value: formatRecord(standing) });

    const statLines = player ? buildPlayerStatLines(player) : [];
    statLines.forEach((line) => cards.push({ label: line.label, value: line.value }));

    const frag = document.createDocumentFragment();
    cards.forEach((card) => {
      const div = document.createElement("div");
      div.className = "team-stat-card";
      div.innerHTML = `
        <div class="team-stat-card__label">${escapeHtml(card.label)}</div>
        <div class="team-stat-card__value">${escapeHtml(card.value)}</div>
      `;
      frag.appendChild(div);
    });

    els.playerStats.appendChild(frag);
  }

  function renderHistoricalStats() {
    if (!els.playerHistoryBody) return;
    els.playerHistoryBody.innerHTML = "";

    const history = findPlayerSeasonHistory(state.playerRecord?.player || state.playerName);
    if (!history.length) {
      if (els.playerHistoryEmpty) els.playerHistoryEmpty.hidden = false;
      return;
    }
    if (els.playerHistoryEmpty) els.playerHistoryEmpty.hidden = true;

    const frag = document.createDocumentFragment();
    history.forEach((row) => {
      const tr = document.createElement("tr");
      if (row.kind === "all-time") tr.className = "table__row--accent";

      const seasonCell = document.createElement("td");
      seasonCell.textContent = formatSeasonLabel(row.season, row.kind);
      tr.appendChild(seasonCell);

      const teamCell = document.createElement("td");
      teamCell.textContent = row.team || state.teamInfo?.displayName || "—";
      tr.appendChild(teamCell);

      const passCell = document.createElement("td");
      passCell.textContent = formatSeasonPassing(row);
      tr.appendChild(passCell);

      const rushCell = document.createElement("td");
      rushCell.textContent = formatSeasonRushing(row);
      tr.appendChild(rushCell);

      const recvCell = document.createElement("td");
      recvCell.textContent = formatSeasonReceiving(row);
      tr.appendChild(recvCell);

      const defCell = document.createElement("td");
      defCell.textContent = formatSeasonDefense(row);
      tr.appendChild(defCell);

      frag.appendChild(tr);
    });

    els.playerHistoryBody.appendChild(frag);
  }

  function renderSchedule(games) {
    if (!els.playerSchedule) return;
    els.playerSchedule.innerHTML = "";
    const targetKey = state.teamKey;
    const filtered = (games || []).filter((g) => teamInGame(g, targetKey));

    if (!filtered.length) {
      if (els.playerScheduleEmpty) els.playerScheduleEmpty.hidden = false;
      return;
    }
    if (els.playerScheduleEmpty) els.playerScheduleEmpty.hidden = true;

    filtered.sort((a, b) => a.week - b.week);
    const frag = document.createDocumentFragment();

    filtered.forEach((game) => {
      const card = document.createElement("div");
      card.className = "team-schedule__card";

      const isHome = isTeamKey(game.home, targetKey);
      const opponentRaw = isHome ? game.away : game.home;
      const opponentInfo = resolveTeam(opponentRaw);
      const statusInfo = buildStatus(game);
      const resultInfo = buildResult(game, isHome);

      const matchup = document.createElement("div");
      matchup.className = "team-schedule__matchup";
      matchup.innerHTML = `
        <div class="team-pill">Week ${game.week}</div>
        <div>${isHome ? "vs" : "@"}</div>
        <a class="team-link" href="${teamPageUrl(opponentInfo)}">${escapeHtml(opponentInfo.displayName)}</a>
      `;

      const meta = document.createElement("div");
      meta.className = "team-schedule__meta";

      const statusPill = document.createElement("div");
      statusPill.className = `team-pill ${statusInfo.className}`;
      statusPill.textContent = statusInfo.label;
      meta.appendChild(statusPill);

      if (game.startTime) {
        const timePill = document.createElement("div");
        timePill.className = "team-pill team-pill--accent";
        timePill.textContent = game.startTime;
        meta.appendChild(timePill);
      }

      if (resultInfo) {
        const resultPill = document.createElement("div");
        resultPill.className = `team-pill ${resultInfo.className}`;
        resultPill.textContent = resultInfo.text;
        meta.appendChild(resultPill);
      }

      card.appendChild(matchup);
      card.appendChild(meta);
      frag.appendChild(card);
    });

    els.playerSchedule.appendChild(frag);
  }

  function buildResult(game, isHome) {
    const complete = String(game.complete || "").toLowerCase();
    if (complete !== "yes") return null;
    const teamScore = isHome ? game.scoreHome : game.scoreAway;
    const oppScore = isHome ? game.scoreAway : game.scoreHome;
    if (teamScore == null || oppScore == null) return null;
    if (teamScore > oppScore) return { text: `W ${teamScore}-${oppScore}`, className: "team-pill--success" };
    if (teamScore < oppScore) return { text: `L ${teamScore}-${oppScore}`, className: "team-pill--warning" };
    return { text: `T ${teamScore}-${oppScore}`, className: "team-pill" };
  }

  function buildStatus(game) {
    const completeState = String(game.complete || "").toLowerCase();
    const rawTime = String(game.startTime || "").trim();
    const hasTime = rawTime && !/^(-|—|tbd|na|n\/a|null|undefined)$/i.test(rawTime);
    if (completeState === "yes") return { label: "FINAL", className: "team-pill--success" };
    if (completeState === "live") return { label: "LIVE", className: "team-pill--accent" };
    if (hasTime) return { label: "UPCOMING", className: "team-pill" };
    return { label: "UNSCHEDULED", className: "team-pill" };
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

        const complete =
          completeCell === "live" ? "live" : isYes(completeCell) ? "yes" : "no";

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
          complete,
          startTime,
          scoreHome,
          scoreAway,
        };
      })
      .filter(Boolean);
  }

  function parseSeasonWorkbook(buffer) {
    if (typeof XLSX === "undefined") throw new Error("XLSX missing");
    const workbook = XLSX.read(buffer, { type: "array" });
    const seasons = new Map();
    const allTime = new Map();
    const order = [];

    workbook.SheetNames.forEach((sheetName) => {
      const seasonLabel = String(sheetName || "").trim();
      if (!seasonLabel) return;
      const entries = parseSeasonSheet(workbook, sheetName, seasonLabel);
      if (!entries.length) return;

      if (/all\s*time/i.test(seasonLabel)) {
        entries.forEach((entry) => {
          const key = normalizePlayerKey(entry.player);
          if (!key) return;
          allTime.set(key, entry);
        });
      } else {
        const normSeason = seasonLabel;
        if (!seasons.has(normSeason)) {
          seasons.set(normSeason, []);
          order.push(normSeason);
        }
        seasons.get(normSeason).push(...entries);
      }
    });

    const sortedOrder = [...order].sort((a, b) => parseSeasonNumber(b) - parseSeasonNumber(a));
    return { seasons, allTime, order: sortedOrder };
  }

  function parseSeasonSheet(workbook, sheetName, seasonLabel) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
    if (!rows || !rows.length) return [];

    return rows
      .map((row) => {
        const player = String(row.Player || row.player || "").trim();
        if (!player) return null;
        return {
          season: seasonLabel,
          player,
          team: String(row.Team || row.team || "").trim(),
          completions: parseNumber(row.Completions),
          attempts: parseNumber(row.Attempts),
          compPct: parseNumber(row["Completion %"]),
          passYards: parseNumber(row["Passing Yards"]),
          passTd: parseNumber(row["Passing TD"]),
          interceptions: parseNumber(row.INT),
          tdToInt: parseNumber(row["TD/INT"]),
          passRating: parseNumber(row["Passer Rating"]),
          rushYards: parseNumber(row["Rushing Yards"]),
          rushTd: parseNumber(row["Rushing TD"]),
          returnTd: parseNumber(row["Return TD"]),
          totalTd: parseNumber(row["Total TD"]),
          catches: parseNumber(row.Catchs),
          targets: parseNumber(row.Targets),
          catchPct: parseNumber(row["Calc Catch%"]),
          recvYards: parseNumber(row["Receiving Yards"]),
          recvTd: parseNumber(row["Receiving TD"]),
          yardsPerCatch: parseNumber(row["Yards/Catch"]),
          tackles: parseNumber(row.Tackles),
          defInt: parseNumber(row["INT.1"]),
          sacks: parseNumber(row.Sacks),
          defTd: parseNumber(row["Def TD"]),
        };
      })
      .filter(Boolean);
  }

  function parseSeasonNumber(label) {
    const match = String(label || "").match(/(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  }

  function formatSeasonLabel(label, kind) {
    const raw = String(label || "").trim();
    if (kind === "all-time") return "All time";
    const match = raw.match(/szn\s*(\d+)/i) || raw.match(/szn(\d+)/i);
    if (match) return `Season ${match[1]}`;
    const numberMatch = raw.match(/season\s*(\d+)/i);
    if (numberMatch) return `Season ${numberMatch[1]}`;
    return raw || "Season";
  }

  function normalizePlayerKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function lookupRosterInfo(name) {
    const key = normalizePlayerKey(name);
    if (!key) return null;
    if (state.rosterLookup?.has(key)) return state.rosterLookup.get(key);
    for (const [raw, info] of state.rosterMap.entries()) {
      if (normalizePlayerKey(raw) === key) return { ...info, name: raw };
    }
    return null;
  }

  function findPlayerSeasonHistory(playerName) {
    const key = normalizePlayerKey(playerName);
    if (!key) return [];
    const records = [];

    (state.seasonStats.order || []).forEach((season) => {
      const seasonRows = state.seasonStats.seasons.get(season) || [];
      const match =
        seasonRows.find((row) => normalizePlayerKey(row.player) === key) ||
        seasonRows.find((row) => normalizePlayerKey(row.player).includes(key));
      if (match) records.push({ ...match, kind: "season" });
    });

    return records;
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
        const { score: mvpScore, defScore } = computeMvpScore(rec, wins, winPct);
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

  function buildRosterLookup(map) {
    const lookup = new Map();
    (map || new Map()).forEach((info, name) => {
      const key = normalizePlayerKey(name);
      if (!key) return;
      lookup.set(key, { ...info, name });
    });
    return lookup;
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

  function computeMvpScore(rec, wins, winPct) {
    const defScore =
      (rec.tackles || 0) + (rec.defInt || 0) * 5 + (rec.sacks || 0) * 4 + (rec.defTd || 0) * 20;
    const completionRate =
      rec.compPct ??
      (rec.attempts ? (((rec.completions || 0) / rec.attempts) * 100 || null) : null);
    const passEfficiency = (rec.passRating || 0) * MVP_WEIGHTS.passEfficiency;
    const accuracyBonus = completionRate != null ? completionRate * MVP_WEIGHTS.accuracy : 0;
    const passingVolume = (rec.yards || 0) * MVP_WEIGHTS.passYards;

    const rushingYards = (rec.rushYards || 0) * MVP_WEIGHTS.skillYards;
    const receivingYards = (rec.recvYards || 0) * MVP_WEIGHTS.skillYards;

    const passTouchdowns = (rec.passTd || 0) * MVP_WEIGHTS.passTouchdown;
    const returnTouchdowns = (rec.returnTd || 0) * MVP_WEIGHTS.returnTouchdown;
    const skillTouchdowns =
      rec.totalTd != null
        ? Math.max(0, rec.totalTd - (rec.returnTd || 0))
        : (rec.rushTd || 0) + (rec.recvTd || 0);
    const scoringImpact = skillTouchdowns * MVP_WEIGHTS.skillTouchdown + passTouchdowns + returnTouchdowns;

    const turnoverPenalty = (rec.interceptions || 0) * MVP_WEIGHTS.turnover;
    const defensiveImpact = defScore * MVP_WEIGHTS.defensive;
    const versatilitySources = [rec.passRating, rec.rushYards, rec.recvYards, defScore].filter(
      (val) => (val ?? 0) > 0
    ).length;
    const versatilityBonus = Math.max(0, versatilitySources - 1) * MVP_WEIGHTS.versatility;
    const winScore =
      (wins || 0) * MVP_WEIGHTS.win + (winPct != null ? winPct * MVP_WEIGHTS.winPct : 0);
    const score =
      passEfficiency +
      accuracyBonus +
      passingVolume +
      rushingYards +
      receivingYards +
      scoringImpact +
      turnoverPenalty +
      defensiveImpact +
      versatilityBonus +
      winScore;

    return { score, defScore };
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

  function formatSeasonPassing(row) {
    const parts = [];
    appendIfValue(parts, `${formatCount(row.completions)} / ${formatCount(row.attempts)} C/A`);
    appendIfValue(parts, `Comp ${formatPct(row.compPct)}`);
    appendIfValue(parts, `${formatCount(row.passYards)} yds`);
    if (row.passTd != null || row.interceptions != null)
      appendIfValue(parts, `${formatCount(row.passTd)} TD / ${formatCount(row.interceptions)} INT`);
    appendIfValue(parts, `PR ${formatScore(row.passRating)}`);
    return joinStatParts(parts);
  }

  function formatSeasonRushing(row) {
    const parts = [];
    appendIfValue(parts, `${formatCount(row.rushYards)} yds`);
    appendIfValue(parts, `${formatCount(row.rushTd)} TD`);
    appendIfValue(parts, `${formatCount(row.returnTd)} RET TD`);
    appendIfValue(parts, `${formatCount(row.totalTd)} Total TD`);
    return joinStatParts(parts);
  }

  function formatSeasonReceiving(row) {
    const parts = [];
    appendIfValue(parts, `${formatCount(row.recvYards)} yds`);
    appendIfValue(parts, `${formatCount(row.recvTd)} TD`);
    if (row.catches != null || row.targets != null)
      appendIfValue(parts, `${formatCount(row.catches)} / ${formatCount(row.targets)} C/T`);
    appendIfValue(parts, `Catch% ${formatPct(row.catchPct)}`);
    appendIfValue(parts, `${formatScore(row.yardsPerCatch)} Y/C`);
    return joinStatParts(parts);
  }

  function formatSeasonDefense(row) {
    const parts = [];
    appendIfValue(parts, `${formatCount(row.tackles)} TAK`);
    appendIfValue(parts, `${formatCount(row.defInt)} INT`);
    appendIfValue(parts, `${formatCount(row.sacks)} SCK`);
    appendIfValue(parts, `${formatCount(row.defTd)} TD`);
    return joinStatParts(parts);
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

  function resolveTeam(raw) {
    const cleaned = String(raw ?? "").trim();
    if (!cleaned) return { displayName: "Team", logoKey: "", canonicalKey: "" };

    const canonical = canonicalTeamKey(cleaned);
    const codeMatch = canonical ? TEAM_CODE_MAP[canonical] : null;
    const displayName = codeMatch?.name || prettifyTeamName(cleaned);
    const logoKey = codeMatch?.logo || (canonical || normalizeTeamKey(displayName));

    return { displayName, logoKey, canonicalKey: canonical || normalizeTeamKey(displayName) };
  }

  function teamPageUrl(teamInfo) {
    const key =
      canonicalTeamKey(teamInfo?.canonicalKey || teamInfo?.logoKey || teamInfo?.displayName) ||
      normalizeTeamKey(teamInfo?.displayName);
    const encoded = encodeURIComponent(key || "");
    return `team.html?team=${encoded}`;
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

  function formatCount(value) {
    if (value == null || Number.isNaN(value)) return "—";
    return Number(value).toLocaleString();
  }

  function parseNumber(val) {
    if (val == null) return null;
    const num = parseFloat(String(val).replace(/[^0-9.-]/g, ""));
    return Number.isNaN(num) ? null : num;
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

  function setPlayerAvatar(el, rec) {
    if (!el) return;
    const roster = lookupRosterInfo(rec?.player || state.playerName);
    const image = rec?.image || roster?.image || null;
    if (image) {
      el.style.backgroundImage = `url('${image}')`;
      el.textContent = "";
      return;
    }

    el.style.backgroundImage = "radial-gradient(circle, rgba(96, 165, 250, 0.12), rgba(168, 85, 247, 0.1))";
    el.textContent = escapeHtml(initials(rec?.player || state.playerName || "P"));
  }

  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function showError(msg) {
    if (els.playerError) {
      els.playerError.hidden = false;
      els.playerError.textContent = msg;
    }
  }
})();
