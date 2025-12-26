(() => {
  const els = {};
  const state = {
    records: [],
    awards: [],
    tateBowls: [],
    legacy: [],
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
      const data = await window.Legacy.loadLegacyData();
      state.records = data.records || [];
      state.awards = data.awards || [];
      state.tateBowls = data.tateBowls || [];
      state.legacy = data.leaderboard || [];
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
        <td>${escapeHtml(row.player)}</td>
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
      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>
          <div class="player">
            <div class="player__avatar player__avatar--sm" aria-hidden="true">${(idx + 1) <= 3 ? "⭐" : "🏈"}</div>
            <div>
              <div class="player__name">${escapeHtml(row.name)}</div>
              <div class="details">${row.highlights.map(escapeHtml).join(" • ") || "Impact incoming"}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="legacy-chip legacy-chip--${escapeHtml(row.tierKey || "prospect")}">
            <span class="legacy-chip__tier">${escapeHtml(row.tier || "Legacy")}</span>
            <span class="legacy-chip__score">${formatNumber(row.score)}</span>
          </div>
        </td>
        <td>${escapeHtml(row.highlights.join(" • ") || "—")}</td>
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
})();
