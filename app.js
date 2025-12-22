/* app.js
   ============================================================
   FANTASY LEAGUE WIN PROBABILITY CARD (Browser / GitHub Pages)
   - Pulls LIVE data from a *published Google Sheet CSV endpoint*
   - Renders the full “card” graphic in an HTML5 canvas
   - Works on GitHub Pages (no backend)
   - Supports 5 teams: Cowboys, Bengals, Giants, 49ers, Cardinals
   - Logos expected in: /logos/
       cowboys.png, bengals.png, giants.png, Sanfran.png, Cards.png

   REQUIRED (1-time):
   1) Publish your Google Sheet to the web as CSV (File → Share → Publish to web → CSV)
   2) Set SHEET_CSV_URL below to your published URL:
        https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&sheet=<TABNAME>

   OPTIONAL URL params:
     ?away=giants&home=bengals
     ?sheet=Week3            (if you want to switch the sheet tab name in your URL builder)
     ?refresh=10             (seconds)
   ============================================================
*/

(() => {
  // ============================================================
  // CONFIG YOU EDIT
  // ============================================================

  // Paste your published CSV endpoint here:
  // Example:
  // const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/XXXX/gviz/tq?tqx=out:csv&sheet=Week3";
  const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxNr3jLVjL4e24TvQR9iSkJP0T_lBiA2Dh5G9iut5_zDksYHEnbsu8k8f5Eo888Aha_UWuZXRhFNV0/pub?gid=0&single=true&output=csv";

  const DEFAULTS = {
    leagueName: "Tate Football League",
    weekLabel: "Week 3 • Regular Season Matchup",
    awayTeam: "giants",
    homeTeam: "bengals",
    refreshSeconds: 15, // auto-refresh
    canvasW: 1800,
    canvasH: 1050,
    supersample: 2, // for crisp output
    showPregameBaseline: true,
    momentumN: 5,
    displayClampLo: 0.01,
    displayClampHi: 0.99,
  };

  // Logos + colors
  const TEAMS = {
    cowboys: {
      id: "cowboys",
      display: "Dallas Cowboys",
      // headers you might use in Google Sheets for score columns:
      sheetKeys: ["Cowboys", "Dallas", "DAL", "Cowboys Score"],
      logo: "logos/cowboys.png",
      color: [0, 34, 68],
    },
    bengals: {
      id: "bengals",
      display: "Cincinnati Bengals",
      sheetKeys: ["Bengals", "Cincinnati", "CIN", "Bengals Score"],
      logo: "logos/bengals.png",
      color: [251, 79, 20],
    },
    giants: {
      id: "giants",
      display: "New York Giants",
      sheetKeys: ["Giants", "New York Giants", "NYG", "Giants Score"],
      logo: "logos/giants.png",
      color: [1, 35, 82],
    },
    niners: {
      id: "niners",
      display: "San Francisco 49ers",
      sheetKeys: ["49ers", "Niners", "Sanfran", "San Fran", "SF", "San Francisco", "49ers Score"],
      logo: "logos/Sanfran.png", // from your screenshot
      color: [170, 0, 0],
    },
    cardinals: {
      id: "cardinals",
      display: "Arizona Cardinals",
      sheetKeys: ["Cardinals", "Cards", "Arizona", "ARI", "Cardinals Score"],
      logo: "logos/Cards.png", // from your screenshot
      color: [151, 35, 63],
    },
  };

  // ============================================================
  // THEME (matches your Python vibe)
  // ============================================================
  const THEME = {
    BG: [12, 16, 28],
    CARD: [28, 37, 54],
    CARD_LIGHT: [43, 55, 75],
    TEXT: [245, 247, 252],
    SUBTEXT: [199, 207, 220],
    MUTED: [146, 158, 178],
    GRID: [79, 95, 122],
    AXIS: [112, 126, 152],
    LIVE_BG: [239, 68, 68],
    FINAL_BG: [107, 114, 128],
  };

  // ============================================================
  // UTIL
  // ============================================================
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const isNum = (v) => typeof v === "number" && Number.isFinite(v);

  function rgb(a, alpha = 1) {
    const [r, g, b] = a;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function parseQuery() {
    const p = new URLSearchParams(location.search);
    const away = (p.get("away") || DEFAULTS.awayTeam).toLowerCase();
    const home = (p.get("home") || DEFAULTS.homeTeam).toLowerCase();
    const refreshSeconds = clamp(parseFloat(p.get("refresh") || DEFAULTS.refreshSeconds), 3, 120);
    return { away, home, refreshSeconds };
  }

  function fmtPct(p) {
    return `${Math.round(p * 100)}%`;
  }

  function fmtClock(minutesFloat) {
    const m = Math.max(0, minutesFloat);
    let mm = Math.floor(m);
    let ss = Math.round((m - mm) * 60);
    if (ss === 60) { mm += 1; ss = 0; }
    return `${mm}:${String(ss).padStart(2, "0")}`;
  }

  function fmtDownOrdinal(d) {
    if (!isNum(d)) return null;
    if (d === 1) return "1st";
    if (d === 2) return "2nd";
    if (d === 3) return "3rd";
    return `${d}th`;
  }

  // Accepts minutes as float OR MM.SS exported weirdness (18.40 => 18m40s)
  function parseMinutesLeft(v) {
    if (!isNum(v)) return v;
    if (v < 0) return v;
    const m = Math.floor(v);
    const frac = v - m;
    const ss = Math.round(frac * 100);
    if (ss >= 0 && ss <= 59) return m + ss / 60;
    return v;
  }

  // Robust CSV parser (handles quoted commas/newlines)
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      const n = text[i + 1];

      if (inQuotes) {
        if (c === '"' && n === '"') {
          cell += '"';
          i++;
        } else if (c === '"') {
          inQuotes = false;
        } else {
          cell += c;
        }
      } else {
        if (c === '"') {
          inQuotes = true;
        } else if (c === ",") {
          row.push(cell);
          cell = "";
        } else if (c === "\n") {
          row.push(cell);
          cell = "";
          // ignore fully empty trailing lines
          if (row.some((x) => String(x).trim() !== "")) rows.push(row);
          row = [];
        } else if (c === "\r") {
          // ignore
        } else {
          cell += c;
        }
      }
    }
    row.push(cell);
    if (row.some((x) => String(x).trim() !== "")) rows.push(row);
    return rows;
  }

  function toFloat(x) {
    if (x == null) return NaN;
    const s = String(x).trim();
    if (!s) return NaN;
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : NaN;
  }

  function toInt(x) {
    const v = toFloat(x);
    return Number.isFinite(v) ? Math.round(v) : null;
  }

  function normHeader(h) {
    return String(h || "").trim().toLowerCase();
  }

  function buildHeaderIndex(headers) {
    const idx = new Map();
    headers.forEach((h, i) => idx.set(normHeader(h), { original: h, i }));
    return idx;
  }

  function findHeader(headersIdx, aliases) {
    for (const a of aliases) {
      const hit = headersIdx.get(normHeader(a));
      if (hit) return hit;
    }
    return null;
  }

  // ============================================================
  // DATA MODEL + ANALYTICS (mirrors your Python)
  // ============================================================
  function computeBigSwing(snaps) {
    let best = 0;
    let bestUpdate = snaps[snaps.length - 1]?.update ?? 0;
    for (let i = 1; i < snaps.length; i++) {
      const d = snaps[i].wpA - snaps[i - 1].wpA;
      if (Math.abs(d) > Math.abs(best)) {
        best = d;
        bestUpdate = snaps[i].update;
      }
    }
    return { best, bestUpdate };
  }

  function computeMomentum(snaps, n) {
    if (snaps.length < 2) return 0;
    n = Math.max(1, Math.min(n, snaps.length - 1));
    return snaps[snaps.length - 1].wpA - snaps[snaps.length - 1 - n].wpA;
  }

  function computeClutchIndex(snaps) {
    if (snaps.length < 3) return 0;
    const ys = snaps.map((s) => s.wpA);
    const diffs = [];
    for (let i = 1; i < ys.length; i++) diffs.push(ys[i] - ys[i - 1]);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const varr = diffs.reduce((a, d) => a + (d - mean) * (d - mean), 0) / Math.max(1, diffs.length - 1);
    const vol = Math.sqrt(varr);
    let crossings = 0;
    for (let i = 1; i < ys.length; i++) {
      if ((ys[i - 1] < 0.5 && ys[i] >= 0.5) || (ys[i - 1] >= 0.5 && ys[i] < 0.5)) crossings++;
    }
    const score = crossings * 18 + vol * 240;
    return Math.round(clamp(score, 0, 100));
  }

  function findPregame(snaps) {
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (isNum(snaps[i].pregameWp)) return clamp(snaps[i].pregameWp, 0, 1);
    }
    return null;
  }

  // ============================================================
  // CHART SMOOTHING (edge-padded moving average)
  // ============================================================
  function compressDuplicateX(x, y) {
    if (x.length <= 1) return { x, y };
    const outX = [x[0]];
    const outY = [y[0]];
    for (let i = 1; i < x.length; i++) {
      if (x[i] === outX[outX.length - 1]) {
        outY[outY.length - 1] = y[i]; // keep last
      } else {
        outX.push(x[i]);
        outY.push(y[i]);
      }
    }
    return { x: outX, y: outY };
  }

  function movingAverageEdgePadded(arr, winOdd) {
    const win = winOdd;
    if (arr.length < win) return arr.slice();
    const pad = Math.floor(win / 2);
    const padded = [];
    for (let i = 0; i < pad; i++) padded.push(arr[0]);
    for (let i = 0; i < arr.length; i++) padded.push(arr[i]);
    for (let i = 0; i < pad; i++) padded.push(arr[arr.length - 1]);

    const out = [];
    const inv = 1 / win;
    for (let i = 0; i < arr.length; i++) {
      let s = 0;
      for (let k = 0; k < win; k++) s += padded[i + k];
      out.push(s * inv);
    }
    return out;
  }

  function smoothSeries(x, y, pointsPerSegment = 40) {
    if (x.length < 2) return { xs: x.slice(), ys: y.slice() };

    const xs = [];
    const ys = [];
    for (let i = 0; i < x.length - 1; i++) {
      const x0 = x[i], x1 = x[i + 1];
      const y0 = y[i], y1 = y[i + 1];
      for (let k = 0; k < pointsPerSegment; k++) {
        const t = k / pointsPerSegment;
        xs.push(x0 + (x1 - x0) * t);
        ys.push(y0 + (y1 - y0) * t);
      }
    }
    xs.push(x[x.length - 1]);
    ys.push(y[y.length - 1]);

    const win = 13; // odd
    const smoothed = movingAverageEdgePadded(ys, win);
    return { xs, ys: smoothed };
  }

  // ============================================================
  // CANVAS DRAWING HELPERS
  // ============================================================
  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(x, y, w, h, rr);
    } else {
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }
  }

  function drawGradientRect(ctx, x, y, w, h, c1, c2, alpha = 1, vertical = true, r = 0) {
    ctx.save();
    const grad = vertical ? ctx.createLinearGradient(0, y, 0, y + h) : ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, rgb(c1, alpha));
    grad.addColorStop(1, rgb(c2, alpha));

    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  function drawShadowedPanel(ctx, x, y, w, h, r, shadowY, shadowBlur) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = shadowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = shadowY;
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = "rgba(0,0,0,0.001)";
    ctx.fill();
    ctx.restore();
  }

  function drawText(ctx, text, x, y, font, fill, align = "left", baseline = "alphabetic") {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function footballIconCanvas(size) {
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    const pad = Math.max(2, Math.floor(size / 10));
    const x0 = pad, y0 = pad, x1 = size - pad, y1 = size - pad;

    // ball
    ctx.fillStyle = "rgba(139,69,19,1)";
    ctx.beginPath();
    ctx.ellipse(size / 2, size / 2, (x1 - x0) / 2, (y1 - y0) / 2, 0, 0, Math.PI * 2);
    ctx.fill();

    // highlight
    ctx.fillStyle = "rgba(180,120,60,0.35)";
    const hl = Math.floor(size * 0.3);
    ctx.beginPath();
    ctx.ellipse(x0 + hl * 0.75, y0 + hl * 0.75, hl * 0.5, hl * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // laces
    const cx = size / 2, cy = size / 2;
    const laceLen = size * 0.44;
    ctx.strokeStyle = "rgba(255,255,255,1)";
    ctx.lineWidth = Math.max(2, Math.floor(size / 12));
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(cx - laceLen / 2, cy);
    ctx.lineTo(cx + laceLen / 2, cy);
    ctx.stroke();

    ctx.lineWidth = Math.max(2, Math.floor(size / 20));
    for (let k = -2; k <= 2; k++) {
      const lx = cx + (k * laceLen) / 6;
      ctx.beginPath();
      ctx.moveTo(lx, cy - size * 0.12);
      ctx.lineTo(lx, cy + size * 0.12);
      ctx.stroke();
    }

    return c;
  }

  function pillMeasure(ctx, text, font, padX, padY) {
    ctx.save();
    ctx.font = font;
    const w = ctx.measureText(text).width;
    // approximate height from font size
    const size = parseInt(font.match(/(\d+)px/)?.[1] || "16", 10);
    const h = size * 1.25;
    ctx.restore();
    return { w: w + 2 * padX, h: h + 2 * padY, textW: w, textH: h };
  }

  function drawPill(ctx, x, y, w, h, r, bgFill, stroke, text, font, fg) {
    ctx.save();
    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = bgFill;
    ctx.fill();
    if (stroke) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
    ctx.font = font;
    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + Math.floor((w - ctx.measureText(text).width) / 2), y + h / 2);
    ctx.restore();
  }

  // ============================================================
  // CSV -> snapshots (dynamic Away/Home team columns)
  // ============================================================
  function buildCanonAliases(awayTeam, homeTeam) {
    const awayKeys = TEAMS[awayTeam]?.sheetKeys ?? [awayTeam];
    const homeKeys = TEAMS[homeTeam]?.sheetKeys ?? [homeTeam];

    return {
      update: ["Update #", "Update", "Update#", "Snapshot", "Index"],
      minutesLeft: ["Minutes Left", "Time Left", "Clock", "Min Left", "Time Remaining"],
      minutesElapsed: ["Minutes Elapsed", "Elapsed", "Game Minutes Elapsed"],

      scoreAway: ["Team A", "Away", ...awayKeys, ...awayKeys.map(k => `${k} Score`), "Away Score"],
      scoreHome: ["Team B", "Home", ...homeKeys, ...homeKeys.map(k => `${k} Score`), "Home Score"],

      wpAway: [
        "Team A Win Probability", "Team A Win Prob", "Win Probability", "Win Prob", "Win Prob A",
        ...awayKeys.flatMap(k => [`${k} Win Probability`, `${k} Win Prob`, `${k} WP`]),
      ],

      hasBallAway: [
        "Team A has Ball (1=yes, 0=no)", "Team A has Ball", "Has Ball", "Possession", "A has Ball",
        ...awayKeys.flatMap(k => [`${k} has Ball (1=yes, 0=no)`, `${k} has Ball`, `${k} Possession`]),
      ],

      quarter: ["Quarter", "Q", "Period"],
      down: ["Down", "Down#", "Down #"],
      distance: ["Distance", "To Go", "Yards To Go", "YTG (To Go)"],
      ytg: ["Yards to Goal", "YTG", "Yds to Goal", "YardsToGoal"],
      pregameWp: ["Pregame Win Prob", "Pregame WP", "Pregame Probability", "Baseline Win Prob", "Pregame Win Probability"],
    };
  }

  function rowsToObjects(csvRows) {
    if (!csvRows || csvRows.length < 2) return [];
    const headers = csvRows[0];
    const out = [];
    for (let r = 1; r < csvRows.length; r++) {
      const row = csvRows[r];
      const obj = {};
      for (let i = 0; i < headers.length; i++) obj[headers[i]] = row[i] ?? "";
      // stop at first fully blank row
      if (Object.values(obj).every(v => String(v).trim() === "")) break;
      out.push(obj);
    }
    return { headers, out };
  }

  function parseSnapshots(objs, headers, awayTeam, homeTeam) {
    const idx = buildHeaderIndex(headers);
    const A = buildCanonAliases(awayTeam, homeTeam);

    const col = {
      update: findHeader(idx, A.update),
      minutesLeft: findHeader(idx, A.minutesLeft),
      minutesElapsed: findHeader(idx, A.minutesElapsed),

      scoreAway: findHeader(idx, A.scoreAway),
      scoreHome: findHeader(idx, A.scoreHome),

      wpAway: findHeader(idx, A.wpAway),
      hasBallAway: findHeader(idx, A.hasBallAway),

      quarter: findHeader(idx, A.quarter),
      down: findHeader(idx, A.down),
      distance: findHeader(idx, A.distance),
      ytg: findHeader(idx, A.ytg),
      pregameWp: findHeader(idx, A.pregameWp),
    };

    if (!col.minutesLeft || !col.wpAway) {
      throw new Error(
        "Sheet is missing required columns. Need at least: Minutes Left + (Away Team) Win Probability.\n" +
        "Also ensure your team score columns exist (e.g., 'Giants' and 'Bengals')."
      );
    }

    let autoUpdate = 1;
    const raw = [];

    for (const o of objs) {
      const upd = col.update ? toFloat(o[col.update.original]) : NaN;
      const update = Number.isFinite(upd) ? Math.round(upd) : autoUpdate++;
      const tLeft = parseMinutesLeft(toFloat(o[col.minutesLeft.original]));
      const wpA = toFloat(o[col.wpAway.original]);

      if (!Number.isFinite(tLeft) || !Number.isFinite(wpA)) continue;

      const sA = col.scoreAway ? toFloat(o[col.scoreAway.original]) : NaN;
      const sB = col.scoreHome ? toFloat(o[col.scoreHome.original]) : NaN;

      const hasBall = col.hasBallAway ? toInt(o[col.hasBallAway.original]) : null;

      const q = col.quarter ? toInt(o[col.quarter.original]) : null;
      const dn = col.down ? toInt(o[col.down.original]) : null;
      const dist = col.distance ? toInt(o[col.distance.original]) : null;
      const ytg = col.ytg ? toInt(o[col.ytg.original]) : null;

      const pg = col.pregameWp ? toFloat(o[col.pregameWp.original]) : NaN;
      const pregameWp = Number.isFinite(pg) ? clamp(pg, 0, 1) : null;

      // minutes elapsed: use column if present; else compute from minutes left deltas
      const me = col.minutesElapsed ? toFloat(o[col.minutesElapsed.original]) : NaN;

      raw.push({
        update,
        minutesLeft: tLeft,
        minutesElapsed: Number.isFinite(me) ? me : null,
        wpA: clamp(wpA, 0, 1),
        scoreA: Number.isFinite(sA) ? sA : 0,
        scoreB: Number.isFinite(sB) ? sB : 0,
        hasBallA: (hasBall === 0 || hasBall === 1) ? hasBall : null,
        quarter: q,
        down: dn,
        distance: dist,
        ytg,
        pregameWp,
      });
    }

    if (!raw.length) throw new Error("No valid rows found. Check your sheet values.");

    raw.sort((a, b) => a.update - b.update);

    // If minutesElapsed missing, compute like your Python
    if (raw.some(r => r.minutesElapsed == null)) {
      let elapsed = 0;
      let prevLeft = raw[0].minutesLeft;
      for (let i = 0; i < raw.length; i++) {
        if (i === 0) {
          elapsed = 0;
          prevLeft = raw[i].minutesLeft;
        } else {
          const step = prevLeft - raw[i].minutesLeft;
          if (step > 0) {
            elapsed += step;
            prevLeft = raw[i].minutesLeft;
          } else {
            prevLeft = Math.min(prevLeft, raw[i].minutesLeft);
          }
        }
        raw[i].minutesElapsed = elapsed;
      }
    }

    return raw;
  }

  // ============================================================
  // RENDER CARD (Canvas)
  // ============================================================
  function renderCard(ctx, snaps, cfg, assets) {
    const W = cfg.canvasW * cfg.supersample;
    const H = cfg.canvasH * cfg.supersample;
    ctx.clearRect(0, 0, W, H);

    const S = cfg.supersample;

    // background
    ctx.fillStyle = rgb(THEME.BG, 1);
    ctx.fillRect(0, 0, W, H);

    const m = Math.round(40 * S);
    const x0 = m, y0 = m, x1 = W - m, y1 = H - m;
    const cardR = Math.round(40 * S);

    // shadow + card gradient
    drawShadowedPanel(ctx, x0, y0, x1 - x0, y1 - y0, cardR, Math.round(35 * S), Math.round(60 * S));
    drawGradientRect(ctx, x0, y0, x1 - x0, y1 - y0, THEME.CARD, THEME.CARD_LIGHT, 1, true, cardR);

    // border
    ctx.save();
    roundRectPath(ctx, x0, y0, x1 - x0, y1 - y0, cardR);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = Math.max(2, Math.round(3 * S));
    ctx.stroke();
    ctx.restore();

    // header
    const headerH = Math.round(250 * S);
    drawGradientRect(ctx, x0, y0, x1 - x0, headerH, [36, 46, 66], THEME.CARD, 1, true, cardR);

    const last = snaps[snaps.length - 1];
    const away = TEAMS[cfg.awayTeam];
    const home = TEAMS[cfg.homeTeam];

    const wpADisp = clamp(last.wpA, cfg.displayClampLo, cfg.displayClampHi);
    const wpBDisp = 1 - wpADisp;

    const innerW = x1 - x0;
    const padX = Math.round(60 * S);
    const leftW = Math.round(innerW * 0.40);
    const rightW = Math.round(innerW * 0.40);
    const centerW = innerW - leftW - rightW;

    const L0 = x0 + padX;
    const L1 = L0 + leftW;
    const C0 = L1;
    const C1 = C0 + centerW;
    const R0 = C1;
    const R1 = x1 - padX;

    // logos
    const logoBox = Math.round(100 * S);
    const logoY = y0 + Math.round(90 * S);
    const logoLeftX = L0 + Math.round(10 * S);
    const logoRightX = R1 - Math.round(10 * S) - logoBox;

    if (assets.logoAway) {
      ctx.save();
      // subtle drop shadow
      ctx.globalAlpha = 0.35;
      ctx.drawImage(assets.logoAway, logoLeftX + 6, logoY + 12, logoBox, logoBox);
      ctx.restore();
      ctx.drawImage(assets.logoAway, logoLeftX, logoY, logoBox, logoBox);
    }
    if (assets.logoHome) {
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.drawImage(assets.logoHome, logoRightX + 6, logoY + 12, logoBox, logoBox);
      ctx.restore();
      ctx.drawImage(assets.logoHome, logoRightX, logoY, logoBox, logoBox);
    }

    // team name + win prob
    const nameFont = `${Math.round(40 * S)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const probFont = `600 ${Math.round(24 * S)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;

    const leftTextX = logoLeftX + logoBox + Math.round(22 * S);
    const rightTextEnd = logoRightX - Math.round(22 * S);
    const nameY = y0 + Math.round(90 * S);
    const probY = y0 + Math.round(148 * S);

    drawText(ctx, away.display, leftTextX, nameY, `700 ${Math.round(40 * S)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`, rgb(THEME.TEXT, 1), "left", "top");
    drawText(ctx, `Win Prob: ${fmtPct(wpADisp)}`, leftTextX, probY, probFont, rgb(away.color, 1), "left", "top");

    ctx.save();
    ctx.font = `700 ${Math.round(40 * S)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const wHomeName = ctx.measureText(home.display).width;
    ctx.restore();
    drawText(ctx, home.display, rightTextEnd, nameY, `700 ${Math.round(40 * S)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`, rgb(THEME.TEXT, 1), "right", "top");

    drawText(ctx, `Win Prob: ${fmtPct(wpBDisp)}`, rightTextEnd, probY, probFont, rgb(home.color, 1), "right", "top");

    // possession icon near the team that has ball (away hasBall flag)
    if (last.hasBallA === 0 || last.hasBallA === 1) {
      const icon = assets.footballIcon;
      const gap = Math.round(14 * S);
      const iconSize = Math.round(30 * S);

      ctx.save();
      ctx.font = `700 ${Math.round(40 * S)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      const wAwayName = ctx.measureText(away.display).width;
      ctx.restore();

      if (icon) {
        if (last.hasBallA === 1) {
          ctx.drawImage(icon, leftTextX + wAwayName + gap, nameY + Math.round(10 * S), iconSize, iconSize);
        } else {
          // place near home name start
          const homeNameStartX = rightTextEnd - wHomeName;
          ctx.drawImage(icon, homeNameStartX - gap - iconSize, nameY + Math.round(10 * S), iconSize, iconSize);
        }
      }
    }

    // ============================================================
    // CENTER STACK (league/week/score/time/strip)
    // ============================================================
    const headerCx = Math.floor((x0 + x1) / 2);
    const headerInnerTop = y0 + Math.round(18 * S);
    const headerInnerBot = y0 + headerH - Math.round(18 * S);
    const usableH = headerInnerBot - headerInnerTop;

    const scoreA = String(Math.floor(last.scoreA));
    const scoreB = String(Math.floor(last.scoreB));
    const dash = "—";
    const timeStr = `${fmtClock(last.minutesLeft)} REMAINING`;

    let strip = null;
    if (isNum(last.quarter)) {
      const parts = [`Q${last.quarter}`];
      const dn = fmtDownOrdinal(last.down);
      if (dn && isNum(last.distance)) parts.push(`${dn} & ${last.distance}`);
      if (isNum(last.ytg)) parts.push(`YTG ${last.ytg}`);
      strip = parts.join(" • ");
    }

    let scale = 1.0;
    let stackH = 999999;
    let fonts = null;

    for (let i = 0; i < 18; i++) {
      const leaguePx = Math.max(10, Math.round(20 * S * scale));
      const weekPx = Math.max(10, Math.round(17 * S * scale));
      const scorePx = Math.max(10, Math.round(110 * S * scale));
      const timePx = Math.max(10, Math.round(30 * S * scale));
      const stripPx = Math.max(10, Math.round(20 * S * scale));

      const titleGap = Math.round(6 * S * scale);
      const gapTitleToScore = Math.round(14 * S * scale);
      const gapScoreToTime = Math.round(30 * S * scale);
      const gapTimeToStrip = strip ? Math.round(12 * S * scale) : 0;

      const leagueFont = `700 ${leaguePx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      const weekFont = `600 ${weekPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      const scoreFont = `800 ${scorePx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      const timeFont = `700 ${timePx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      const stripFont = `600 ${stripPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;

      ctx.save();
      ctx.font = leagueFont;
      const lnH = leaguePx * 1.1;
      ctx.font = weekFont;
      const wkH = weekPx * 1.1;
      const leagueBlockH = lnH + titleGap + wkH;

      ctx.font = scoreFont;
      const scoreHh = scorePx * 1.05;

      ctx.font = timeFont;
      const timeHh = timePx * 1.1;

      const pillH = timeHh + 2 * Math.round(13 * S * scale);

      const stripH = strip ? stripPx * 1.1 : 0;

      stackH = leagueBlockH + gapTitleToScore + scoreHh + gapScoreToTime + pillH + (strip ? gapTimeToStrip + stripH : 0);

      ctx.restore();

      if (stackH <= usableH * 0.92) {
        fonts = { leagueFont, weekFont, scoreFont, timeFont, stripFont, titleGap, gapTitleToScore, gapScoreToTime, gapTimeToStrip, timePx, scale };
        break;
      }
      scale *= 0.92;
    }

    if (!fonts) {
      // fallback minimal
      fonts = {
        leagueFont: `700 ${Math.round(18 * S)}px system-ui`,
        weekFont: `600 ${Math.round(15 * S)}px system-ui`,
        scoreFont: `800 ${Math.round(90 * S)}px system-ui`,
        timeFont: `700 ${Math.round(26 * S)}px system-ui`,
        stripFont: `600 ${Math.round(18 * S)}px system-ui`,
        titleGap: Math.round(6 * S * 0.85),
        gapTitleToScore: Math.round(14 * S * 0.85),
        gapScoreToTime: Math.round(30 * S * 0.85),
        gapTimeToStrip: strip ? Math.round(12 * S * 0.85) : 0,
        timePx: Math.round(26 * S),
        scale: 0.85,
      };
    }

    const stackTop = headerInnerTop + Math.max(0, Math.floor((usableH - stackH) / 2));

    // league + week (centered)
    drawText(ctx, cfg.leagueName, headerCx, stackTop, fonts.leagueFont, rgb(THEME.TEXT, 1), "center", "top");
    const leaguePxApprox = parseInt(fonts.leagueFont.match(/(\d+)px/)?.[1] || "18", 10);
    const weekY = stackTop + Math.round(leaguePxApprox * 1.1) + fonts.titleGap;
    drawText(ctx, cfg.weekLabel, headerCx, weekY, fonts.weekFont, rgb(THEME.SUBTEXT, 1), "center", "top");

    // score line
    const weekPxApprox = parseInt(fonts.weekFont.match(/(\d+)px/)?.[1] || "16", 10);
    const scoreY = weekY + Math.round(weekPxApprox * 1.1) + fonts.gapTitleToScore;

    // measure score total width
    ctx.save();
    ctx.font = fonts.scoreFont;
    const wA = ctx.measureText(scoreA).width;
    const wD = ctx.measureText(dash).width;
    const wB = ctx.measureText(scoreB).width;
    ctx.restore();

    const gapSB = Math.round(26 * S * fonts.scale);
    const scoreTotalW = wA + gapSB + wD + gapSB + wB;
    let sx = headerCx - scoreTotalW / 2;

    drawText(ctx, scoreA, sx, scoreY, fonts.scoreFont, rgb(THEME.TEXT, 1), "left", "top");
    sx += wA + gapSB;
    drawText(ctx, dash, sx, scoreY, fonts.scoreFont, rgb(THEME.MUTED, 1), "left", "top");
    sx += wD + gapSB;
    drawText(ctx, scoreB, sx, scoreY, fonts.scoreFont, rgb(THEME.TEXT, 1), "left", "top");

    const scorePxApprox = parseInt(fonts.scoreFont.match(/(\d+)px/)?.[1] || "90", 10);
    const scoreHApprox = Math.round(scorePxApprox * 1.05);

    // time pill
    ctx.save();
    ctx.font = fonts.timeFont;
    const tw = ctx.measureText(timeStr).width;
    ctx.restore();

    const pillPadX = Math.round(26 * S * fonts.scale);
    const pillPadY = Math.round(13 * S * fonts.scale);
    const pillW = tw + 2 * pillPadX;
    const pillH = Math.round((fonts.timePx * 1.1) + 2 * pillPadY);

    const pillX = headerCx - pillW / 2;
    const pillY = scoreY + scoreHApprox + fonts.gapScoreToTime;
    const pillR = Math.floor(pillH / 2);

    drawGradientRect(ctx, pillX, pillY, pillW, pillH, THEME.CARD_LIGHT, THEME.CARD, 1, true, pillR);
    ctx.save();
    roundRectPath(ctx, pillX, pillY, pillW, pillH, pillR);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = Math.max(2, Math.round(3 * S));
    ctx.stroke();
    ctx.restore();

    drawText(ctx, timeStr, headerCx, pillY + pillH / 2, fonts.timeFont, rgb(THEME.TEXT, 1), "center", "middle");

    // strip
    if (strip) {
      const stripY = pillY + pillH + fonts.gapTimeToStrip;
      drawText(ctx, strip, headerCx, stripY, fonts.stripFont, rgb(THEME.MUTED, 1), "center", "top");
    }

    // ============================================================
    // CHART PANEL
    // ============================================================
    const panelPadX = Math.round(70 * S);
    const panelTop = y0 + headerH + Math.round(32 * S);
    const panelBottom = y1 - Math.round(145 * S);

    const px0 = x0 + panelPadX;
    const px1 = x1 - panelPadX;
    const py0 = panelTop;
    const py1 = panelBottom;
    const pr = Math.round(28 * S);

    drawShadowedPanel(ctx, px0, py0, px1 - px0, py1 - py0, pr, Math.round(25 * S), Math.round(50 * S));
    drawGradientRect(ctx, px0, py0, px1 - px0, py1 - py0, THEME.CARD_LIGHT, THEME.CARD, 1, true, pr);
    ctx.save();
    roundRectPath(ctx, px0, py0, px1 - px0, py1 - py0, pr);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = Math.max(2, Math.round(3 * S));
    ctx.stroke();
    ctx.restore();

    const innerPad = Math.round(32 * S);
    const gx0 = px0 + innerPad;
    const gy0 = py0 + innerPad;
    const gx1 = px1 - innerPad;
    const gy1 = py1 - innerPad;

    // chart background
    ctx.save();
    ctx.fillStyle = "rgba(43,55,75,0.35)";
    roundRectPath(ctx, gx0, gy0, gx1 - gx0, gy1 - gy0, Math.round(18 * S));
    ctx.fill();
    ctx.restore();

    // prepare series
    let xRaw = snaps.map(s => s.minutesElapsed);
    let yRaw = snaps.map(s => clamp(s.wpA, 0, 1));

    // sort by x
    const order = xRaw.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v).map(o => o.i);
    xRaw = order.map(i => xRaw[i]);
    yRaw = order.map(i => yRaw[i]);

    const cd = compressDuplicateX(xRaw, yRaw);
    const sm = smoothSeries(cd.x, cd.y, 40);
    const xs = sm.xs;
    const ys = sm.ys;

    const xmax = xs.length ? Math.max(...xs) : 1;
    const xMin = -xmax * 0.02;
    const xMax = xmax * 1.02;

    const toX = (x) => gx0 + ((x - xMin) / (xMax - xMin)) * (gx1 - gx0);
    const toY = (y) => gy0 + (1 - y) * (gy1 - gy0);

    // grid lines
    ctx.save();
    ctx.lineWidth = Math.round(1.5 * S);
    ctx.strokeStyle = rgb(THEME.GRID, 0.45);
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const yy = toY(t);
      ctx.beginPath();
      ctx.moveTo(gx0, yy);
      ctx.lineTo(gx1, yy);
      ctx.stroke();
    }
    // x grid light
    ctx.lineWidth = Math.round(1 * S);
    ctx.strokeStyle = rgb(THEME.GRID, 0.18);
    ctx.setLineDash([Math.round(2 * S), Math.round(8 * S)]);
    for (let i = 1; i <= 5; i++) {
      const xx = gx0 + (i / 6) * (gx1 - gx0);
      ctx.beginPath();
      ctx.moveTo(xx, gy0);
      ctx.lineTo(xx, gy1);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();

    // midline (50%)
    ctx.save();
    ctx.lineWidth = Math.round(2.2 * S);
    ctx.strokeStyle = "rgba(210,210,210,0.22)";
    const midY = toY(0.5);
    ctx.beginPath();
    ctx.moveTo(gx0, midY);
    ctx.lineTo(gx1, midY);
    ctx.stroke();
    ctx.restore();

    // pregame baseline
    const pregame = findPregame(snaps);
    if (cfg.showPregameBaseline && pregame != null) {
      ctx.save();
      ctx.lineWidth = Math.round(2 * S);
      ctx.strokeStyle = rgb(THEME.MUTED, 0.45);
      ctx.setLineDash([Math.round(10 * S), Math.round(10 * S)]);
      const yy = toY(pregame);
      ctx.beginPath();
      ctx.moveTo(gx0, yy);
      ctx.lineTo(gx1, yy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // big swing
    const { best: swing, bestUpdate } = computeBigSwing(snaps);
    let bigSwingX = null;
    for (const s of snaps) if (s.update === bestUpdate) { bigSwingX = s.minutesElapsed; break; }
    if (bigSwingX != null) {
      ctx.save();
      ctx.lineWidth = Math.round(2 * S);
      ctx.strokeStyle = rgb(THEME.MUTED, 0.35);
      ctx.setLineDash([Math.round(10 * S), Math.round(10 * S)]);
      const xx = toX(bigSwingX);
      ctx.beginPath();
      ctx.moveTo(xx, gy0);
      ctx.lineTo(xx, gy1);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    // fill above/below 0.5 + draw colored line segments
    const colA = rgb(away.color, 0.28);
    const colB = rgb(home.color, 0.28);

    // fill by building two polygons (above and below)
    function fillRegion(predicateAbove, fillStyle) {
      const pts = [];
      for (let i = 0; i < xs.length; i++) {
        const y = ys[i];
        if (predicateAbove(y)) pts.push([toX(xs[i]), toY(y)]);
      }
      if (pts.length < 2) return;

      ctx.save();
      ctx.fillStyle = fillStyle;
      ctx.beginPath();
      // start at first point projected to baseline
      ctx.moveTo(pts[0][0], midY);
      for (const [px, py] of pts) ctx.lineTo(px, py);
      ctx.lineTo(pts[pts.length - 1][0], midY);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    fillRegion((y) => y >= 0.5, colA);
    fillRegion((y) => y < 0.5, colB);

    // line segments with color based on midy
    ctx.save();
    ctx.lineWidth = Math.round(5.2 * S);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (let i = 0; i < xs.length - 1; i++) {
      const ymid = 0.5 * (ys[i] + ys[i + 1]);
      ctx.strokeStyle = (ymid >= 0.5) ? rgb(away.color, 0.95) : rgb(home.color, 0.95);
      ctx.beginPath();
      ctx.moveTo(toX(xs[i]), toY(ys[i]));
      ctx.lineTo(toX(xs[i + 1]), toY(ys[i + 1]));
      ctx.stroke();
    }
    ctx.restore();

    // end marker dot (smoothed endpoint)
    const lastX = xs.length ? xs[xs.length - 1] : 0;
    const lastY = ys.length ? ys[ys.length - 1] : 0.5;
    const lastCol = (lastY >= 0.5) ? away.color : home.color;
    const ex = toX(lastX);
    const ey = toY(lastY);

    // glow rings
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const sz = [380, 260, 180][i] * S;
      const alpha = 0.14 - i * 0.04;
      ctx.fillStyle = rgb(lastCol, alpha);
      ctx.beginPath();
      ctx.arc(ex, ey, Math.sqrt(sz / Math.PI), 0, Math.PI * 2);
      ctx.fill();
    }
    // solid dot + white stroke
    ctx.fillStyle = rgb(lastCol, 1);
    ctx.beginPath();
    ctx.arc(ex, ey, Math.sqrt((185 * S) / Math.PI), 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = Math.round(4 * S);
    ctx.strokeStyle = rgb(THEME.TEXT, 1);
    ctx.stroke();
    ctx.restore();

    // axes labels (simple)
    const axisFont = `700 ${Math.round(16 * S)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    drawText(ctx, "Win Probability", gx0 - Math.round(10 * S), (gy0 + gy1) / 2, axisFont, rgb(THEME.SUBTEXT, 1), "right", "middle");
    drawText(ctx, "Game Progress (minutes elapsed)", (gx0 + gx1) / 2, gy1 + Math.round(26 * S), axisFont, rgb(THEME.SUBTEXT, 1), "center", "top");

    // y tick labels
    const yTickFont = `800 ${Math.round(14 * S)}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const yy = toY(t);
      drawText(ctx, `${Math.round(t * 100)}%`, gx0 - Math.round(12 * S), yy, yTickFont, rgb(THEME.TEXT, 1), "right", "middle");
    }

    // ============================================================
    // BOTTOM PILLS (LIVE / MOMENTUM / CLUTCH / SWING / PREGAME EDGE)
    // ============================================================
    const status = last.minutesLeft <= 1e-6 ? "FINAL" : "LIVE";
    const mom = computeMomentum(snaps, cfg.momentumN);
    const momPct = Math.round(mom * 100);
    const momBg = momPct >= 0 ? away.color : home.color;
    const clutch = computeClutchIndex(snaps);
    const swingPct = Math.round(swing * 100);
    const pre = pregame != null ? Math.round((pregame - 0.5) * 100) : null;

    const items = [];
    if (status === "LIVE") items.push({ text: "● LIVE", bg: THEME.LIVE_BG, a: 1 });
    else items.push({ text: "FINAL", bg: THEME.FINAL_BG, a: 1 });

    items.push({ text: `MOMENTUM ${momPct >= 0 ? "+" : ""}${momPct}%`, bg: momBg, a: 0.96 });
    items.push({ text: `CLUTCH ${clutch}`, bg: [100, 116, 139], a: 0.92 });
    items.push({ text: `BIG SWING ${swingPct >= 0 ? "+" : ""}${swingPct}% @#${bestUpdate}`, bg: [71, 85, 105], a: 0.88 });
    if (pre != null) items.push({ text: `PREGAME EDGE ${pre >= 0 ? "+" : ""}${pre}%`, bg: [51, 65, 85], a: 0.84 });

    const pillsY = y1 - Math.round(98 * S);
    const availLeft = x0 + Math.round(64 * S);
    const availRight = x1 - Math.round(64 * S);
    const availW = availRight - availLeft;

    let fontPx = Math.round(24 * S);
    let pillFont = `700 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    const r = Math.round(24 * S);
    const padX0 = Math.round(24 * S);
    const padY0 = Math.round(14 * S);
    const gap = Math.round(18 * S);

    // auto-shrink if too wide
    for (let tries = 0; tries < 10; tries++) {
      pillFont = `700 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      let total = 0;
      for (const it of items) {
        const m = pillMeasure(ctx, it.text, pillFont, padX0, padY0);
        total += m.w;
      }
      total += gap * (items.length - 1);
      if (total <= availW || fontPx <= Math.round(16 * S)) break;
      fontPx = Math.round(fontPx * 0.92);
    }
    pillFont = `700 ${fontPx}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;

    // draw centered row
    const measured = items.map(it => ({ it, m: pillMeasure(ctx, it.text, pillFont, padX0, padY0) }));
    const totalW = measured.reduce((a, b) => a + b.m.w, 0) + gap * (measured.length - 1);
    let x = availLeft + Math.max(0, Math.floor((availW - totalW) / 2));

    for (const { it, m } of measured) {
      const bg = rgb(it.bg, it.a);
      const stroke = "rgba(255,255,255,0.28)";
      drawPill(ctx, x, pillsY, m.w, m.h, r, bg, stroke, it.text, pillFont, "rgba(255,255,255,1)");
      x += m.w + gap;
    }
  }

  // ============================================================
  // ASSET LOADING
  // ============================================================
  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      // GitHub Pages safe:
      img.src = src;
    });
  }

  async function loadAssets(awayTeam, homeTeam) {
    const away = TEAMS[awayTeam];
    const home = TEAMS[homeTeam];
    const [logoAway, logoHome] = await Promise.all([
      loadImage(away.logo).catch(() => null),
      loadImage(home.logo).catch(() => null),
    ]);
    const footballIcon = footballIconCanvas(64);
    return { logoAway, logoHome, footballIcon };
  }

  // ============================================================
  // FETCH + LOOP
  // ============================================================
  async function fetchSnapshots(awayTeam, homeTeam) {
    if (!SHEET_CSV_URL || SHEET_CSV_URL.includes("PASTE_YOUR_PUBLISHED")) {
      throw new Error("Set SHEET_CSV_URL in app.js to your published Google Sheet CSV endpoint.");
    }

    const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to fetch CSV: HTTP ${res.status}`);
    const text = await res.text();

    const csv = parseCSV(text);
    const { headers, out: objs } = rowsToObjects(csv);
    const snaps = parseSnapshots(objs, headers, awayTeam, homeTeam);
    return snaps;
  }

  // ============================================================
  // UI + BOOT
  // ============================================================
  function ensureRoot() {
    let root = document.getElementById("app");
    if (!root) {
      root = document.createElement("div");
      root.id = "app";
      document.body.appendChild(root);
    }
    root.style.display = "grid";
    root.style.placeItems = "center";
    root.style.padding = "18px";
    root.style.background = "transparent";
    root.style.color = "white";
    root.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial";
    return root;
  }

  function buildUI(root, state) {
    // Controls
    const bar = document.createElement("div");
    bar.style.width = "min(1100px, 100%)";
    bar.style.display = "flex";
    bar.style.gap = "12px";
    bar.style.alignItems = "center";
    bar.style.justifyContent = "space-between";
    bar.style.flexWrap = "wrap";
    bar.style.marginBottom = "12px";

    const left = document.createElement("div");
    left.style.display = "flex";
    left.style.gap = "10px";
    left.style.alignItems = "center";
    left.style.flexWrap = "wrap";

    const mkSelect = (labelText, value, onChange) => {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "8px";

      const lab = document.createElement("span");
      lab.textContent = labelText;
      lab.style.opacity = "0.85";
      lab.style.fontWeight = "600";

      const sel = document.createElement("select");
      sel.style.padding = "8px 10px";
      sel.style.borderRadius = "10px";
      sel.style.border = "1px solid rgba(255,255,255,0.18)";
      sel.style.background = "rgba(28,37,54,0.85)";
      sel.style.color = "white";
      sel.style.fontWeight = "700";
      sel.style.outline = "none";

      for (const k of Object.keys(TEAMS)) {
        const opt = document.createElement("option");
        opt.value = k;
        opt.textContent = TEAMS[k].display;
        if (k === value) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => onChange(sel.value));
      wrap.appendChild(lab);
      wrap.appendChild(sel);
      return wrap;
    };

    left.appendChild(mkSelect("Away", state.awayTeam, (v) => { state.awayTeam = v; state.trigger(); }));
    left.appendChild(mkSelect("Home", state.homeTeam, (v) => { state.homeTeam = v; state.trigger(); }));

    const right = document.createElement("div");
    right.style.display = "flex";
    right.style.gap = "10px";
    right.style.alignItems = "center";
    right.style.flexWrap = "wrap";

    const status = document.createElement("div");
    status.style.opacity = "0.85";
    status.style.fontWeight = "700";
    status.id = "statusText";
    status.textContent = "Loading...";

    const dl = document.createElement("button");
    dl.textContent = "Download PNG";
    dl.style.padding = "8px 12px";
    dl.style.borderRadius = "10px";
    dl.style.border = "1px solid rgba(255,255,255,0.18)";
    dl.style.background = "rgba(43,55,75,0.85)";
    dl.style.color = "white";
    dl.style.fontWeight = "800";
    dl.style.cursor = "pointer";
    dl.addEventListener("click", () => {
      const a = document.createElement("a");
      a.download = `${state.awayTeam}_vs_${state.homeTeam}.png`;
      a.href = state.canvas.toDataURL("image/png");
      a.click();
    });

    right.appendChild(status);
    right.appendChild(dl);

    bar.appendChild(left);
    bar.appendChild(right);

    // Canvas
    const canvas = document.createElement("canvas");
    canvas.style.width = "min(1100px, 100%)";
    canvas.style.height = "auto";
    canvas.style.borderRadius = "18px";
    canvas.style.boxShadow = "0 18px 55px rgba(0,0,0,0.45)";
    canvas.style.background = `rgba(${THEME.BG[0]},${THEME.BG[1]},${THEME.BG[2]},1)`;

    root.appendChild(bar);
    root.appendChild(canvas);

    state.canvas = canvas;
    state.statusEl = status;
  }

  async function drawOnce(state) {
    const cfg = {
      leagueName: DEFAULTS.leagueName,
      weekLabel: DEFAULTS.weekLabel,
      awayTeam: state.awayTeam,
      homeTeam: state.homeTeam,
      refreshSeconds: state.refreshSeconds,
      canvasW: DEFAULTS.canvasW,
      canvasH: DEFAULTS.canvasH,
      supersample: DEFAULTS.supersample,
      showPregameBaseline: DEFAULTS.showPregameBaseline,
      momentumN: DEFAULTS.momentumN,
      displayClampLo: DEFAULTS.displayClampLo,
      displayClampHi: DEFAULTS.displayClampHi,
    };

    // enforce different teams
    if (cfg.awayTeam === cfg.homeTeam) {
      state.statusEl.textContent = "Pick two different teams.";
      return;
    }

    // canvas sizing
    const W = cfg.canvasW * cfg.supersample;
    const H = cfg.canvasH * cfg.supersample;
    state.canvas.width = W;
    state.canvas.height = H;

    const ctx = state.canvas.getContext("2d");

    state.statusEl.textContent = "Loading sheet…";

    const [assets, snaps] = await Promise.all([
      loadAssets(cfg.awayTeam, cfg.homeTeam),
      fetchSnapshots(cfg.awayTeam, cfg.homeTeam),
    ]);

    renderCard(ctx, snaps, cfg, assets);

    const now = new Date();
    state.statusEl.textContent = `Updated ${now.toLocaleTimeString()}`;
  }

  async function boot() {
    const q = parseQuery();
    const state = {
      awayTeam: TEAMS[q.away] ? q.away : DEFAULTS.awayTeam,
      homeTeam: TEAMS[q.home] ? q.home : DEFAULTS.homeTeam,
      refreshSeconds: q.refreshSeconds,
      canvas: null,
      statusEl: null,
      timer: null,
      inFlight: false,
      pending: false,
      trigger: null,
    };

    const root = ensureRoot();
    buildUI(root, state);

    state.trigger = async () => {
      if (state.inFlight) { state.pending = true; return; }
      state.inFlight = true;
      try {
        await drawOnce(state);
      } catch (e) {
        console.error(e);
        state.statusEl.textContent = String(e?.message || e);
      } finally {
        state.inFlight = false;
        if (state.pending) { state.pending = false; state.trigger(); }
      }
    };

    await state.trigger();

    clearInterval(state.timer);
    state.timer = setInterval(() => state.trigger(), Math.round(state.refreshSeconds * 1000));
  }

  // Start
  window.addEventListener("DOMContentLoaded", boot);
})();
