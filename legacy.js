(() => {
  const LEGACY_WORKBOOK_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQfDvxdXmvl9dMNWi6x5y3XMyl-FjZ6wTdwpP-ZfKTlUyS_FUgRqpGeQs05wAtI1JVnRGzrenQqW6OR/pub?output=xlsx";

  const AWARD_WEIGHTS = { mvp: 14, opoy: 10, dpoy: 10 };
  const RECORD_WEIGHT = 12;
  const TATE_BOWL_WEIGHT = 8;
  const STAT_WEIGHTS = {
    passYards: 12,
    passTd: 10,
    rushYards: 12,
    rushTd: 10,
    recvYards: 10,
    recvTd: 8,
    tackles: 6,
    defInt: 8,
    sacks: 8,
    defTd: 9,
    totalTd: 10,
  };

  const cache = { promise: null, data: null };

  const normalizeName = (value) => String(value || "").trim().toLowerCase();

  function parseNumber(value) {
    if (value == null || value === "") return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  async function fetchArrayBuffer(url) {
    const u = new URL(url, window.location.href);
    u.searchParams.set("_cb", Date.now().toString());
    const res = await fetch(u.toString(), { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  function findSheet(workbook, match) {
    if (!workbook?.SheetNames) return null;
    const name = workbook.SheetNames.find((n) => normalizeName(n) === normalizeName(match));
    return name ? workbook.Sheets[name] : null;
  }

  function parseRecordsSheet(workbook) {
    const sheet = findSheet(workbook, "All Time Records") || workbook.Sheets?.[0];
    if (!sheet || typeof XLSX === "undefined") return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return rows
      .map((row) => ({
        stat: String(row.Stat || row.stat || "").trim(),
        record: parseNumber(row.Record),
        player: String(row.Player || row.player || "").trim(),
        season: row.Season != null ? String(row.Season) : "",
      }))
      .filter((r) => r.stat && r.player);
  }

  function parseTateBowlSheet(workbook) {
    const sheet = findSheet(workbook, "Tate Bowl History");
    if (!sheet || typeof XLSX === "undefined") return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return rows
      .map((row) => ({
        player: String(row.Player || row.player || "").trim(),
        bowl: parseNumber(row["Tate Bowl"]),
        team: String(row.Team || row.team || "").trim(),
      }))
      .filter((r) => r.player && r.bowl != null);
  }

  function parseAwardsHistory(workbook) {
    const sheet = findSheet(workbook, "Awards History");
    if (!sheet || typeof XLSX === "undefined") return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return rows
      .map((row) => ({
        player: String(row.Player || row.player || "").trim(),
        mvp: parseNumber(row["Amount of MVPs"]) || 0,
        opoy: parseNumber(row["Amount of OPOY"]) || 0,
        dpoy: parseNumber(row["Amount of DPOY"]) || 0,
      }))
      .filter((r) => r.player);
  }

  function parseAllTimeStats(workbook) {
    const sheet = findSheet(workbook, "All Time Stats");
    if (!sheet || typeof XLSX === "undefined") return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return rows
      .map((row) => ({
        player: String(row.Player || row.player || "").trim(),
        passYards: parseNumber(row["Passing Yards"]),
        passTd: parseNumber(row["Passing TD"]),
        rushYards: parseNumber(row["Rushing Yards"]),
        rushTd: parseNumber(row["Rushing TD"]),
        recvYards: parseNumber(row["Receiving Yards"]),
        recvTd: parseNumber(row["Receiving TD"]),
        tackles: parseNumber(row.Tackles),
        defInt: parseNumber(row.INT),
        sacks: parseNumber(row.Sacks),
        defTd: parseNumber(row["Def TD"]),
        totalTd: parseNumber(row["Total TD"]),
      }))
      .filter((r) => r.player);
  }

  function parseLegacyWorkbook(buffer) {
    if (typeof XLSX === "undefined") throw new Error("XLSX missing");
    const workbook = XLSX.read(buffer, { type: "array" });
    return {
      records: parseRecordsSheet(workbook),
      tateBowls: parseTateBowlSheet(workbook),
      awards: parseAwardsHistory(workbook),
      stats: parseAllTimeStats(workbook),
    };
  }

  function computeLegacyScores(data) {
    const legacyMap = new Map();
    const ensure = (name) => {
      const key = normalizeName(name);
      if (!key) return null;
      if (!legacyMap.has(key)) {
        legacyMap.set(key, {
          name,
          score: 0,
          awards: { mvp: 0, opoy: 0, dpoy: 0 },
          records: [],
          tateBowls: [],
          statScore: 0,
          highlights: [],
        });
      }
      return legacyMap.get(key);
    };

    (data.awards || []).forEach((entry) => {
      const rec = ensure(entry.player);
      if (!rec) return;
      rec.awards = {
        mvp: entry.mvp || 0,
        opoy: entry.opoy || 0,
        dpoy: entry.dpoy || 0,
      };
      rec.score += (entry.mvp || 0) * AWARD_WEIGHTS.mvp;
      rec.score += (entry.opoy || 0) * AWARD_WEIGHTS.opoy;
      rec.score += (entry.dpoy || 0) * AWARD_WEIGHTS.dpoy;
    });

    (data.records || []).forEach((row) => {
      const rec = ensure(row.player);
      if (!rec) return;
      rec.records.push(row);
      rec.score += RECORD_WEIGHT;
    });

    (data.tateBowls || []).forEach((row) => {
      const rec = ensure(row.player);
      if (!rec) return;
      rec.tateBowls.push(row);
      rec.score += TATE_BOWL_WEIGHT;
    });

    const maxes = {};
    Object.keys(STAT_WEIGHTS).forEach((k) => (maxes[k] = 0));
    (data.stats || []).forEach((row) => {
      Object.keys(STAT_WEIGHTS).forEach((key) => {
        const val = row[key];
        if (val != null && val > (maxes[key] || 0)) maxes[key] = val;
      });
    });

    (data.stats || []).forEach((row) => {
      const rec = ensure(row.player);
      if (!rec) return;
      let statScore = 0;
      Object.entries(STAT_WEIGHTS).forEach(([key, weight]) => {
        const max = maxes[key] || 0;
        const val = row[key] || 0;
        if (max > 0 && val > 0) {
          statScore += (val / max) * weight;
        }
      });
      rec.statScore = Math.round(statScore * 10) / 10;
      rec.score += statScore;
    });

    legacyMap.forEach((rec) => {
      const highlights = [];
      if (rec.awards.mvp) highlights.push(`${rec.awards.mvp} MVP${rec.awards.mvp > 1 ? "s" : ""}`);
      if (rec.awards.opoy) highlights.push(`${rec.awards.opoy} OPOY`);
      if (rec.awards.dpoy) highlights.push(`${rec.awards.dpoy} DPOY`);
      if (rec.records.length) highlights.push(`${rec.records.length} all-time record${rec.records.length > 1 ? "s" : ""}`);
      if (rec.tateBowls.length) highlights.push(`${rec.tateBowls.length} Tate Bowl ring${rec.tateBowls.length > 1 ? "s" : ""}`);
      if (rec.statScore) highlights.push(`Stat score ${rec.statScore}`);
      rec.highlights = highlights;
      rec.tier = legacyTier(rec.score);
      rec.tierKey = (rec.tier || "").toLowerCase().replace(/\s+/g, "-") || "rising";
      rec.label = `${rec.tier} (${Math.round(rec.score)})`;
    });

    const leaderboard = Array.from(legacyMap.values()).sort((a, b) => (b.score || 0) - (a.score || 0));
    return { legacyMap, leaderboard };
  }

  function legacyTier(score) {
    if (score >= 160) return "GOAT";
    if (score >= 120) return "Legend";
    if (score >= 90) return "Icon";
    if (score >= 60) return "Star";
    if (score >= 35) return "Rising";
    return "Prospect";
  }

  async function loadLegacyData() {
    if (cache.data) return cache.data;
    if (!cache.promise) {
      cache.promise = fetchArrayBuffer(LEGACY_WORKBOOK_URL)
        .then((buffer) => {
          const parsed = parseLegacyWorkbook(buffer);
          const scores = computeLegacyScores(parsed);
          cache.data = { ...parsed, ...scores };
          return cache.data;
        })
        .catch((err) => {
          cache.promise = null;
          throw err;
        });
    }
    return cache.promise;
  }

  function getLegacyForPlayer(name) {
    if (!cache.data) return null;
    const key = normalizeName(name);
    return cache.data.legacyMap.get(key) || null;
  }

  window.Legacy = {
    loadLegacyData,
    getLegacyForPlayer,
    normalizeName,
  };
})();
