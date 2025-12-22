(() => {
  // ============================================================
  // CONFIG (edit these)
  // ============================================================
  const SHEET_CSV_URL = ""; 
  // Put your published CSV URL here, e.g.
  // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/gviz/tq?tqx=out:csv&sheet=Sheet1

  const POLL_MS = 15000; // "live" updates: re-fetch + re-render every 15s

  const LEAGUE_NAME = "Tate Football League";
  const WEEK_LABEL  = "Week 3 • Regular Season Matchup";

  const TEAM_A_NAME = "New York Giants";
  const TEAM_B_NAME = "Cincinnati Bengals";

  const LOGO_A_PATH = "./logos/giants.png";
  const LOGO_B_PATH = "./logos/bengals.png";

  // note: your comments in python were flipped; keep the actual RGB you want here
  const TEAM_A_COLOR = [255, 165, 0]; // orange
  const TEAM_B_COLOR = [0, 28, 142];  // deep blue

  // ============================================================
  // THEME (matches your python palette closely)
  // ============================================================
  const BG         = [12, 16, 28];
  const CARD       = [28, 37, 54];
  const CARD_LIGHT = [43, 55, 75];

  const TEXT    = [245, 247, 252];
  const SUBTEXT = [199, 207, 220];
  const MUTED   = [146, 158, 178];
  const GRID    = [79, 95, 122];
  const AXIS    = [112, 126, 152];

  const LIVE_BG  = [239, 68, 68];
  const FINAL_BG = [107, 114, 128];

  // ============================================================
  // CSV headers (based on your uploaded snapshots.csv)
  // ============================================================
  const CANON = {
    update: "Update #",
    minutes_left: "Minutes Left",
    score_a: "Team A",
    score_b: "Team B",
    wp_a: "Team A Win Probability",
    has_ball_a: "Team A has Ball (1=yes, 0=no)",
    quarter: "Quarter",
    down: "Down",
    distance: "Distance",
    ytg: "Yards to Goal",
    pregame_wp: "Pregame Win Prob",
  };

  const ALIASES = {
    "Update #": ["Update #","Update","Update#","Snapshot","Index"],
    "Minutes Left": ["Minutes Left","Time Left","Min Left","Clock"],
    "Team A": ["Team A","A Score","Score A","Home","Home Score"],
    "Team B": ["Team B","B Score","Score B","Away","Away Score"],
    "Team A Win Probability": ["Team A Win Probability","Win Prob A","Win Probability","Win Prob"],
    "Team A has Ball (1=yes, 0=no)": ["Team A has Ball (1=yes, 0=no)","Has Ball","Possession","A has Ball"],
    "Quarter": ["Quarter","Q","Period"],
    "Down": ["Down","Down#"],
    "Distance": ["Distance","To Go","Yards To Go"],
    "Yards to Goal": ["Yards to Goal","YTG","Yds to Goal"],
    "Pregame Win Prob": ["Pregame Win Prob","Pregame WP","Baseline Win Prob"],
  };

  // ============================================================
  // Small helpers
  // ============================================================
  const hintEl = document.getElementById("hint");

  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const rgb = (a, alpha = 1) => `rgba(${a[0]},${a[1]},${a[2]},${alpha})`;

  function parseCsv(text) {
    // robust-enough CSV parser for quoted fields
    const rows = [];
    let cur = "", inQ = false;
    let row = [];
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const nxt = text[i+1];
      if (ch === '"' ) {
        if (inQ && nxt === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === "," && !inQ) {
        row.push(cur); cur = "";
      } else if ((ch === "\n" || ch === "\r") && !inQ) {
        if (ch === "\r" && nxt === "\n") i++;
        row.push(cur); cur = "";
        // ignore trailing fully-empty rows
        if (row.some(v => (v ?? "").trim() !== "")) rows.push(row);
        row = [];
      } else {
        cur += ch;
      }
    }
    // last
    if (cur.length || row.length) {
      row.push(cur);
      if (row.some(v => (v ?? "").trim() !== "")) rows.push(row);
    }
    return rows;
  }

  function buildHeaderMap(headers) {
    const norm = new Map();
    headers.forEach(h => norm.set((h ?? "").trim().toLowerCase(), h));
    const mapping = {};
    Object.values(CANON).forEach(canonName => {
      const candidates = ALIASES[canonName] || [canonName];
      for (const alias of candidates) {
        const key = alias.trim().toLowerCase();
        if (norm.has(key)) { mapping[canonName] = norm.get(key); break; }
      }
    });
    return mapping;
  }

  function toFloat(v) {
    if (v == null) return NaN;
    const s = String(v).trim();
    if (!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function toInt(v) {
    const n = toFloat(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  function parseMinutesLeft(v) {
    if (!Number.isFinite(v) || v < 0) return v;
    const m = Math.floor(v);
    const frac = v - m;
    const ss = Math.round(frac * 100);
    if (ss >= 0 && ss <= 59) return m + ss / 60;
    return v;
  }

  function fmtClock(mins) {
    mins = Math.max(0, mins);
    let m = Math.floor(mins);
    let s = Math.round((mins - m) * 60);
    if (s === 60) { m++; s = 0; }
    return `${m}:${String(s).padStart(2,"0")}`;
  }

  function fmtPct(p) { return `${Math.round(p * 100)}%`; }

  function fmtDownOrdinal(d) {
    if (d == null) return null;
    if (d === 1) return "1st";
    if (d === 2) return "2nd";
    if (d === 3) return "3rd";
    return `${d}th`;
  }

  function computeBigSwing(snaps) {
    let best = 0, bestUpdate = snaps[snaps.length - 1]?.update ?? 1;
    for (let i = 1; i < snaps.length; i++) {
      const d = snaps[i].wp_a - snaps[i-1].wp_a;
      if (Math.abs(d) > Math.abs(best)) { best = d; bestUpdate = snaps[i].update; }
    }
    return [best, bestUpdate];
  }

  function computeMomentum(snaps, n = 5) {
    if (snaps.length < 2) return 0;
    n = Math.max(1, Math.min(n, snaps.length - 1));
    return snaps[snaps.length - 1].wp_a - snaps[snaps.length - 1 - n].wp_a;
  }

  function computeClutchIndex(snaps) {
    if (snaps.length < 3) return 0;
    const ys = snaps.map(s => s.wp_a);
    const diffs = [];
    for (let i = 1; i < ys.length; i++) diffs.push(ys[i] - ys[i-1]);
    const mean = diffs.reduce((a,b)=>a+b,0) / diffs.length;
    let varSum = 0;
    for (const d of diffs) varSum += (d-mean)*(d-mean);
    const vol = Math.sqrt(varSum / Math.max(1, diffs.length - 1));
    let crossings = 0;
    for (let i = 1; i < ys.length; i++) {
      if ((ys[i-1] < 0.5 && ys[i] >= 0.5) || (ys[i-1] >= 0.5 && ys[i] < 0.5)) crossings++;
    }
    const score = crossings * 18 + vol * 240;
    return Math.round(clamp(score, 0, 100));
  }

  function compressDuplicateX(x, y) {
    if (x.length <= 1) return [x, y];
    const outX = [x[0]], outY = [y[0]];
    for (let i = 1; i < x.length; i++) {
      if (x[i] === outX[outX.length - 1]) outY[outY.length - 1] = y[i];
      else { outX.push(x[i]); outY.push(y[i]); }
    }
    return [outX, outY];
  }

  function smoothSeries(x, y, pointsPerSeg = 40) {
    if (x.length < 2) return [x, y];

    const xs = [], ys = [];
    for (let i = 0; i < x.length - 1; i++) {
      const x0 = x[i], x1 = x[i+1];
      const y0 = y[i], y1 = y[i+1];
      for (let k = 0; k < pointsPerSeg; k++) {
        const t = k / pointsPerSeg;
        xs.push(x0 + (x1 - x0) * t);
        ys.push(y0 + (y1 - y0) * t);
      }
    }
    xs.push(x[x.length - 1]);
    ys.push(y[y.length - 1]);

    const win = 13; // odd
    if (ys.length >= win) {
      const pad = Math.floor(win / 2);
      const ypad = [];
      // edge pad
      for (let i = 0; i < pad; i++) ypad.push(ys[0]);
      ypad.push(...ys);
      for (let i = 0; i < pad; i++) ypad.push(ys[ys.length - 1]);

      const out = new Array(ys.length).fill(0);
      for (let i = 0; i < ys.length; i++) {
        let sum = 0;
        for (let j = 0; j < win; j++) sum += ypad[i + j];
        out[i] = sum / win;
      }
      return [xs, out];
    }
    return [xs, ys];
  }

  async function loadImage(src) {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = src;
    await img.decode().catch(() => null);
    return img;
  }

  // ============================================================
  // Parse snapshots from CSV text
  // ============================================================
  function parseSnapshotsFromCsv(csvText) {
    const grid = parseCsv(csvText);
    if (!grid.length) throw new Error("Empty CSV");

    const headers = grid[0];
    const mapping = buildHeaderMap(headers);

    const idxByName = new Map(headers.map((h, i) => [h, i]));
    const getVal = (row, canonKey) =>
