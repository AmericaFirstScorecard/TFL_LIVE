(() => {
  /**********************
   * CONFIG
   **********************/
  // 1) Publish your Google Sheet tab to the web as CSV.
  // Use the gviz CSV endpoint (works well with CORS):
  // https://docs.google.com/spreadsheets/d/<ID>/gviz/tq?tqx=out:csv&sheet=<TAB_NAME>
  const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxNr3jLVjL4e24TvQR9iSkJP0T_lBiA2Dh5G9iut5_zDksYHEnbsu8k8f5Eo888Aha_UWuZXRhFNV0/pub?gid=0&single=true&output=csv";

  // Canvas output size (matches your Python output)
  const FINAL_W = 1800;
  const FINAL_H = 1050;

  // Display clamp for win prob like your code
  const DISPLAY_CLAMP_LO = 0.01;
  const DISPLAY_CLAMP_HI = 0.99;

  // Momentum window
  const MOMENTUM_N = 5;

  // Smoothing
  const POINTS_PER_SEGMENT = 40;
  const SMOOTH_WIN = 13; // odd
  const SHOW_PREGAME_BASELINE = true;

  // Optional query param: ?refresh=10 (seconds)
  const REFRESH_SEC = (() => {
    const u = new URL(location.href);
    const v = Number(u.searchParams.get("refresh"));
    return Number.isFinite(v) && v > 0 ? v : 0;
  })();

  /**********************
   * THEME (dark premium)
   **********************/
  const THEME = {
    BG: rgb(12, 16, 28),
    CARD: rgb(28, 37, 54),
    CARD_LIGHT: rgb(43, 55, 75),

    TEXT: rgb(245, 247, 252),
    SUBTEXT: rgb(199, 207, 220),
    MUTED: rgb(146, 158, 178),
    GRID: rgb(79, 95, 122),
    AXIS: rgb(112, 126, 152),

    LIVE_BG: rgb(239, 68, 68),
    FINAL_BG: rgb(107, 114, 128),
  };

  /**********************
   * TEAM KEYS + LOGOS
   * Keys MUST be: SanFran, Bengals, Cowboys, Giants, Louis
   **********************/
  const TEAM = {
    SanFran: {
      key: "SanFran",
      display: "SanFran",
      logo: "logos/Sanfran.png",
      color: rgb(220, 38, 38),
    },
    Bengals: {
      key: "Bengals",
      display: "Bengals",
      logo: "logos/bengals.png",
      color: rgb(249, 115, 22),
    },
    Cowboys: {
      key: "Cowboys",
      display: "Cowboys",
      logo: "logos/cowboys.png",
      color: rgb(37, 99, 235),
    },
    Giants: {
      key: "Giants",
      display: "Giants",
      logo: "logos/giants.png",
      color: rgb(59, 130, 246),
    },
    Louis: {
      key: "Louis",
      display: "Louis",
      logo: "logos/Cards.png",
      color: rgb(190, 18, 60),
    },
  };

  // Accept common variants from your sheet and normalize to the required keys above.
  const TEAM_ALIASES = new Map([
    // SanFran
    ["sanfran", "SanFran"],
    ["san fran", "SanFran"],
    ["sf", "SanFran"],
    ["49ers", "SanFran"],
    ["niners", "SanFran"],
    ["sanfrancisco", "SanFran"],
    ["san francisco", "SanFran"],

    // Bengals
    ["bengals", "Bengals"],
    ["cin", "Bengals"],
    ["cincinnati", "Bengals"],

    // Cowboys
    ["cowboys", "Cowboys"],
    ["dal", "Cowboys"],
    ["dallas", "Cowboys"],

    // Giants
    ["giants", "Giants"],
    ["nyg", "Giants"],
    ["new york giants", "Giants"],
    ["newyorkgiants", "Giants"],

    // Louis (Cardinals / Louis)
    ["louis", "Louis"],
    ["lou", "Louis"],
    ["cardinals", "Louis"],
    ["cards", "Louis"],
    ["ari", "Louis"],
    ["arizona", "Louis"],
  ]);

  function normalizeTeamKey(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    // Try exact key first
    if (TEAM[s]) return s;
    const low = s.toLowerCase().replace(/\s+/g, " ").trim();
    const mapped = TEAM_ALIASES.get(low);
    if (mapped && TEAM[mapped]) return mapped;

    // Also try stripping spaces entirely
    const tight = low.replace(/\s+/g, "");
    const mapped2 = TEAM_ALIASES.get(tight);
    if (mapped2 && TEAM[mapped2]) return mapped2;

    return null;
  }

  /**********************
   * UI BOOTSTRAP
   **********************/
  const app = document.getElementById("app");
  app.style.minHeight = "100vh";
  app.style.display = "grid";
  app.style.placeItems = "center";
  app.style.padding = "24px";

  const wrap = document.createElement("div");
  wrap.style.width = "min(96vw, 1800px)";
  wrap.style.display = "grid";
  wrap.style.gap = "12px";
  app.appendChild(wrap);

  const statusLine = document.createElement("div");
  statusLine.style.color = "rgba(245,247,252,0.85)";
  statusLine.style.fontFamily = "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif";
  statusLine.style.fontSize = "14px";
  statusLine.style.lineHeight = "1.4";
  statusLine.textContent = "Loading…";
  wrap.appendChild(statusLine);

  const canvas = document.createElement("canvas");
  canvas.width = FINAL_W;
  canvas.height = FINAL_H;
  canvas.style.width = "100%";
  canvas.style.height = "auto";
  canvas.style.borderRadius = "18px";
  canvas.style.boxShadow = "0 30px 80px rgba(0,0,0,0.45)";
  wrap.appendChild(canvas);

  const ctx = canvas.getContext("2d");

  /**********************
   * HELPERS
   **********************/
  function rgb(r, g, b, a = 1) {
    return { r, g, b, a };
  }
  function rgbaStr(c) {
    return `rgba(${c.r},${c.g},${c.b},${c.a})`;
  }
  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }
  function isNum(x) {
    return Number.isFinite(x);
  }
  function toNum(x) {
    const n = Number(String(x).trim());
    return Number.isFinite(n) ? n : NaN;
  }

  // Minutes Left: accept standard float or MM.SS style (18.40 => 18m40s)
  function parseMinutesLeft(v) {
    const n = toNum(v);
    if (!Number.isFinite(n) || n < 0) return n;
    const m = Math.floor(n);
    const frac = n - m;
    const ss = Math.round(frac * 100);
    if (ss >= 0 && ss <= 59) {
      return m + ss / 60;
    }
    return n;
  }

  function fmtClock(minutesFloat) {
    let t = Math.max(0, minutesFloat);
    let m = Math.floor(t);
    let s = Math.round((t - m) * 60);
    if (s === 60) {
      m += 1;
      s = 0;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function fmtPct(p) {
    return `${Math.round(p * 100)}%`;
  }

  function downOrdinal(d) {
    if (!Number.isFinite(d)) return null;
    if (d === 1) return "1st";
    if (d === 2) return "2nd";
    if (d === 3) return "3rd";
    return `${d}th`;
  }

  // Rounded rect path
  function roundRectPath(c, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function fillRoundedRect(c, x, y, w, h, r, fillStyle) {
    c.save();
    roundRectPath(c, x, y, w, h, r);
    c.fillStyle = fillStyle;
    c.fill();
    c.restore();
  }

  function strokeRoundedRect(c, x, y, w, h, r, strokeStyle, lineWidth = 1) {
    c.save();
    roundRectPath(c, x, y, w, h, r);
    c.strokeStyle = strokeStyle;
    c.lineWidth = lineWidth;
    c.stroke();
    c.restore();
  }

  function dropShadowRoundedRect(c, x, y, w, h, r, shadowColor, blur, offX, offY) {
    c.save();
    c.shadowColor = shadowColor;
    c.shadowBlur = blur;
    c.shadowOffsetX = offX;
    c.shadowOffsetY = offY;
    fillRoundedRect(c, x, y, w, h, r, "rgba(0,0,0,0)"); // just to cast shadow
    c.restore();
  }

  function linearGrad(c, x0, y0, x1, y1, stops) {
    const g = c.createLinearGradient(x0, y0, x1, y1);
    for (const [t, col] of stops) g.addColorStop(t, col);
    return g;
  }

  /**********************
   * CSV PARSER (handles quotes/commas)
   **********************/
  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const next = text[i + 1];

      if (ch === '"' && inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      if (ch === '"') {
        inQuotes = !inQuotes;
        continue;
      }
      if (ch === "," && !inQuotes) {
        row.push(cur);
        cur = "";
        continue;
      }
      if ((ch === "\n" || ch === "\r") && !inQuotes) {
        if (ch === "\r" && next === "\n") i++;
        row.push(cur);
        cur = "";
        // ignore completely empty trailing lines
        if (row.some(v => String(v).trim() !== "")) rows.push(row);
        row = [];
        continue;
      }
      cur += ch;
    }
    row.push(cur);
    if (row.some(v => String(v).trim() !== "")) rows.push(row);

    if (!rows.length) return { headers: [], records: [] };

    const headers = rows[0].map(h => String(h ?? "").trim());
    const records = rows.slice(1).map(cols => {
      const rec = {};
      for (let i = 0; i < headers.length; i++) {
        rec[headers[i]] = cols[i] ?? "";
      }
      return rec;
    });

    return { headers, records };
  }

  function headerIndex(headers) {
    const map = new Map();
    headers.forEach(h => map.set(String(h).trim().toLowerCase(), h));
    return map;
  }

  function pickHeader(headersMap, candidates) {
    for (const c of candidates) {
      const key = String(c).trim().toLowerCase();
      if (headersMap.has(key)) return headersMap.get(key);
    }
    return null;
  }

  /**********************
   * SNAPSHOT BUILD
   **********************/
  function computeBigSwing(snaps) {
    let best = 0;
    let bestUpdate = snaps.length ? snaps[snaps.length - 1].update : 0;
    for (let i = 1; i < snaps.length; i++) {
      const d = snaps[i].wpAway - snaps[i - 1].wpAway;
      if (Math.abs(d) > Math.abs(best)) {
        best = d;
        bestUpdate = snaps[i].update;
      }
    }
    return { swing: best, update: bestUpdate };
  }

  function computeMomentum(snaps, n) {
    if (snaps.length < 2) return 0;
    const k = Math.max(1, Math.min(n, snaps.length - 1));
    return snaps[snaps.length - 1].wpAway - snaps[snaps.length - 1 - k].wpAway;
  }

  function computeClutchIndex(snaps) {
    if (snaps.length < 3) return 0;
    const ys = snaps.map(s => s.wpAway);
    const diffs = [];
    for (let i = 1; i < ys.length; i++) diffs.push(ys[i] - ys[i - 1]);
    const mean = diffs.reduce((a, b) => a + b, 0) / diffs.length;
    const var_ = diffs.reduce((acc, d) => acc + (d - mean) * (d - mean), 0) / Math.max(1, diffs.length - 1);
    const vol = Math.sqrt(var_);
    let crossings = 0;
    for (let i = 1; i < ys.length; i++) {
      if ((ys[i - 1] < 0.5 && ys[i] >= 0.5) || (ys[i - 1] >= 0.5 && ys[i] < 0.5)) crossings++;
    }
    const score = crossings * 18 + vol * 240;
    return Math.round(clamp(score, 0, 100));
  }

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

    // Edge-padded moving average
    const win = SMOOTH_WIN;
    if (ys.length >= win) {
      const pad = Math.floor(win / 2);
      const padded = [];
      for (let i = 0; i < pad; i++) padded.push(ys[0]);
      padded.push(...ys);
      for (let i = 0; i < pad; i++) padded.push(ys[ys.length - 1]);

      const kernel = Array(win).fill(1 / win);
      const out = [];
      for (let i = 0; i < ys.length; i++) {
        let s = 0;
        for (let j = 0; j < win; j++) s += padded[i + j] * kernel[j];
        out.push(s);
      }
      return { xs, ys: out };
    }

    return { xs, ys };
  }

  function getFirstNonEmpty(records, key) {
    for (const r of records) {
      const v = r[key];
      if (v != null && String(v).trim() !== "") return v;
    }
    return null;
  }

  function buildSnapshots(headers, records) {
    const hmap = headerIndex(headers);

    // Required-ish canonical headers (with lots of aliases)
    const H_UPDATE = pickHeader(hmap, ["Update #", "Update", "Update#", "Snapshot", "Index"]);
    const H_MINLEFT = pickHeader(hmap, ["Minutes Left", "Time Left", "Clock", "Game Clock", "Minutes remaining", "Minutes Remaining"]);
    const H_AWAYTEAM = pickHeader(hmap, ["Away", "Away Team", "AwayTeam", "Team A", "Team A Name"]);
    const H_HOMETEAM = pickHeader(hmap, ["Home", "Home Team", "HomeTeam", "Team B", "Team B Name"]);

    if (!H_MINLEFT) throw new Error("Missing 'Minutes Left' column (or alias).");
    if (!H_AWAYTEAM || !H_HOMETEAM) throw new Error("Missing 'Away' and/or 'Home' columns.");

    // Determine teams from sheet (use last non-empty row info)
    const awayRaw = getFirstNonEmpty(records.slice().reverse(), H_AWAYTEAM);
    const homeRaw = getFirstNonEmpty(records.slice().reverse(), H_HOMETEAM);
    const awayKey = normalizeTeamKey(awayRaw);
    const homeKey = normalizeTeamKey(homeRaw);

    if (!awayKey || !homeKey) {
      throw new Error(
        `Away/Home team keys not recognized. Got Away='${awayRaw}', Home='${homeRaw}'. ` +
        `Must map to: SanFran, Bengals, Cowboys, Giants, Louis.`
      );
    }

    // Score columns: prefer team-named columns (Giants, Bengals, etc.), else generic
    const awayScoreCol = TEAM[awayKey]?.key && hmap.get(TEAM[awayKey].key.toLowerCase()) ? TEAM[awayKey].key : null;
    const homeScoreCol = TEAM[homeKey]?.key && hmap.get(TEAM[homeKey].key.toLowerCase()) ? TEAM[homeKey].key : null;

    const H_AWAY_SCORE = awayScoreCol || pickHeader(hmap, ["Away Score", "Score Away", "Team A", "Team A Score"]);
    const H_HOME_SCORE = homeScoreCol || pickHeader(hmap, ["Home Score", "Score Home", "Team B", "Team B Score"]);

    // Win probability: prefer "<Away> Win Probability", else generic
    const H_WP_AWAY =
      pickHeader(hmap, [`${awayKey} Win Probability`, `${awayKey} Win Prob`, `${awayKey} Win Probability `]) ||
      pickHeader(hmap, ["Away Win Probability", "Away Win Prob", "Team A Win Probability", "Team A Win Prob", "Win Probability", "Win Prob"]);

    // Possession: prefer "<Away> has Ball", else generic
    const H_HASBALL =
      pickHeader(hmap, [`${awayKey} has Ball (1=yes, 0=no)`, `${awayKey} has Ball`, `${awayKey} Possession`]) ||
      pickHeader(hmap, ["Away has Ball (1=yes, 0=no)", "Away has Ball", "Team A has Ball (1=yes, 0=no)", "Has Ball", "Possession"]);

    const H_QUARTER = pickHeader(hmap, ["Quarter", "Q", "Period"]);
    const H_DOWN = pickHeader(hmap, ["Down", "Down#", "Down #"]);
    const H_DIST = pickHeader(hmap, ["Distance", "Dist", "To Go", "Yards To Go"]);
    const H_YTG = pickHeader(hmap, ["Yards to Goal", "Yards To Goal", "YTG", "Yds to Goal"]);
    const H_PREGAME = pickHeader(hmap, ["Pregame Win Prob", "Pregame WP", "Pregame Probability", "Baseline Win Prob"]);

    if (!H_WP_AWAY) throw new Error("Missing win probability column. Use 'Away Win Probability' or '<Away> Win Probability'.");
    if (!H_AWAY_SCORE || !H_HOME_SCORE) throw new Error("Missing score columns. Use 'Away Score'/'Home Score' or team columns named SanFran/Bengals/Cowboys/Giants/Louis.");

    // Parse rows -> raw, then compute minutes elapsed like your Python logic
    let autoUpdate = 1;
    const raw = [];

    for (const r of records) {
      const upd = H_UPDATE ? toNum(r[H_UPDATE]) : NaN;
      const update = Number.isFinite(upd) ? Math.round(upd) : autoUpdate;
      autoUpdate++;

      const tLeft = parseMinutesLeft(r[H_MINLEFT]);
      const wpAway = toNum(r[H_WP_AWAY]);
      if (!Number.isFinite(tLeft) || !Number.isFinite(wpAway)) continue;

      const sAway = toNum(r[H_AWAY_SCORE]);
      const sHome = toNum(r[H_HOME_SCORE]);

      const hasBall = H_HASBALL ? Math.round(toNum(r[H_HASBALL])) : null;
      const quarter = H_QUARTER ? Math.round(toNum(r[H_QUARTER])) : null;
      const down = H_DOWN ? Math.round(toNum(r[H_DOWN])) : null;
      const dist = H_DIST ? Math.round(toNum(r[H_DIST])) : null;
      const ytg = H_YTG ? Math.round(toNum(r[H_YTG])) : null;

      const pg = H_PREGAME ? toNum(r[H_PREGAME]) : NaN;

      raw.push({
        update,
        minutesLeft: tLeft,
        wpAway: clamp(wpAway, 0, 1),
        scoreAway: Number.isFinite(sAway) ? sAway : 0,
        scoreHome: Number.isFinite(sHome) ? sHome : 0,
        hasBallAway: hasBall === 0 || hasBall === 1 ? hasBall : null,
        quarter: Number.isFinite(quarter) ? quarter : null,
        down: Number.isFinite(down) ? down : null,
        distance: Number.isFinite(dist) ? dist : null,
        ytg: Number.isFinite(ytg) ? ytg : null,
        pregame: Number.isFinite(pg) ? clamp(pg, 0, 1) : null,
      });
    }

    if (!raw.length) throw new Error("No valid snapshot rows found (check Minutes Left / WP columns).");

    raw.sort((a, b) => a.update - b.update);

    let elapsed = 0;
    let prevLeft = raw[0].minutesLeft;
    const snaps = [];

    for (let i = 0; i < raw.length; i++) {
      const d = raw[i];
      if (i === 0) {
        elapsed = 0;
        prevLeft = d.minutesLeft;
      } else {
        const step = prevLeft - d.minutesLeft;
        if (step > 0) {
          elapsed += step;
          prevLeft = d.minutesLeft;
        } else {
          prevLeft = Math.min(prevLeft, d.minutesLeft);
        }
      }

      snaps.push({
        update: d.update,
        minutesLeft: d.minutesLeft,
        minutesElapsed: elapsed,
        wpAway: d.wpAway,
        scoreAway: d.scoreAway,
        scoreHome: d.scoreHome,
        hasBallAway: d.hasBallAway,
        quarter: d.quarter,
        down: d.down,
        distance: d.distance,
        ytg: d.ytg,
        pregame: d.pregame,
      });
    }

    // Get pregame from last non-null
    let pregame = null;
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].pregame != null) { pregame = snaps[i].pregame; break; }
    }

    return { awayKey, homeKey, snaps, pregame };
  }

  /**********************
   * LOGO LOADER
   **********************/
  const imageCache = new Map();
  function loadImage(src) {
    if (imageCache.has(src)) return imageCache.get(src);
    const p = new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${src}`));
      img.src = src;
    });
    imageCache.set(src, p);
    return p;
  }

  /**********************
   * RENDER
   **********************/
  function renderCard({ awayKey, homeKey, snaps, pregame }) {
    // clear bg
    ctx.clearRect(0, 0, FINAL_W, FINAL_H);
    ctx.fillStyle = rgbaStr(THEME.BG);
    ctx.fillRect(0, 0, FINAL_W, FINAL_H);

    const last = snaps[snaps.length - 1];

    // Card outer box
    const margin = 40;
    const x0 = margin, y0 = margin;
    const x1 = FINAL_W - margin, y1 = FINAL_H - margin;
    const W = x1 - x0, H = y1 - y0;
    const radius = 40;

    // shadow
    dropShadowRoundedRect(ctx, x0, y0, W, H, radius, "rgba(0,0,0,0.55)", 55, 0, 30);

    // main gradient
    const gCard = linearGrad(ctx, x0, y0, x0, y1, [
      [0, `rgb(${THEME.CARD.r},${THEME.CARD.g},${THEME.CARD.b})`],
      [1, `rgb(${THEME.CARD_LIGHT.r},${THEME.CARD_LIGHT.g},${THEME.CARD_LIGHT.b})`],
    ]);
    fillRoundedRect(ctx, x0, y0, W, H, radius, gCard);
    strokeRoundedRect(ctx, x0, y0, W, H, radius, "rgba(255,255,255,0.18)", 3);

    // header
    const headerH = 250;
    const gHeader = linearGrad(ctx, x0, y0, x0, y0 + headerH, [
      [0, "rgb(36,46,66)"],
      [1, "rgb(28,37,54)"],
    ]);
    fillRoundedRect(ctx, x0, y0, W, headerH, radius, gHeader);

    // Layout columns
    const padX = 60;
    const leftW = Math.floor(W * 0.40);
    const rightW = Math.floor(W * 0.40);
    const centerW = W - leftW - rightW;

    const L0 = x0 + padX;
    const L1 = L0 + leftW;
    const C0 = L1;
    const C1 = C0 + centerW;
    const R0 = C1;
    const R1 = x1 - padX;

    const awayTeam = TEAM[awayKey];
    const homeTeam = TEAM[homeKey];

    // Probabilities (Away vs Home)
    const wpAwayDisp = clamp(last.wpAway, DISPLAY_CLAMP_LO, DISPLAY_CLAMP_HI);
    const wpHomeDisp = 1 - wpAwayDisp;

    // Team blocks + logos
    const logoBox = 100;
    const logoY = y0 + 90;
    const logoLeftX = L0 + 10;
    const logoRightX = R1 - 10 - logoBox;

    // names / prob text
    const nameY = y0 + 92;
    const probY = y0 + 150;

    // Draw text helpers
    function setFont(px, weight = 700) {
      ctx.font = `${weight} ${px}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
    }
    function textW(text) {
      return ctx.measureText(text).width;
    }
    function drawCentered(text, cx, cy) {
      const w = textW(text);
      ctx.fillText(text, cx - w / 2, cy);
    }

    // Left (Away)
    setFont(40, 800);
    ctx.fillStyle = rgbaStr(THEME.TEXT);
    ctx.fillText(awayTeam.display, logoLeftX + logoBox + 22, nameY);

    setFont(24, 700);
    ctx.fillStyle = rgbaStr({ ...awayTeam.color, a: 1 });
    ctx.fillText(`Win Prob: ${fmtPct(wpAwayDisp)}`, logoLeftX + logoBox + 22, probY);

    // Right (Home) aligned to right
    setFont(40, 800);
    ctx.fillStyle = rgbaStr(THEME.TEXT);
    const homeNameW = textW(homeTeam.display);
    ctx.fillText(homeTeam.display, (logoRightX - 22) - homeNameW, nameY);

    setFont(24, 700);
    ctx.fillStyle = rgbaStr({ ...homeTeam.color, a: 1 });
    const homeProbText = `Win Prob: ${fmtPct(wpHomeDisp)}`;
    const homeProbW = textW(homeProbText);
    ctx.fillText(homeProbText, (logoRightX - 22) - homeProbW, probY);

    // Possession icon (simple football)
    function drawFootballIcon(x, y, size = 30) {
      ctx.save();
      ctx.translate(x, y);
      // shadow
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(size * 0.5 + 2, size * 0.5 + 3, size * 0.42, size * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(139,69,19,1)";
      ctx.beginPath();
      ctx.ellipse(size * 0.5, size * 0.5, size * 0.42, size * 0.38, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = Math.max(2, Math.floor(size / 12));
      ctx.beginPath();
      ctx.moveTo(size * 0.28, size * 0.5);
      ctx.lineTo(size * 0.72, size * 0.5);
      ctx.stroke();

      ctx.lineWidth = Math.max(2, Math.floor(size / 20));
      for (let k = -2; k <= 2; k++) {
        const lx = size * 0.5 + (k * (size * 0.44)) / 6;
        ctx.beginPath();
        ctx.moveTo(lx, size * 0.5 - size * 0.12);
        ctx.lineTo(lx, size * 0.5 + size * 0.12);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (last.hasBallAway === 0 || last.hasBallAway === 1) {
      // If away has ball -> place near away name, else near home name
      if (last.hasBallAway === 1) {
        setFont(40, 800);
        const w = textW(awayTeam.display);
        drawFootballIcon(logoLeftX + logoBox + 22 + w + 14, y0 + 72, 30);
      } else {
        setFont(40, 800);
        const homeStartX = (logoRightX - 22) - homeNameW;
        drawFootballIcon(homeStartX - 14 - 30, y0 + 72, 30);
      }
    }

    // Center stack (league/week/score/time/strip) – use your same vibe
    const headerCx = Math.floor((x0 + x1) / 2);
    const headerTop = y0 + 18;
    const headerBot = y0 + headerH - 18;
    const usableH = headerBot - headerTop;

    const leagueName = "Tate Football League";
    const weekLabel = "Regular Season Matchup";

    const scoreAway = String(Math.trunc(last.scoreAway));
    const scoreHome = String(Math.trunc(last.scoreHome));
    const dash = "—";
    const timeStr = `${fmtClock(last.minutesLeft)} REMAINING`;

    let strip = null;
    if (last.quarter != null) {
      const parts = [`Q${last.quarter}`];
      const dn = downOrdinal(last.down);
      if (dn && last.distance != null) parts.push(`${dn} & ${last.distance}`);
      if (last.ytg != null) parts.push(`YTG ${last.ytg}`);
      strip = parts.join(" • ");
    }

    // auto-fit scale
    let scale = 1.0;
    let stackH = 0;
    let sizes = null;

    function measureStack(scale) {
      const leaguePx = Math.max(10, Math.floor(20 * scale));
      const weekPx = Math.max(10, Math.floor(17 * scale));
      const scorePx = Math.max(10, Math.floor(110 * scale));
      const timePx = Math.max(10, Math.floor(30 * scale));
      const stripPx = Math.max(10, Math.floor(20 * scale));

      const titleGap = Math.floor(6 * scale);
      const gapTitleToScore = Math.floor(14 * scale);
      const gapScoreToTime = Math.floor(30 * scale);
      const gapTimeToStrip = strip ? Math.floor(12 * scale) : 0;

      // measure text heights by using px directly (approx)
      const leagueH = leaguePx;
      const weekH = weekPx;
      const scoreH = scorePx;
      const timeH = timePx;
      const stripH = strip ? stripPx : 0;

      const leagueBlockH = leagueH + titleGap + weekH;
      let total = leagueBlockH + gapTitleToScore + scoreH + gapScoreToTime + (timeH + Math.floor(26 * scale));
      if (strip) total += gapTimeToStrip + stripH;

      return {
        leaguePx, weekPx, scorePx, timePx, stripPx,
        titleGap, gapTitleToScore, gapScoreToTime, gapTimeToStrip,
        stackH: total
      };
    }

    for (let i = 0; i < 18; i++) {
      const m = measureStack(scale);
      stackH = m.stackH;
      if (stackH <= usableH * 0.92) { sizes = m; break; }
      scale *= 0.92;
      sizes = m;
    }

    const stackTop = headerTop + Math.max(0, Math.floor((usableH - stackH) / 2));

    // Draw center stack
    // League
    setFont(sizes.leaguePx, 700);
    ctx.fillStyle = rgbaStr(THEME.TEXT);
    drawCentered(leagueName, headerCx, stackTop + sizes.leaguePx);

    // Week
    setFont(sizes.weekPx, 600);
    ctx.fillStyle = rgbaStr(THEME.SUBTEXT);
    drawCentered(weekLabel, headerCx, stackTop + sizes.leaguePx + sizes.titleGap + sizes.weekPx);

    // Score line
    const scoreY = stackTop + sizes.leaguePx + sizes.titleGap + sizes.weekPx + sizes.gapTitleToScore + sizes.scorePx;
    setFont(sizes.scorePx, 800);
    const gapSB = Math.floor(26 * scale);
    const wA = textW(scoreAway);
    const wD = textW(dash);
    const wB = textW(scoreHome);
    const scoreTotalW = wA + gapSB + wD + gapSB + wB;
    let sx = headerCx - scoreTotalW / 2;

    ctx.fillStyle = rgbaStr(THEME.TEXT);
    ctx.fillText(scoreAway, sx, scoreY);
    sx += wA + gapSB;
    ctx.fillStyle = rgbaStr(THEME.MUTED);
    ctx.fillText(dash, sx, scoreY);
    sx += wD + gapSB;
    ctx.fillStyle = rgbaStr(THEME.TEXT);
    ctx.fillText(scoreHome, sx, scoreY);

    // Time pill
    const pillY = scoreY + sizes.gapScoreToTime;
    setFont(sizes.timePx, 800);
    const tw = textW(timeStr);
    const padX = Math.floor(26 * scale);
    const padY = Math.floor(13 * scale);
    const pillW = tw + 2 * padX;
    const pillH = sizes.timePx + 2 * padY;
    const pillX = headerCx - pillW / 2;
    const pillR = pillH / 2;

    // pill gradient
    const gp = linearGrad(ctx, pillX, pillY - pillH, pillX, pillY, [
      [0, `rgb(${THEME.CARD_LIGHT.r},${THEME.CARD_LIGHT.g},${THEME.CARD_LIGHT.b})`],
      [1, `rgb(${THEME.CARD.r},${THEME.CARD.g},${THEME.CARD.b})`],
    ]);
    fillRoundedRect(ctx, pillX, pillY - pillH + 8, pillW, pillH, pillR, gp);
    strokeRoundedRect(ctx, pillX, pillY - pillH + 8, pillW, pillH, pillR, "rgba(255,255,255,0.35)", 3);

    ctx.fillStyle = rgbaStr(THEME.TEXT);
    // baseline text y alignment
    ctx.fillText(timeStr, pillX + padX, pillY);

    // Strip under pill
    if (strip) {
      setFont(sizes.stripPx, 700);
      ctx.fillStyle = rgbaStr(THEME.MUTED);
      drawCentered(strip, headerCx, pillY + sizes.gapTimeToStrip + sizes.stripPx);
    }

    // Chart panel
    const panelPadX = 70;
    const panelTop = y0 + headerH + 32;
    const panelBottom = y1 - 145;
    const px0 = x0 + panelPadX;
    const px1 = x1 - panelPadX;
    const py0 = panelTop;
    const py1 = panelBottom;
    const pr = 28;

    dropShadowRoundedRect(ctx, px0, py0, px1 - px0, py1 - py0, pr, "rgba(0,0,0,0.45)", 45, 0, 20);
    const gPanel = linearGrad(ctx, px0, py0, px0, py1, [
      [0, `rgb(${THEME.CARD_LIGHT.r},${THEME.CARD_LIGHT.g},${THEME.CARD_LIGHT.b})`],
      [1, `rgb(${THEME.CARD.r},${THEME.CARD.g},${THEME.CARD.b})`],
    ]);
    fillRoundedRect(ctx, px0, py0, px1 - px0, py1 - py0, pr, gPanel);
    strokeRoundedRect(ctx, px0, py0, px1 - px0, py1 - py0, pr, "rgba(255,255,255,0.22)", 3);

    const innerPad = 32;
    const plotX0 = px0 + innerPad;
    const plotY0 = py0 + innerPad;
    const plotX1 = px1 - innerPad;
    const plotY1 = py1 - innerPad;

    // --- Plot data prep (x=minutesElapsed, y=wpAway)
    const xRaw = snaps.map(s => s.minutesElapsed);
    const yRaw = snaps.map(s => clamp(s.wpAway, 0, 1));

    // Sort by x
    const idx = xRaw.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]).map(p => p[1]);
    const xSorted = idx.map(i => xRaw[i]);
    const ySorted = idx.map(i => yRaw[i]);

    const cd = compressDuplicateX(xSorted, ySorted);
    const smooth = smoothSeries(cd.x, cd.y, POINTS_PER_SEGMENT);
    const xs = smooth.xs;
    const ys = smooth.ys;

    // Render plot area background "glass"
    ctx.save();
    roundRectPath(ctx, plotX0, plotY0, plotX1 - plotX0, plotY1 - plotY0, 22);
    ctx.clip();
    ctx.fillStyle = "rgba(43,55,75,0.35)";
    ctx.fillRect(plotX0, plotY0, plotX1 - plotX0, plotY1 - plotY0);
    ctx.restore();

    // axes ranges
    const xmax = xs.length ? Math.max(...xs) : 1;
    const xmin = -xmax * 0.02;
    const xmaxPad = xmax * 1.02;
    const ymin = -0.03;
    const ymax = 1.03;

    function mapX(x) {
      return plotX0 + ((x - xmin) / (xmaxPad - xmin)) * (plotX1 - plotX0);
    }
    function mapY(y) {
      return plotY1 - ((y - ymin) / (ymax - ymin)) * (plotY1 - plotY0);
    }

    // grid
    function drawGrid() {
      // y-grid
      const yTicks = [0, 0.25, 0.5, 0.75, 1.0];
      for (const t of yTicks) {
        const yy = mapY(t);
        ctx.beginPath();
        ctx.moveTo(plotX0, yy);
        ctx.lineTo(plotX1, yy);
        ctx.strokeStyle = "rgba(79,95,122,0.45)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // x-grid (5 divisions)
      const div = 5;
      for (let i = 0; i <= div; i++) {
        const x = xmin + (i / div) * (xmaxPad - xmin);
        const xx = mapX(x);
        ctx.beginPath();
        ctx.moveTo(xx, plotY0);
        ctx.lineTo(xx, plotY1);
        ctx.strokeStyle = "rgba(79,95,122,0.18)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    drawGrid();

    // 50% line
    ctx.beginPath();
    ctx.moveTo(plotX0, mapY(0.5));
    ctx.lineTo(plotX1, mapY(0.5));
    ctx.strokeStyle = "rgba(210,210,210,0.22)";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // pregame baseline
    if (SHOW_PREGAME_BASELINE && pregame != null) {
      ctx.beginPath();
      ctx.moveTo(plotX0, mapY(pregame));
      ctx.lineTo(plotX1, mapY(pregame));
      ctx.strokeStyle = "rgba(146,158,178,0.45)";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Fill above/below 0.5
    function fillArea(whereAbove) {
      ctx.save();
      ctx.beginPath();
      // Build polygon following the curve, then back to baseline
      let started = false;

      for (let i = 0; i < xs.length; i++) {
        const above = ys[i] >= 0.5;
        if ((whereAbove && above) || (!whereAbove && !above)) {
          const xx = mapX(xs[i]);
          const yy = mapY(ys[i]);
          if (!started) {
            started = true;
            ctx.moveTo(xx, mapY(0.5));
            ctx.lineTo(xx, yy);
          } else {
            ctx.lineTo(xx, yy);
          }
        } else if (started) {
          // close segment to baseline at current x
          const xx = mapX(xs[i]);
          ctx.lineTo(xx, mapY(0.5));
          ctx.closePath();
          // fill and restart
          ctx.fill();
          started = false;
          ctx.beginPath();
        }
      }

      if (started) {
        const xx = mapX(xs[xs.length - 1]);
        ctx.lineTo(xx, mapY(0.5));
        ctx.closePath();
        ctx.fill();
      }

      ctx.restore();
    }

    // set fill styles
    ctx.fillStyle = `rgba(${awayTeam.color.r},${awayTeam.color.g},${awayTeam.color.b},0.28)`;
    fillArea(true); // above = away favored
    ctx.fillStyle = `rgba(${homeTeam.color.r},${homeTeam.color.g},${homeTeam.color.b},0.28)`;
    fillArea(false);

    // Line colored by >0.5 away vs <0.5 home
    ctx.lineWidth = 5.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (let i = 0; i < xs.length - 1; i++) {
      const mid = 0.5 * (ys[i] + ys[i + 1]);
      const col = mid >= 0.5 ? awayTeam.color : homeTeam.color;
      ctx.strokeStyle = `rgba(${col.r},${col.g},${col.b},0.95)`;
      ctx.beginPath();
      ctx.moveTo(mapX(xs[i]), mapY(ys[i]));
      ctx.lineTo(mapX(xs[i + 1]), mapY(ys[i + 1]));
      ctx.stroke();
    }

    // end marker dot at end of smoothed line
    const lastX = xs.length ? xs[xs.length - 1] : 0;
    const lastY = ys.length ? ys[ys.length - 1] : 0.5;
    const lastCol = lastY >= 0.5 ? awayTeam.color : homeTeam.color;
    const endPX = mapX(lastX);
    const endPY = mapY(lastY);

    // glow rings
    for (let i = 0; i < 3; i++) {
      const sz = [38, 30, 22][i];
      const alpha = [0.14, 0.10, 0.06][i];
      ctx.beginPath();
      ctx.arc(endPX, endPY, sz, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${lastCol.r},${lastCol.g},${lastCol.b},${alpha})`;
      ctx.fill();
    }
    // main dot
    ctx.beginPath();
    ctx.arc(endPX, endPY, 14, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${lastCol.r},${lastCol.g},${lastCol.b},1)`;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = `rgba(${THEME.TEXT.r},${THEME.TEXT.g},${THEME.TEXT.b},1)`;
    ctx.stroke();

    // y-axis labels
    const yTickLabels = [
      { v: 0, t: "0%" },
      { v: 0.25, t: "25%" },
      { v: 0.5, t: "50%" },
      { v: 0.75, t: "75%" },
      { v: 1.0, t: "100%" },
    ];
    setFont(14, 800);
    ctx.fillStyle = rgbaStr(THEME.TEXT);
    for (const yt of yTickLabels) {
      const yy = mapY(yt.v);
      ctx.fillText(yt.t, plotX0 - 48, yy + 5);
    }

    // axes strokes
    ctx.beginPath();
    ctx.moveTo(plotX0, plotY0);
    ctx.lineTo(plotX0, plotY1);
    ctx.strokeStyle = "rgba(112,126,152,0.35)";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(plotX0, plotY1);
    ctx.lineTo(plotX1, plotY1);
    ctx.strokeStyle = "rgba(112,126,152,0.35)";
    ctx.lineWidth = 2.2;
    ctx.stroke();

    // axis labels
    setFont(16, 800);
    ctx.fillStyle = rgbaStr(THEME.SUBTEXT);
    const xLab = "Game Progress (minutes elapsed)";
    ctx.fillText(xLab, plotX0 + (plotX1 - plotX0) / 2 - textW(xLab) / 2, plotY1 + 46);

    // bottom pills
    const status = last.minutesLeft <= 1e-6 ? "FINAL" : "LIVE";
    const mom = computeMomentum(snaps, MOMENTUM_N);
    const momPct = Math.round(mom * 100);
    const momBg = momPct >= 0 ? awayTeam.color : homeTeam.color;

    const clutch = computeClutchIndex(snaps);
    const { swing, update: swingU } = computeBigSwing(snaps);
    const swingPct = Math.round(swing * 100);

    const pills = [];
    if (status === "LIVE") pills.push({ text: "● LIVE", bg: THEME.LIVE_BG });
    else pills.push({ text: "FINAL", bg: THEME.FINAL_BG });

    pills.push({ text: `MOMENTUM ${momPct >= 0 ? "+" : ""}${momPct}%`, bg: { ...momBg, a: 0.96 } });
    pills.push({ text: `CLUTCH ${clutch}`, bg: { r: 100, g: 116, b: 139, a: 0.92 } });
    pills.push({ text: `BIG SWING ${swingPct >= 0 ? "+" : ""}${swingPct}% @#${swingU}`, bg: { r: 71, g: 85, b: 105, a: 0.88 } });

    if (pregame != null) {
      const edge = Math.round((pregame - 0.5) * 100);
      pills.push({ text: `PREGAME EDGE ${edge >= 0 ? "+" : ""}${edge}%`, bg: { r: 51, g: 65, b: 85, a: 0.86 } });
    }

    // draw pills centered
    function measurePill(text, fontPx, padX, padY) {
      setFont(fontPx, 800);
      const w = textW(text);
      return { w: w + 2 * padX, h: fontPx + 2 * padY };
    }

    function drawPill(x, y, text, bg, fontPx, padX, padY) {
      const { w, h } = measurePill(text, fontPx, padX, padY);
      const r = Math.floor(h / 2);

      // bg
      ctx.save();
      ctx.globalAlpha = bg.a ?? 1;
      fillRoundedRect(ctx, x, y, w, h, r, `rgb(${bg.r},${bg.g},${bg.b})`);
      ctx.restore();

      strokeRoundedRect(ctx, x, y, w, h, r, "rgba(255,255,255,0.28)", 2);

      setFont(fontPx, 900);
      ctx.fillStyle = "rgba(255,255,255,0.98)";
      ctx.fillText(text, x + padX, y + h - padY - 2);

      return { w, h };
    }

    const pillsY = y1 - 98;
    const baseFontPx = 24;
    const padPxX = 24;
    const padPxY = 14;
    const gap = 18;

    // shrink font if needed
    let fontPx = baseFontPx;
    let totalW;
    while (true) {
      totalW = 0;
      for (let i = 0; i < pills.length; i++) {
        totalW += measurePill(pills[i].text, fontPx, padPxX, padPxY).w;
        if (i < pills.length - 1) totalW += gap;
      }
      const avail = (x1 - x0) - 128;
      if (totalW <= avail || fontPx <= Math.floor(baseFontPx * 0.7)) break;
      fontPx = Math.floor(fontPx * 0.92);
    }

    let x = x0 + 64 + Math.max(0, (((x1 - x0) - 128) - totalW) / 2);
    for (const p of pills) {
      const drawn = drawPill(x, pillsY, p.text, p.bg, fontPx, padPxX, padPxY);
      x += drawn.w + gap;
    }

    // Logos last, so they sit crisp over gradients
    // (draw as-is; if you want auto-key transparency, we can do it later with canvas pixel ops)
    return Promise.all([
      loadImage(awayTeam.logo).catch(() => null),
      loadImage(homeTeam.logo).catch(() => null),
    ]).then(([imgAway, imgHome]) => {
      function drawLogo(img, x, y, size) {
        if (!img) {
          // fallback: colored circle
          ctx.save();
          ctx.fillStyle = "rgba(255,255,255,0.10)";
          ctx.beginPath();
          ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          return;
        }
        // subtle shadow
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.drawImage(img, x + 3, y + 6, size, size);
        ctx.restore();

        ctx.drawImage(img, x, y, size, size);
      }

      drawLogo(imgAway, logoLeftX, logoY, logoBox);
      drawLogo(imgHome, logoRightX, logoY, logoBox);
    });
  }

  /**********************
   * FETCH + LOOP
   **********************/
  async function fetchCSV() {
    const res = await fetch(SHEET_CSV_URL, { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
    return await res.text();
  }

  async function refreshOnce() {
    try {
      if (!SHEET_CSV_URL || SHEET_CSV_URL.includes("PASTE_YOUR_PUBLISHED_CSV_URL_HERE")) {
        throw new Error("Set SHEET_CSV_URL at the top of app.js to your published Google Sheet CSV URL.");
      }

      statusLine.textContent = "Fetching sheet…";
      const text = await fetchCSV();

      const { headers, records } = parseCSV(text);
      if (!headers.length) throw new Error("CSV parse produced no headers.");

      const { awayKey, homeKey, snaps, pregame } = buildSnapshots(headers, records);

      statusLine.textContent =
        `Away=${awayKey} | Home=${homeKey} | snapshots=${snaps.length}` +
        (REFRESH_SEC ? ` | auto-refresh=${REFRESH_SEC}s` : "");

      await renderCard({ awayKey, homeKey, snaps, pregame });
    } catch (e) {
      console.error(e);
      statusLine.textContent = `Error: ${e.message}`;
      // show something even on error
      ctx.clearRect(0, 0, FINAL_W, FINAL_H);
      ctx.fillStyle = rgbaStr(THEME.BG);
      ctx.fillRect(0, 0, FINAL_W, FINAL_H);
      ctx.fillStyle = "rgba(245,247,252,0.9)";
      ctx.font = "700 22px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillText("Failed to render.", 60, 80);
      ctx.font = "500 16px system-ui, -apple-system, Segoe UI, Roboto, Arial";
      ctx.fillStyle = "rgba(199,207,220,0.9)";
      wrapText(ctx, e.message, 60, 120, FINAL_W - 120, 22);
    }
  }

  function wrapText(c, text, x, y, maxW, lineH) {
    const words = String(text).split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (c.measureText(test).width > maxW) {
        c.fillText(line, x, y);
        line = w;
        y += lineH;
      } else {
        line = test;
      }
    }
    if (line) c.fillText(line, x, y);
  }

  // Start
  refreshOnce();
  if (REFRESH_SEC) setInterval(refreshOnce, REFRESH_SEC * 1000);
})();
