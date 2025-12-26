(() => {
  const MVP_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQp0jxVIwA59hH031QxJFBsXdQVIi7fNdPS5Ra2w1lK2UYA08rC0moSSqoKPSFL8BRZFh_hC4cO8ymk/pub?output=xlsx";

  const els = {};
  const state = {
    records: [],
    awards: [],
    tateBowls: [],
    legacy: [],
    rosterMap: new Map(),
    rosterLookup: new Map(),
  };

  document.addEventListener("DOMContentLoaded", () => {
    cacheEls();
    attachTabHandlers();
    loadData();
  });

  function cacheEls() {
    els.status = document.getElementById("recordsStatus");
    els.recordsTableBody = document.getElementById("recordsTableBody");
    els.recordsEmpty = document.getElementById("recordsEmpty");
    els.legacyTableBody = document.getElementById("legacyTableBody");
    els.legacyEmpty = document.getElementById("legacyEmpty");
    els.awardsTableBody = document.getElementById("awardsTableBody");
    els.awardsEmpty = document.getElementById("awardsEmpty");
    els.tateTableBody = document.getElementById("tateTableBody");
    els.tateEmpty = document.getElementById("tateEmpty");
    els.tabs = document.getElementById("recordsTabs");
    els.panes = document.querySelectorAll(".records-pane");
  }

  function attachTabHandlers() {
    if (!els.tabs) return;
    els.tabs.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-pane]");
      if (!btn) return;
      const target = btn.dataset.pane;
      els.tabs.querySelectorAll("[data-pane]").forEach((node) => node.classList.remove("pill--active"));
      btn.classList.add("pill--active");
      els.panes.forEach((pane) => {
        const paneKey = pane.dataset.pane;
        pane.classList.toggle("records-pane--active", paneKey === target);
      });
    });
  }

  async function loadData() {
    try {
      if (!window.Legacy?.loadLegacyData) throw new Error("Legacy loader missing");
      const [data, roster] = await Promise.all([window.Legacy.loadLegacyData(), fetchRoster()]);
      state.records = data.records || [];
      state.awards = data.awards || [];
      state.tateBowls = data.tateBowls || [];
      state.legacy = data.leaderboard || [];
      state.rosterMap = roster.map;
      state.rosterLookup = roster.lookup;
      renderRecords();
      renderLegacy();
      renderAwards();
      renderTate();
      if (els.status) els.status.textContent = `Updated ${new Date().toLocaleTimeString()}`;
    } catch (err) {
      console.error(err);
      if (els.status) els.status.textContent = "Error loading records";
    }
  }

  function renderRecords() {
    if (!els.recordsTableBody) return;
    els.recordsTableBody.innerHTML = "";
    if (!state.records.length) {
      if (els.recordsEmpty) els.recordsEmpty.hidden = false;
      return;
    }
    if (els.recordsEmpty) els.recordsEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    state.records.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.stat)}</td>
        <td>${formatNumber(row.record)}</td>
        <td>${renderPlayerCell(row.player)}</td>
        <td>${formatSeason(row.season)}</td>
      `;
      frag.appendChild(tr);
    });
    els.recordsTableBody.appendChild(frag);
  }

  function renderLegacy() {
    if (!els.legacyTableBody) return;
    els.legacyTableBody.innerHTML = "";
    if (!state.legacy.length) {
      if (els.legacyEmpty) els.legacyEmpty.hidden = false;
      return;
    }
    if (els.legacyEmpty) els.legacyEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    state.legacy.slice(0, 50).forEach((row, idx) => {
      const tr = document.createElement("tr");
      const score = row.roundedScore ?? Math.round(row.score ?? 0);
      const roster = lookupRoster(row.name);
      const highlights = row.highlights || [];
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>
          <div class="player">
            ${playerAvatar(row.name, roster?.image)}
            <div>
              <div class="player__name">${escapeHtml(row.name)}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="legacy-chip legacy-chip--${escapeHtml(row.tierKey || "prospect")}">
            <span class="legacy-chip__tier">${escapeHtml(row.tier || "Legacy")}</span>
            <span class="legacy-chip__score">${formatNumber(score)}</span>
          </div>
        </td>
        <td>${escapeHtml(highlights.join(" • ") || "—")}</td>
      `;
      frag.appendChild(tr);
    });
    els.legacyTableBody.appendChild(frag);
  }

  function renderAwards() {
    if (!els.awardsTableBody) return;
    els.awardsTableBody.innerHTML = "";
    if (!state.awards.length) {
      if (els.awardsEmpty) els.awardsEmpty.hidden = false;
      return;
    }
    if (els.awardsEmpty) els.awardsEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    state.awards.forEach((row) => {
      const total = (row.mvp || 0) + (row.opoy || 0) + (row.dpoy || 0);
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.player)}</td>
        <td>${formatNumber(row.mvp)}</td>
        <td>${formatNumber(row.opoy)}</td>
        <td>${formatNumber(row.dpoy)}</td>
        <td>${formatNumber(total)}</td>
      `;
      frag.appendChild(tr);
    });
    els.awardsTableBody.appendChild(frag);
  }

  function renderTate() {
    if (!els.tateTableBody) return;
    els.tateTableBody.innerHTML = "";
    if (!state.tateBowls.length) {
      if (els.tateEmpty) els.tateEmpty.hidden = false;
      return;
    }
    if (els.tateEmpty) els.tateEmpty.hidden = true;
    const frag = document.createDocumentFragment();
    state.tateBowls.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.player)}</td>
        <td>${formatNumber(row.bowl)}</td>
        <td>${row.team ? escapeHtml(row.team) : "—"}</td>
      `;
      frag.appendChild(tr);
    });
    els.tateTableBody.appendChild(frag);
  }

  function formatNumber(value) {
    if (value == null || value === "") return "—";
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : escapeHtml(String(value));
  }

  function formatSeason(value) {
    if (value == null || value === "") return "—";
    const num = Number(value);
    if (Number.isFinite(num)) return `Season ${num}`;
    return escapeHtml(String(value));
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  async function fetchRoster() {
    const buffer = await fetchArrayBuffer(MVP_CSV_URL);
    return parseRosterSheet(buffer);
  }

  async function fetchArrayBuffer(url) {
    const u = new URL(url, window.location.href);
    u.searchParams.set("_cb", Date.now().toString());
    const res = await fetch(u.toString(), { method: "GET", cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  function parseRosterSheet(buffer) {
    if (typeof XLSX === "undefined") throw new Error("XLSX missing");
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames.find((n) => n.toLowerCase().includes("roster"));
    const map = new Map();
    const lookup = new Map();
    if (!sheetName) return { map, lookup };
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
      const info = { team, image: imageUrl || null };
      map.set(player, info);
      const norm = normalizePlayerKey(player);
      if (norm) lookup.set(norm, { ...info, name: player });
    });
    return { map, lookup };
  }

  function normalizePlayerKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function lookupRoster(name) {
    const norm = normalizePlayerKey(name);
    if (!norm) return null;
    return state.rosterMap.get(name) || state.rosterLookup.get(norm) || null;
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

  function playerPageUrl(playerName, teamKey) {
    const encodedName = encodeURIComponent(playerName || "");
    const team = teamKey ? `&team=${encodeURIComponent(teamKey)}` : "";
    return `player.html?name=${encodedName}${team}`;
  }

  function renderPlayerCell(playerName) {
    const roster = lookupRoster(playerName);
    const link = document.createElement("a");
    link.className = "team-link team-link--block";
    link.href = playerPageUrl(playerName, roster?.team);
    link.textContent = playerName || "Player";

    const body = document.createElement("div");
    body.appendChild(link);
    if (roster?.team) {
      const meta = document.createElement("div");
      meta.className = "details";
      meta.textContent = roster.team;
      body.appendChild(meta);
    }

    const wrapper = document.createElement("div");
    wrapper.className = "player";
    wrapper.insertAdjacentHTML("afterbegin", playerAvatar(playerName, roster?.image));
    wrapper.appendChild(body);

    return wrapper.outerHTML;
  }
})();
