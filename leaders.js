(() => {
  const STATS_WORKBOOK_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQp0jxVIwA59hH031QxJFBsXdQVIi7fNdPS5Ra2w1lK2UYA08rC0moSSqoKPSFL8BRZFh_hC4cO8ymk/pub?output=xlsx";

  const els = {};
  const state = {
    passing: [],
    rushing: [],
    receiving: [],
    defense: [],
    roster: new Map(),
    rosterLookup: new Map(),
  };

  const LEADER_VIEWS = [
    {
      key: "passing",
      title: "Passing leaders",
      description: "Most productive passers by yards, TDs, and rating.",
      limit: 10,
      columns: [
        { header: "#", type: "rank" },
        { header: "Player", key: "player", type: "player" },
        { header: "Team", key: "team", className: "table__team" },
        { header: "Yds", key: "yards" },
        { header: "TD", key: "passTd" },
        { header: "INT", key: "interceptions" },
        { header: "Rate", key: "passRating", format: (v) => formatNumber(v, 1) },
      ],
      rows: () => state.passing,
      sort: (a, b) =>
        (b.yards ?? -Infinity) - (a.yards ?? -Infinity) ||
        (b.passTd ?? -Infinity) - (a.passTd ?? -Infinity) ||
        (b.passRating ?? -Infinity) - (a.passRating ?? -Infinity) ||
        (a.player || "").localeCompare(b.player || ""),
    },
    {
      key: "rushing",
      title: "Rushing leaders",
      description: "Ground game standouts by yards and touchdowns.",
      limit: 10,
      columns: [
        { header: "#", type: "rank" },
        { header: "Player", key: "player", type: "player" },
        { header: "Team", key: "team", className: "table__team" },
        { header: "Yds", key: "rushYards" },
        { header: "TD", key: "rushTd" },
        { header: "Total TD", key: "totalTd" },
      ],
      rows: () => state.rushing,
      sort: (a, b) =>
        (b.rushYards ?? -Infinity) - (a.rushYards ?? -Infinity) ||
        (b.rushTd ?? -Infinity) - (a.rushTd ?? -Infinity) ||
        (b.totalTd ?? -Infinity) - (a.totalTd ?? -Infinity) ||
        (a.player || "").localeCompare(b.player || ""),
    },
    {
      key: "receiving",
      title: "Receiving leaders",
      description: "Top targets by yardage, scores, and volume.",
      limit: 10,
      columns: [
        { header: "#", type: "rank" },
        { header: "Player", key: "player", type: "player" },
        { header: "Team", key: "team", className: "table__team" },
        { header: "Yds", key: "recvYards" },
        { header: "TD", key: "recvTd" },
        { header: "Catches", key: "catches" },
      ],
      rows: () => state.receiving,
      sort: (a, b) =>
        (b.recvYards ?? -Infinity) - (a.recvYards ?? -Infinity) ||
        (b.recvTd ?? -Infinity) - (a.recvTd ?? -Infinity) ||
        (b.catches ?? -Infinity) - (a.catches ?? -Infinity) ||
        (a.player || "").localeCompare(b.player || ""),
    },
    {
      key: "defense",
      title: "Defensive leaders",
      description: "Disruptors with tackles, sacks, and takeaways.",
      limit: 10,
      columns: [
        { header: "#", type: "rank" },
        { header: "Player", key: "player", type: "player" },
        { header: "Team", key: "team", className: "table__team" },
        { header: "Tackles", key: "tackles" },
        { header: "INT", key: "interceptions" },
        { header: "Sacks", key: "sacks" },
        { header: "Def TD", key: "defTd" },
      ],
      rows: () => state.defense,
      sort: (a, b) =>
        (b.tackles ?? -Infinity) - (a.tackles ?? -Infinity) ||
        (b.sacks ?? -Infinity) - (a.sacks ?? -Infinity) ||
        (b.interceptions ?? -Infinity) - (a.interceptions ?? -Infinity) ||
        (b.defTd ?? -Infinity) - (a.defTd ?? -Infinity) ||
        (a.player || "").localeCompare(b.player || ""),
    },
  ];

  document.addEventListener("DOMContentLoaded", () => {
    cacheEls();
    loadData();
  });

  function cacheEls() {
    els.grid = document.getElementById("leadersGrid");
    els.loading = document.getElementById("leadersLoading");
    els.error = document.getElementById("leadersError");
    els.empty = document.getElementById("leadersEmpty");
    els.status = document.getElementById("leadersStatus");
  }

  async function loadData() {
    showLoading(true);
    hideError();
    try {
      const buffer = await fetchArrayBuffer(STATS_WORKBOOK_URL);
      const workbook = parseWorkbook(buffer);
      state.passing = workbook.passing;
      state.rushing = workbook.rushing;
      state.receiving = workbook.receiving;
      state.defense = workbook.defense;
      state.roster = workbook.roster;
      state.rosterLookup = buildRosterLookup(workbook.roster);
      render();
      if (els.status) els.status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      console.error(err);
      showError("Unable to load stat workbook right now.");
    } finally {
      showLoading(false);
    }
  }

  function render() {
    if (!els.grid) return;
    els.grid.innerHTML = "";
    const cards = LEADER_VIEWS.map((view) => buildCard(view)).filter(Boolean);
    if (!cards.length) {
      if (els.empty) els.empty.hidden = false;
      if (els.grid) els.grid.hidden = true;
      return;
    }
    if (els.empty) els.empty.hidden = true;
    cards.forEach((card) => els.grid.appendChild(card));
    els.grid.hidden = false;
  }

  function buildCard(view) {
    const rows = view.rows?.() || [];
    if (!rows.length) return null;
    const sorted = [...rows].sort(view.sort).slice(0, view.limit || rows.length);
    const card = document.createElement("div");
    card.className = "leader-card";
    const header = document.createElement("div");
    header.className = "leader-card__header";
    const title = document.createElement("div");
    title.className = "leader-card__title";
    title.textContent = view.title;
    const subtitle = document.createElement("div");
    subtitle.className = "leader-card__subtitle";
    subtitle.textContent = view.description;
    header.appendChild(title);
    header.appendChild(subtitle);
    card.appendChild(header);

    const table = document.createElement("table");
    table.className = "table table--compact leader-card__table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    view.columns.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.header;
      if (col.className) th.classList.add(col.className);
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    sorted.forEach((row, idx) => {
      const tr = document.createElement("tr");
      view.columns.forEach((col) => {
        const td = document.createElement("td");
        if (col.type === "rank") {
          td.textContent = idx + 1;
        } else if (col.type === "player") {
          td.innerHTML = renderPlayerCell(row.player, row.team);
        } else {
          const val = row[col.key];
          td.textContent = col.format ? col.format(val) : formatNumber(val);
        }
        if (col.className) td.classList.add(col.className);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);

    return card;
  }

  function parseWorkbook(buffer) {
    if (typeof XLSX === "undefined") throw new Error("XLSX missing");
    const workbook = XLSX.read(buffer, { type: "array" });
    return {
      passing: parsePassingSheet(workbook),
      rushing: parseRushingSheet(workbook),
      receiving: parseReceivingSheet(workbook),
      defense: parseDefenseSheet(workbook),
      roster: parseRosterSheet(workbook),
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
      map.set(player, { team: team || "Inactive", image: imageUrl || null });
    });
    return map;
  }

  function renderPlayerCell(name, teamKey) {
    const roster = lookupRoster(name);
    const team = roster?.team || teamKey || "—";
    const link = document.createElement("a");
    link.className = "team-link team-link--block";
    link.href = playerPageUrl(name, team);
    link.textContent = name || "Player";
    const meta = document.createElement("div");
    meta.className = "details";
    meta.textContent = team;
    const body = document.createElement("div");
    body.appendChild(link);
    body.appendChild(meta);
    const wrapper = document.createElement("div");
    wrapper.className = "player";
    wrapper.insertAdjacentHTML("afterbegin", playerAvatar(name, roster?.image));
    wrapper.appendChild(body);
    return wrapper.outerHTML;
  }

  function playerAvatar(name, image) {
    const hasImage = Boolean(image);
    const div = document.createElement("div");
    div.className = `player__avatar player__avatar--sm${hasImage ? " player__avatar--photo" : ""}`;
    if (hasImage) {
      div.style.backgroundImage = `url('${image}')`;
    } else {
      div.textContent = initials(name);
    }
    return div.outerHTML;
  }

  function initials(name) {
    return String(name || "P")
      .split(" ")
      .filter(Boolean)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
  }

  function playerPageUrl(playerName, teamKey) {
    const encodedName = encodeURIComponent(playerName || "");
    const team = teamKey ? `&team=${encodeURIComponent(teamKey)}` : "";
    return `player.html?name=${encodedName}${team}`;
  }

  function lookupRoster(name) {
    const norm = normalizePlayerKey(name);
    if (!norm) return null;
    return state.roster.get(name) || state.rosterLookup.get(norm) || null;
  }

  function normalizePlayerKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
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

  function formatNumber(value, decimals) {
    if (value == null || value === "") return "—";
    const n = Number(value);
    if (!Number.isFinite(n)) return escapeHtml(String(value));
    if (typeof decimals === "number") return n.toFixed(decimals);
    return n.toLocaleString();
  }

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

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function showLoading(isLoading) {
    if (els.loading) els.loading.hidden = !isLoading;
  }

  function showError(message) {
    if (els.error) {
      els.error.textContent = message || "Unable to load data.";
      els.error.hidden = false;
    }
  }

  function hideError() {
    if (els.error) els.error.hidden = true;
  }
})();
