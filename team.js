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

  const STANDINGS_ALIASES = {
    lou: "lou",
    cards: "lou",
    cardinals: "lou",
    "louisville cardinals": "lou",
    was: "was",
    redskins: "was",
    "washington redskins": "was",
    dal: "dal",
    cowboys: "dal",
    "dallas cowboys": "dal",
    ne: "ne",
    patriots: "ne",
    "new england patriots": "ne",
    buf: "buf",
    bills: "buf",
    "buffalo bills": "buf",
    bal: "bal",
    ravens: "bal",
    "baltimore ravens": "bal",
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

  const state = {
    teamKey: null,
    teamInfo: null,
    standings: [],
    standingsLookup: new Map(),
    rosterMap: new Map(),
    playersByTeam: new Map(),
    scheduleGames: [],
    logoExistCache: new Map(),
    legacyMap: new Map(),
    legacyPromise: null,
  };

  const els = {};

  document.addEventListener("DOMContentLoaded", () => {
    cacheEls();
    const params = new URLSearchParams(window.location.search);
    const teamParam = params.get("team") || "";
    const canonical = canonicalTeamKey(teamParam) || normalizeTeamKey(teamParam);
    if (!canonical) return showError("Team not found. Try opening from the main dashboard.");

    state.teamKey = canonical;
    state.teamInfo = resolveTeam(teamParam);
    renderHero();
    loadData();
  });

  async function loadData() {
    try {
      await Promise.all([fetchMvp(), fetchSchedule()]);
      renderPage();
    } catch (err) {
      console.error(err);
      showError("Unable to load team data. Please try again.");
    }
  }

  function cacheEls() {
    els.teamName = document.getElementById("teamName");
    els.teamLogo = document.getElementById("teamLogo");
    els.teamMeta = document.getElementById("teamMeta");
    els.teamHardware = document.getElementById("teamHardware");
    els.teamHardwareEmpty = document.getElementById("teamHardwareEmpty");
    els.teamTotals = document.getElementById("teamTotals");
    els.teamRoster = document.getElementById("teamRoster");
    els.teamRosterEmpty = document.getElementById("teamRosterEmpty");
    els.teamSchedule = document.getElementById("teamSchedule");
    els.teamScheduleEmpty = document.getElementById("teamScheduleEmpty");
    els.teamError = document.getElementById("teamError");
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

  async function ensureLegacyData() {
    if (!window.Legacy?.loadLegacyData) return null;
    if (state.legacyMap?.size) return state.legacyMap;
    if (!state.legacyPromise) {
      state.legacyPromise = window.Legacy.loadLegacyData().then((data) => {
        state.legacyMap = data.legacyMap || new Map();
        state.legacyPromise = null;
        return state.legacyMap;
      }).catch((err) => {
        console.error("[legacy]", err);
        state.legacyPromise = null;
        return null;
      });
    }
    return state.legacyPromise;
  }

  function lookupLegacy(name) {
    if (!state.legacyMap?.size) return null;
    const key = normalizePlayerKey(name);
    if (!key) return null;
    return state.legacyMap.get(key) || null;
  }

  function annotateLegacy(records) {
    if (!records?.length) return records;
    return records.map((rec) => {
      const legacy = lookupLegacy(rec.player);
      if (!legacy) return rec;
      return {
        ...rec,
        legacyScore: legacy.roundedScore ?? Math.round(legacy.score ?? 0),
        legacyTier: legacy.tier,
        legacyTierKey: legacy.tierKey,
        legacyHighlights: legacy.highlights || [],
      };
    });
  }

  async function fetchMvp() {
    const buffer = await fetchArrayBuffer(MVP_CSV_URL);
    const { mvpRecords, standings, roster } = parseMvpWorkbook(buffer);
    await ensureLegacyData();
    const enriched = annotateLegacy(mvpRecords);
    state.rosterMap = roster;
    state.standings = standings;
    state.standingsLookup = buildStandingsLookup(standings);
    state.playersByTeam = buildPlayersByTeam(enriched);
  }

  async function fetchSchedule() {
    const text = await fetchText(SCHEDULE_CSV_URL);
    state.scheduleGames = parseScheduleCSV(text);
  }

  function renderPage() {
    const standing = lookupStanding(state.standingsLookup, state.teamKey) ||
      lookupStanding(state.standingsLookup, state.teamInfo.displayName);
    const players =
      state.playersByTeam.get(state.teamKey) ||
      state.playersByTeam.get(normalizeTeamKey(state.teamInfo.displayName)) ||
      [];

    renderHero(standing);
    renderHardware(players);
    renderTotals(players, standing);
    renderRoster(players, standing);
    renderSchedule(state.scheduleGames);
  }

  function renderHero(standing) {
    if (els.teamName) els.teamName.textContent = state.teamInfo.displayName;
    if (els.teamLogo) setLogo(els.teamLogo, state.teamInfo.logoKey);

    if (!els.teamMeta) return;
    const metaParts = [];
    if (standing) metaParts.push(formatRecord(standing));
    if (standing?.winPct != null) metaParts.push(`Win% ${formatPct(standing.winPct)}`);
    metaParts.push(`Page refreshed ${new Date().toLocaleTimeString()}`);
    els.teamMeta.textContent = metaParts.join(" • ");
  }

  function renderTotals(players, standing) {
    if (!els.teamTotals) return;
    els.teamTotals.innerHTML = "";
    const totals = computeTeamTotals(players);
    const cards = [];

    cards.push({ label: "Record", value: standing ? formatRecord(standing) : "—" });
    cards.push({ label: "Win%", value: standing?.winPct != null ? formatPct(standing.winPct) : "—" });
    if (standing?.points != null) cards.push({ label: "League Points", value: formatCount(standing.points) });
    if (standing?.plusMinus != null) cards.push({ label: "Point Diff", value: formatSigned(standing.plusMinus) });

    cards.push({ label: "Offense yards", value: formatCount(totals.offenseYards) });
    cards.push({ label: "Pass yards", value: formatCount(totals.passYards) });
    cards.push({ label: "Rush yards", value: formatCount(totals.rushYards) });
    cards.push({ label: "Receiving yards", value: formatCount(totals.recvYards) });
    cards.push({ label: "Total TD", value: formatCount(totals.totalTd) });
    cards.push({ label: "Passing TD", value: formatCount(totals.passTd) });
    cards.push({ label: "Rushing TD", value: formatCount(totals.rushTd) });
    cards.push({ label: "Return TD", value: formatCount(totals.returnTd) });
    cards.push({ label: "Def INT", value: formatCount(totals.defInt) });
    cards.push({ label: "Sacks", value: formatCount(totals.sacks) });
    cards.push({ label: "Tackles", value: formatCount(totals.tackles) });

    const frag = document.createDocumentFragment();
    cards.forEach((card) => {
      const div = document.createElement("div");
      div.className = "team-stat-card";
      div.innerHTML = `
        <div class="team-stat-card__label">${card.label}</div>
        <div class="team-stat-card__value">${card.value}</div>
      `;
      frag.appendChild(div);
    });

    els.teamTotals.appendChild(frag);
  }

  function renderRoster(players, standing) {
    if (!els.teamRoster) return;
    els.teamRoster.innerHTML = "";

    if (!players.length) {
      if (els.teamRosterEmpty) els.teamRosterEmpty.hidden = false;
      return;
    }
    if (els.teamRosterEmpty) els.teamRosterEmpty.hidden = true;

    const frag = document.createDocumentFragment();
    players.forEach((player) => {
      const card = document.createElement("div");
      card.className = "team-roster__card";
      const statLines = buildPlayerStatLines(player)
        .map((line) => `${line.label}: ${line.value}`)
        .join(" • ");
      const playerKey = encodeURIComponent(player.player || "");
      const teamParam = encodeURIComponent(state.teamKey || "");
      const legacyBadge = buildLegacyBadge(player);
      const badgeContent = legacyBadge || `MVP ${formatScore(player.mvpScore)}`;
      const badgeClass = legacyBadge ? "team-roster__badge team-roster__badge--legacy" : "team-roster__badge";
      card.innerHTML = `
        <div class="team-roster__header">
          ${playerAvatar(player)}
          <div>
            <a class="team-link team-link--block" href="player.html?name=${playerKey}&team=${teamParam}">
              <div class="team-roster__name">${escapeHtml(player.player)}</div>
            </a>
            <div class="team-roster__meta">MVP ${formatScore(player.mvpScore)} • Win% ${formatPct(player.winPct)}</div>
            ${playerBadges(player)}
          </div>
          <div class="${badgeClass}">
            ${badgeContent}
          </div>
        </div>
        <div class="team-roster__statline">${statLines || "No stat line yet"}</div>
      `;
      frag.appendChild(card);
    });

    els.teamRoster.appendChild(frag);
  }

  function renderSchedule(games) {
    if (!els.teamSchedule) return;
    els.teamSchedule.innerHTML = "";
    const targetKey = state.teamKey;
    const filtered = (games || []).filter((g) => teamInGame(g, targetKey));

    if (!filtered.length) {
      if (els.teamScheduleEmpty) els.teamScheduleEmpty.hidden = false;
      return;
    }
    if (els.teamScheduleEmpty) els.teamScheduleEmpty.hidden = true;

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

      const previewLink = document.createElement("a");
      previewLink.className = "team-pill";
      previewLink.href = gamePreviewUrl(game);
      previewLink.textContent = "Preview";
      meta.appendChild(previewLink);

      card.appendChild(matchup);
      card.appendChild(meta);
      frag.appendChild(card);
    });

    els.teamSchedule.appendChild(frag);
  }

  function renderHardware(players) {
    if (!els.teamHardware) return;
    els.teamHardware.innerHTML = "";
    const awardsMap = new Map();

    const addAward = (award) => {
      if (!award) return;
      if (!awardsMap.has(award.id)) awardsMap.set(award.id, { ...award, recipients: [] });
      const entry = awardsMap.get(award.id);
      (award.recipients || []).forEach((r) => entry.recipients.push(r));
    };

    const teamAwards = (window.listHardwareForTeam?.(state.teamInfo.displayName, normalizeTeamKey) || []);
    teamAwards.forEach(addAward);

    players.forEach((player) => {
      const playerAwards = window.listHardwareForPlayer?.(player.player) || [];
      playerAwards.forEach(addAward);
    });

    const awards = Array.from(awardsMap.values());
    if (!awards.length) {
      if (els.teamHardwareEmpty) els.teamHardwareEmpty.hidden = false;
      return;
    }
    if (els.teamHardwareEmpty) els.teamHardwareEmpty.hidden = true;

    const frag = document.createDocumentFragment();
    awards.forEach((award) => {
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

    els.teamHardware.appendChild(frag);
  }

  function playerBadges(player) {
    const badges = [];

    const awards = window.listHardwareForPlayer?.(player.player) || [];
    const hardwareBadges = awards
      .filter((award) => award.recipients && award.recipients.length)
      .map(
        (award) => `
      <div class="player-badge">
        <div class="player-badge__icon" style="background-image:url('${escapeHtml(award.image)}')"></div>
        <span>${escapeHtml(award.name)}</span>
      </div>`
      );

    badges.push(...hardwareBadges);
    if (!badges.length) return "";
    return `<div class="team-roster__badges">${badges.join("")}</div>`;
  }

  function buildLegacyBadge(player) {
    const legacy = lookupLegacy(player.player);
    if (!legacy) return "";
    const title = legacy.highlights?.length ? legacy.highlights.join(" • ") : "Legacy impact";
    const score = legacy.roundedScore ?? Math.round(legacy.score ?? 0);
    return `<div class="legacy-chip legacy-chip--${escapeHtml(legacy.tierKey || "prospect")}" title="${escapeHtml(title)}">
        <span class="legacy-chip__tier">${escapeHtml(legacy.tier || "Legacy")}</span>
        <span class="legacy-chip__score">${score}</span>
      </div>`;
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
      add("totalTd", p.totalTd ?? (p.passTd || 0) + (p.rushTd || 0) + (p.recvTd || 0) + (p.returnTd || 0));
      add("tackles", p.tackles);
      add("sacks", p.sacks);
      add("defInt", p.defInt);
    });

    totals.offenseYards = totals.passYards + totals.rushYards + totals.recvYards;
    return totals;
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

        const gameCodeRaw = String(pick(r, ["game code", "gamecode", "code"]))
          .trim()
          .replace(/\s+/g, " ");
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
          gameCode,
          gameCodeRaw,
          complete,
          startTime,
          scoreHome,
          scoreAway,
        };
      })
      .filter(Boolean);
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

  function gamePreviewUrl(game) {
    const code = normalizeGameCode(game?.gameCode || game?.gameCodeRaw);
    if (code) return `preview.html?game=${encodeURIComponent(code)}`;
    return `preview.html?game=${encodeURIComponent(buildGameSlug(game))}`;
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
    const alias = STANDINGS_ALIASES[norm];
    if (alias && map.has(alias)) return map.get(alias);
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
    if (STANDINGS_ALIASES[norm]) return primaryTeamKey(STANDINGS_ALIASES[norm]);
    return norm;
  }

  function normalizeTeamKey(name) {
    return String(name || "")
      .trim()
      .toLowerCase();
  }

  function normalizePlayerKey(name) {
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

  function formatSigned(value) {
    if (value == null || Number.isNaN(value)) return "—";
    const rounded = Number.isInteger(value) ? value : Number(value).toFixed(1);
    return value > 0 ? `+${rounded}` : String(rounded);
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

  function showError(msg) {
    if (els.teamError) {
      els.teamError.hidden = false;
      els.teamError.textContent = msg;
    }
  }

  function logoPath(file) {
    return `logos/${file}`;
  }

  async function logoExists(file) {
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
    const base = file;
    const lower = file.toLowerCase();
    const upperFirst = file.length > 0 ? file[0].toUpperCase() + file.slice(1) : file;
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
})();
