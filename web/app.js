(() => {
  const MATCHUP_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQsmXFNV0/pub?output=csv';
  const MVP_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQsmXO8ymk/pub?output=csv';
  const POLL_MS = 30000; // avoid numeric separators for older browsers
  const MIN_DISPLAY_PROB = 0.01;
  const MAX_DISPLAY_PROB = 0.99;
  const SMOOTH_WINDOW = 5;
  const MOMENTUM_THRESHOLD = 0.025;
  const BIG_SWING_THRESHOLD = 0.12;

  const LOGO_MAP = {
    cards: 'Cards.png',
    cardinals: 'Cards.png',
    'arizona cardinals': 'Cards.png',
    bengals: 'bengals.png',
    'cincinnati bengals': 'bengals.png',
    '49ers': 'Sanfran.png',
    niners: 'Sanfran.png',
    sanfran: 'Sanfran.png',
    'san fran': 'Sanfran.png',
    'san francisco': 'Sanfran.png',
    'san francisco 49ers': 'Sanfran.png',
    cowboys: 'cowboys.png',
    'dallas cowboys': 'cowboys.png',
    giants: 'giants.png',
    'new york giants': 'giants.png',
  };

  const state = {
    chart: null,
    baseline: null,
    matchupLoading: true,
    matchupError: false,
    mvpLoading: true,
    mvpError: false,
    sort: { key: 'mvpScore', dir: 'desc' },
  };

  const els = {};
  const coalesce = (...values) => {
    for (let i = 0; i < values.length; i++) {
      if (values[i] !== undefined && values[i] !== null && values[i] !== '') return values[i];
    }
    return null;
  };

  document.addEventListener('DOMContentLoaded', () => {
    cacheEls();
    initTabs();
    initChart();
    fetchMatchup();
    fetchMvp();
    setInterval(fetchMatchup, POLL_MS);
    setInterval(fetchMvp, POLL_MS);
  });

  function cacheEls() {
    els.gameStatus = document.getElementById('gameStatus');
    els.pillRow = document.getElementById('pillRow');
    els.pregameTag = document.getElementById('pregameTag');
    els.teamAName = document.getElementById('teamAName');
    els.teamBName = document.getElementById('teamBName');
    els.teamALogo = document.getElementById('teamALogo');
    els.teamBLogo = document.getElementById('teamBLogo');
    els.teamARecord = document.getElementById('teamARecord');
    els.teamBRecord = document.getElementById('teamBRecord');
    els.teamAScore = document.getElementById('teamAScore');
    els.teamBScore = document.getElementById('teamBScore');
    els.possession = document.getElementById('possession');
    els.quarter = document.getElementById('quarter');
    els.clock = document.getElementById('clock');
    els.downDistance = document.getElementById('downDistance');
    els.ytg = document.getElementById('ytg');
    els.lastUpdate = document.getElementById('lastUpdate');
    els.teamListChip = document.getElementById('teamListChip');
    els.momentumValue = document.getElementById('momentumValue');
    els.swingValue = document.getElementById('swingValue');
    els.clutchValue = document.getElementById('clutchValue');
    els.baselineValue = document.getElementById('baselineValue');
    els.winLoading = document.getElementById('winLoading');
    els.winError = document.getElementById('winError');
    els.mvpLoading = document.getElementById('mvpLoading');
    els.mvpError = document.getElementById('mvpError');
    els.mvpEmpty = document.getElementById('mvpEmpty');
    els.mvpTableBody = document.getElementById('mvpTableBody');
    els.mvpStatus = document.getElementById('mvpStatus');
  }

  function initTabs() {
    const navItems = Array.from(document.querySelectorAll('.nav__item'));
    const tabs = {
      win: document.getElementById('tab-win'),
      mvp: document.getElementById('tab-mvp'),
    };

    function setTab(tab) {
      Object.values(tabs).forEach((el) => el.classList.remove('tab--active'));
      navItems.forEach((el) => el.classList.remove('nav__item--active'));
      const key = tab === 'mvp' ? 'mvp' : 'win';
      tabs[key].classList.add('tab--active');
      const navItem = navItems.find((el) => el.dataset.tab === key);
      if (navItem) navItem.classList.add('nav__item--active');
      window.location.hash = `#${key}`;
    }

    navItems.forEach((el) =>
      el.addEventListener('click', (e) => {
        e.preventDefault();
        setTab(el.dataset.tab);
      })
    );

    window.addEventListener('hashchange', () => {
      const tab = window.location.hash.replace('#', '') || 'win';
      setTab(tab);
    });

    const initial = window.location.hash.replace('#', '') || 'win';
    setTab(initial);
  }

  function initChart() {
    const ctx = document.getElementById('winProbChart');
    const gradientA = ctx.getContext('2d').createLinearGradient(0, 0, 0, 320);
    gradientA.addColorStop(0, 'rgba(96,165,250,0.4)');
    gradientA.addColorStop(1, 'rgba(96,165,250,0.05)');

    const gradientB = ctx.getContext('2d').createLinearGradient(0, 0, 0, 320);
    gradientB.addColorStop(0, 'rgba(168,85,247,0.4)');
    gradientB.addColorStop(1, 'rgba(168,85,247,0.05)');

    const baselinePlugin = {
      id: 'baselineMarker',
      afterDatasetsDraw(chart) {
        if (state.baseline == null) return;
        const {
          ctx,
          chartArea: { left, right, width },
          scales: { y },
        } = chart;
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.25)';
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
          const last = meta.data[meta.data.length - 1];
          if (!last) return;
          ctx.fillStyle = ds.borderColor;
          ctx.beginPath();
          ctx.arc(last.x, last.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = 'rgba(0,0,0,0.6)';
          ctx.stroke();
        });
        ctx.restore();
      },
    };

    state.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Team A',
            data: [],
            tension: 0.35,
            fill: true,
            borderColor: 'rgba(96,165,250,1)',
            backgroundColor: gradientA,
            pointRadius: 0,
            borderWidth: 3,
          },
          {
            label: 'Team B',
            data: [],
            tension: 0.35,
            fill: true,
            borderColor: 'rgba(168,85,247,1)',
            backgroundColor: gradientB,
            pointRadius: 0,
            borderWidth: 3,
          },
        ],
      },
      options: {
        responsive: true,
        animation: false,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#e5e7eb' },
          },
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
            ticks: { color: '#9ca3af', maxRotation: 0 },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
          y: {
            min: 0,
            max: 100,
            ticks: { color: '#9ca3af', callback: (val) => `${val}%` },
            grid: { color: 'rgba(255,255,255,0.05)' },
          },
        },
      },
      plugins: [baselinePlugin],
    });
  }

  async function fetchMatchup() {
    setLoading(els.winLoading, true);
    toggleError(els.winError, false);
    const url = overrideUrl('matchup') || MATCHUP_CSV_URL;
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('Failed to load matchup CSV');
      const text = await res.text();
      const parsed = parseMatchupCSV(text);
      if (!parsed.snapshots.length) throw new Error('No matchup rows');
      renderMatchup(parsed);
      state.matchupLoading = false;
      setLoading(els.winLoading, false);
    } catch (err) {
      console.error(err);
      toggleError(els.winError, true);
      if (state.matchupLoading) {
        const fallback = buildSampleMatchup();
        renderMatchup(fallback);
        state.matchupLoading = false;
      }
    }
  }

  async function fetchMvp() {
    setLoading(els.mvpLoading, true);
    toggleError(els.mvpError, false);
    const url = overrideUrl('mvp') || MVP_CSV_URL;
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error('Failed to load MVP CSV');
      const text = await res.text();
      const records = parseMvpCSV(text);
      renderMvp(records);
      setLoading(els.mvpLoading, false);
      state.mvpError = false;
      state.mvpLoading = false;
    } catch (err) {
      console.error(err);
      toggleError(els.mvpError, true);
      if (!state.mvpLoading) return;
      const fallback = buildSampleMvp();
      renderMvp(fallback);
      state.mvpLoading = false;
    }
  }

  function parseMatchupCSV(text) {
    const rows = d3.csvParseRows(text).filter((r) => r.some((c) => (c || '').trim() !== ''));
    if (!rows.length) return { snapshots: [], teamA: 'Team A', teamB: 'Team B', teams: [] };
    const header = rows[0].map((c) => c.trim());
    const dataRows = rows.slice(1).map((row) => ({
      raw: row,
      map: Object.fromEntries(header.map((h, idx) => [h.trim().toLowerCase(), row[idx]])),
    }));

    const findIdx = (keys) => {
      const lowered = header.map((h) => h.trim().toLowerCase());
      return lowered.findIndex((h) => keys.some((k) => h.includes(k)));
    };

    const idxUpdate = findIdx(['update']) >= 0 ? findIdx(['update']) : 0;
    const idxMinutes = findIdx(['minutes left', 'minutes_left', 'ml', 'mins']);
    const idxHomeProb = findIdx(['home win', 'home_wp', 'prob_b', 'team b', 'winprobhome']);
    const idxAwayProb = findIdx(['away win', 'away_wp', 'prob_a', 'team a', 'winprobaway']);
    const idxScoreA = findIdx(['score a', 'score_a', 'away score', 'a score']);
    const idxScoreB = findIdx(['score b', 'score_b', 'home score', 'b score']);
    const idxPossession = findIdx(['possession', 'poss']);
    const idxQuarter = findIdx(['quarter', 'qtr']);
    const idxDown = findIdx(['down']);
    const idxDistance = findIdx(['distance', 'dist']);
    const idxYtg = findIdx(['ytg', 'to-go']);
    const idxPregame = findIdx(['pregame', 'baseline']);

    const snapshots = dataRows.map(({ raw, map }, i) => {
      const winProbHome = parseNumber(coalesce(raw[idxHomeProb], map['win prob'], map['home'], map['home wpct']));
      const winProbAway = parseNumber(
        coalesce(raw[idxAwayProb], map['away'], winProbHome != null ? 1 - winProbHome : null)
      );
      const minuteLeft = parseNumber(coalesce(raw[idxMinutes], map['minutes left']));
      const updateLabel = raw[idxUpdate] || map['update'] || `U${i + 1}`;
      const pregame = parseNumber(coalesce(raw[idxPregame], map['pregame']));
      return {
        update: updateLabel,
        minuteLeft,
        winProbHome: clampProb(winProbHome),
        winProbAway: clampProb(winProbAway),
        scoreA: parseNumber(coalesce(raw[idxScoreA], map['score a'])) || 0,
        scoreB: parseNumber(coalesce(raw[idxScoreB], map['score b'])) || 0,
        possession: (raw[idxPossession] || '').trim(),
        quarter: raw[idxQuarter] || '',
        down: raw[idxDown] || '',
        distance: raw[idxDistance] || '',
        ytg: raw[idxYtg] || '',
        pregame,
      };
    });

    const teamA = latestNonEmpty(rows.map((r) => r[2]), 'Team A');
    const teamB = latestNonEmpty(rows.map((r) => r[3]), 'Team B');
    const teams = Array.from(
      new Set(
        rows
          .flatMap((r) => r.slice(2, 7))
          .map((t) => (t || '').trim())
          .filter(Boolean)
      )
    ).slice(0, 5);

    const firstPregame = snapshots.find((s) => s.pregame != null);
    const baseline = clampProb(firstPregame ? firstPregame.pregame : snapshots[0] ? snapshots[0].winProbHome : null);

    return { snapshots, teamA, teamB, teams, baseline };
  }

  function renderMatchup({ snapshots, teamA, teamB, teams, baseline }) {
    const labels = snapshots.map((s) => (s.minuteLeft !== null && s.minuteLeft !== undefined ? s.minuteLeft : s.update));
    const home = smoothSeries(snapshots.map((s) => toPct(s.winProbHome)));
    const away = smoothSeries(
      snapshots.map((s) =>
        s.winProbAway != null ? toPct(s.winProbAway) : s.winProbHome != null ? 100 - toPct(s.winProbHome) : null
      )
    );

    state.baseline = baseline != null ? baseline : null;
    els.baselineValue.textContent = baseline != null ? `${(baseline * 100).toFixed(1)}%` : '—';
    els.pregameTag.textContent =
      baseline != null ? `Pregame baseline: ${(baseline * 100).toFixed(1)}%` : 'Pregame baseline: —';

    updateChart(labels, home, away, teamA, teamB);

    const latest = snapshots[snapshots.length - 1];
    els.gameStatus.textContent = latest.minuteLeft != null && latest.minuteLeft <= 0 ? 'Final' : 'Live';
    els.gameStatus.classList.toggle('badge--ghost', latest.minuteLeft != null && latest.minuteLeft <= 0);
    els.teamAName.textContent = teamA;
    els.teamBName.textContent = teamB;
    els.teamAScore.textContent = latest.scoreA != null ? latest.scoreA : '0';
    els.teamBScore.textContent = latest.scoreB != null ? latest.scoreB : '0';
    els.possession.textContent = latest.possession ? `Possession: ${latest.possession}` : 'Possession —';
    els.quarter.textContent = latest.quarter ? `Q${latest.quarter}` : 'Q-';
    els.clock.textContent = latest.minuteLeft != null ? `${latest.minuteLeft} ML` : 'ML —';
    els.downDistance.textContent = latest.down ? `Down: ${latest.down}` : 'Down —';
    els.ytg.textContent = latest.ytg || latest.distance ? `${latest.ytg || latest.distance} YTG` : 'YTG —';
    els.teamListChip.textContent = teams.length ? `Teams: ${teams.join(', ')}` : 'Teams: —';
    els.lastUpdate.textContent = `Last update: ${latest.update}`;

    setLogo(els.teamALogo, teamA);
    setLogo(els.teamBLogo, teamB);

    const metrics = analyzeGame(home, labels, baseline);
    els.momentumValue.textContent = metrics.momentum;
    els.swingValue.textContent = metrics.bigSwing;
    els.clutchValue.textContent = metrics.clutch;

    renderPills(metrics, baseline);
    setLoading(els.winLoading, false);
    toggleError(els.winError, false);
    state.matchupLoading = false;
  }

  function updateChart(labels, home, away, teamA, teamB) {
    if (!state.chart) return;
    state.chart.data.labels = labels;
    state.chart.data.datasets[0].label = teamA;
    state.chart.data.datasets[1].label = teamB;
    state.chart.data.datasets[0].data = away;
    state.chart.data.datasets[1].data = home;
    state.chart.update('none');
  }

  function analyzeGame(homeSeries, labels, baseline) {
    const filtered = homeSeries.filter((v) => v != null);
    const recent = filtered.slice(-3);
    const delta = recent.length >= 2 ? recent[recent.length - 1] - recent[0] : 0;
    const momentum =
      Math.abs(delta) >= MOMENTUM_THRESHOLD * 100 ? `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} pts` : 'Stable';
    const bigSwing = computeBigSwing(filtered);
    const clutch = computeClutch(filtered, labels);
    renderBaselinePill(baseline);
    return { momentum, bigSwing, clutch };
  }

  function computeBigSwing(series) {
    let swing = 0;
    for (let i = 1; i < series.length; i++) {
      if (series[i] == null || series[i - 1] == null) continue;
      const delta = series[i] - series[i - 1];
      swing = Math.max(Math.abs(delta), swing);
    }
    return swing >= BIG_SWING_THRESHOLD * 100 ? `${swing.toFixed(1)} pts` : '—';
  }

  function computeClutch(series, labels) {
    const lastLabel = labels[labels.length - 1];
    const mid = series[series.length - 1];
    const isClutch = typeof lastLabel === 'number' ? lastLabel <= 5 && mid >= 35 && mid <= 65 : mid >= 35 && mid <= 65;
    return isClutch ? 'In clutch' : '—';
  }

  function renderPills(metrics, baseline) {
    els.pillRow.innerHTML = '';
    const pills = [];
    if (baseline != null) {
      pills.push({ label: 'Pregame', value: `${(baseline * 100).toFixed(1)}%`, tone: 'accent' });
    }
    if (metrics.momentum !== 'Stable') pills.push({ label: 'Momentum', value: metrics.momentum, tone: 'accent' });
    if (metrics.bigSwing !== '—') pills.push({ label: 'Big swing', value: metrics.bigSwing, tone: 'warning' });
    if (metrics.clutch === 'In clutch') pills.push({ label: 'Clutch time', value: 'Tight window', tone: 'danger' });

    if (!pills.length) {
      pills.push({ label: 'Calm', value: 'No major swings', tone: 'ghost' });
    }

    pills.forEach((pill) => {
      const div = document.createElement('div');
      div.className = `pill ${pill.tone ? `pill--${pill.tone}` : ''}`.trim();
      div.textContent = `${pill.label}: ${pill.value}`;
      els.pillRow.appendChild(div);
    });
  }

  function renderBaselinePill(baseline) {
    if (!baseline) return;
    els.pregameTag.textContent = `Pregame baseline: ${(baseline * 100).toFixed(1)}%`;
  }

  function smoothSeries(series) {
    const filtered = series.map((v) => (v == null ? null : v));
    const values = filtered.filter((v) => v != null);
    if (!values.length) return series.map(() => null);
    const padded = [];
    const pad = Math.floor(SMOOTH_WINDOW / 2);
    const first = values[0];
    const last = values[values.length - 1];
    for (let i = 0; i < pad; i++) padded.push(first);
    padded.push(...values);
    for (let i = 0; i < pad; i++) padded.push(last);

    const smoothed = [];
    for (let i = 0; i < values.length; i++) {
      const slice = padded.slice(i, i + SMOOTH_WINDOW);
      const avg = slice.reduce((sum, v) => sum + v, 0) / slice.length;
      smoothed.push(parseFloat(avg.toFixed(2)));
    }

    // map smoothed back, preserving nulls
    let idx = 0;
    return filtered.map((v) => (v == null ? null : smoothed[idx++]));
  }

  function clampProb(value) {
    if (value == null || isNaN(value)) return null;
    const normalized = value > 1 ? value / 100 : value;
    const clamped = Math.min(MAX_DISPLAY_PROB, Math.max(MIN_DISPLAY_PROB, normalized));
    return clamped;
  }

  function toPct(value) {
    if (value == null) return null;
    return Math.round(value * 1000) / 10;
  }

  function parseNumber(val) {
    if (val == null) return null;
    const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
    return isNaN(num) ? null : num;
  }

  function latestNonEmpty(arr, fallback) {
    for (let i = arr.length - 1; i >= 0; i--) {
      const v = (arr[i] || '').trim();
      if (v) return v;
    }
    return fallback;
  }

  function setLogo(el, name) {
    const key = (name || '').toLowerCase();
    const file = LOGO_MAP[key];
    if (file) {
      el.style.backgroundImage = `url(${logoPath(file)})`;
    } else {
      el.style.backgroundImage = 'linear-gradient(135deg, rgba(96,165,250,0.2), rgba(168,85,247,0.2))';
    }
  }

  function logoPath(file) {
    return `../logos/${file}`;
  }

  function parseMvpCSV(text) {
    const records = d3.csvParse(text);
    return records
      .map((row) => ({
        player: row.player || row.Player || row.name || 'Player',
        team: row.team || row.Team || 'Team',
        winPct: parseNumber(row.win_pct || row['win%'] || row.win) || 0,
        mvpScore: parseNumber(row.mvp_score || row.score || row.mvp) || 0,
        impliedWithVig: parseNumber(row.implied_with_vig || row.implied || row['with_vig']) || null,
        impliedNoVig: parseNumber(row.no_vig || row.implied_no_vig || row['without_vig']) || null,
        decimalOdds: row.decimal || row.decimal_odds || '',
        americanOdds: row.american || row.american_odds || '',
        pass: parseNumber(row.pass) || null,
        rush: parseNumber(row.rush) || null,
        recv: parseNumber(row.recv) || null,
        def: parseNumber(row.def) || null,
        win: parseNumber(row.win_score || row.win_component) || null,
        record: row.record || '',
      }))
      .filter((r) => r.player);
  }

  function renderMvp(records) {
    const sorted = [...records].sort((a, b) => {
      const dir = state.sort.dir === 'asc' ? 1 : -1;
      const aVal = a[state.sort.key] != null ? a[state.sort.key] : 0;
      const bVal = b[state.sort.key] != null ? b[state.sort.key] : 0;
      return (aVal > bVal ? 1 : -1) * dir;
    });

    els.mvpTableBody.innerHTML = '';
    if (!sorted.length) {
      els.mvpEmpty.hidden = false;
      return;
    }
    els.mvpEmpty.hidden = true;

    const frag = document.createDocumentFragment();
    sorted.forEach((row, idx) => {
      const tr = document.createElement('tr');
      if (idx < 5) tr.style.boxShadow = 'inset 0 1px 0 rgba(96,165,250,0.2)';
      tr.innerHTML = `
        <td>
          <div class="player">
            <div class="player__avatar">${initials(row.player)}</div>
            <div>
              <div>${row.player}</div>
              <div class="details">MVP: ${row.mvpScore.toFixed(1)}</div>
            </div>
          </div>
        </td>
        <td>
          <div class="team-chip">
            <span>${row.team}</span>
            <span class="record">${row.record || ''}</span>
          </div>
        </td>
        <td>${formatPct(row.winPct)}</td>
        <td>${row.mvpScore.toFixed(2)}</td>
        <td>
          <div class="details">With Vig: ${formatPct(row.impliedWithVig)}</div>
          <div class="details">No Vig: ${formatPct(row.impliedNoVig)}</div>
        </td>
        <td>${row.decimalOdds || '—'}</td>
        <td>${row.americanOdds || '—'}</td>
        <td><button class="expand-btn" aria-label="Toggle details">View</button></td>
      `;

      const detail = document.createElement('tr');
      detail.className = 'detail-row hidden';
      detail.innerHTML = `
        <td colspan="8">
          <div class="details">Pass: ${formatScore(row.pass)} • Rush: ${formatScore(row.rush)} • Recv: ${formatScore(
        row.recv
      )} • Def: ${formatScore(row.def)} • Win: ${formatScore(row.win)}</div>
        </td>
      `;

      tr.querySelector('.expand-btn').addEventListener('click', () => {
        detail.classList.toggle('hidden');
      });

      frag.appendChild(tr);
      frag.appendChild(detail);
    });

    els.mvpTableBody.appendChild(frag);
    els.mvpStatus.textContent = `Updated ${new Date().toLocaleTimeString()}`;

    attachSortHandlers();
  }

  function attachSortHandlers() {
    document.querySelectorAll('#mvpTable thead th[data-sort]').forEach((th) => {
      th.onclick = () => {
        const key = th.dataset.sort;
        if (state.sort.key === key) {
          state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
        } else {
          state.sort.key = key;
          state.sort.dir = 'desc';
        }
        fetchMvp();
      };
    });
  }

  function formatPct(value) {
    if (value == null || isNaN(value)) return '—';
    const normalized = value > 1 ? value : value * 100;
    return `${normalized.toFixed(1)}%`;
  }

  function formatScore(value) {
    if (value == null || isNaN(value)) return '—';
    return value.toFixed(1);
  }

  function initials(name) {
    return name
      .split(' ')
      .map((p) => p[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }

  function setLoading(el, isLoading) {
    if (!el) return;
    el.hidden = !isLoading;
  }

  function toggleError(el, show) {
    if (!el) return;
    el.hidden = !show;
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
        winProbHome: current / 100,
        winProbAway: 1 - current / 100,
        scoreA: Math.max(0, Math.round((12 - i) / 3)),
        scoreB: Math.max(0, Math.round((12 - i) / 2)),
        possession: (12 - i) % 2 === 0 ? 'Home' : 'Away',
        quarter: Math.min(4, Math.ceil((12 - i + 1) / 3)),
        down: ((12 - i) % 4) + 1,
        distance: 10,
        ytg: 10,
        pregame,
      });
    }

    return {
      snapshots: samples,
      teamA: 'Away',
      teamB: 'Home',
      teams: ['Away', 'Home'],
      baseline: pregame,
    };
  }

  function buildSampleMvp() {
    return [
      {
        player: 'Sample QB',
        team: 'Cards',
        winPct: 0.65,
        mvpScore: 89.3,
        impliedWithVig: 0.2,
        impliedNoVig: 0.17,
        decimalOdds: '5.0',
        americanOdds: '+400',
        pass: 24.5,
        rush: 6.4,
        recv: 0,
        def: 1.2,
        win: 12.3,
        record: '10-2',
      },
      {
        player: 'Star WR',
        team: 'Cowboys',
        winPct: 0.6,
        mvpScore: 82.1,
        impliedWithVig: 0.15,
        impliedNoVig: 0.12,
        decimalOdds: '7.5',
        americanOdds: '+650',
        pass: 0,
        rush: 2.1,
        recv: 20.5,
        def: 0,
        win: 9.4,
        record: '9-3',
      },
    ];
  }

  function overrideUrl(key) {
    const params = new URLSearchParams(window.location.search);
    return params.get(key);
  }
})();
