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
    const getVal = (row, canonKey) => {
      const actual = mapping[CANON[canonKey]];
      if (!actual) return null;
      const i = idxByName.get(actual);
      return i == null ? null : row[i];
    };

    const raw = [];
    let autoUpdate = 1;

    for (let r = 1; r < grid.length; r++) {
      const row = grid[r];

      let upd = toFloat(getVal(row, "update"));
      if (!Number.isFinite(upd)) upd = autoUpdate;
      autoUpdate++;

      let tLeft = toFloat(getVal(row, "minutes_left"));
      let wpA = toFloat(getVal(row, "wp_a"));
      let sA = toFloat(getVal(row, "score_a"));
      let sB = toFloat(getVal(row, "score_b"));
      if (!Number.isFinite(tLeft) || !Number.isFinite(wpA)) continue;

      tLeft = parseMinutesLeft(tLeft);
      wpA = clamp(wpA, 0, 1);

      const hb = toInt(getVal(row, "has_ball_a"));
      const q  = toInt(getVal(row, "quarter"));
      const dn = toInt(getVal(row, "down"));
      const ds = toInt(getVal(row, "distance"));
      const yg = toInt(getVal(row, "ytg"));
      const pg = toFloat(getVal(row, "pregame_wp"));
      const pregame = Number.isFinite(pg) ? clamp(pg, 0, 1) : null;

      raw.push({
        update: Math.round(upd),
        t_left: tLeft,
        wp_a: wpA,
        s_a: Number.isFinite(sA) ? sA : 0,
        s_b: Number.isFinite(sB) ? sB : 0,
        hb: (hb === 0 || hb === 1) ? hb : null,
        q, dn, ds, yg,
        pregame
      });
    }

    if (!raw.length) throw new Error("No valid rows found.");

    raw.sort((a,b)=>a.update-b.update);

    let elapsed = 0;
    let prevLeft = raw[0].t_left;
    const snaps = [];

    for (let i = 0; i < raw.length; i++) {
      const d = raw[i];
      if (i === 0) {
        elapsed = 0; prevLeft = d.t_left;
      } else {
        const step = prevLeft - d.t_left;
        if (step > 0) { elapsed += step; prevLeft = d.t_left; }
        else { prevLeft = Math.min(prevLeft, d.t_left); }
      }
      snaps.push({
        update: d.update,
        minutes_left: d.t_left,
        minutes_elapsed: elapsed,
        wp_a: d.wp_a,
        score_a: d.s_a,
        score_b: d.s_b,
        has_ball_a: d.hb,
        quarter: d.q,
        down: d.dn,
        distance: d.ds,
        ytg: d.yg,
        pregame_wp: d.pregame
      });
    }

    return snaps;
  }

  function findPregame(snaps) {
    for (let i = snaps.length - 1; i >= 0; i--) {
      if (snaps[i].pregame_wp != null) return clamp(snaps[i].pregame_wp, 0, 1);
    }
    return null;
  }

  // ============================================================
  // Canvas drawing helpers
  // ============================================================
  function roundRectPath(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+rr, y);
    ctx.arcTo(x+w, y, x+w, y+h, rr);
    ctx.arcTo(x+w, y+h, x, y+h, rr);
    ctx.arcTo(x, y+h, x, y, rr);
    ctx.arcTo(x, y, x+w, y, rr);
    ctx.closePath();
  }

  function drawGradientRect(ctx, x, y, w, h, c1, c2, vertical = true, alpha = 1, r = 0) {
    const g = vertical
      ? ctx.createLinearGradient(0, y, 0, y+h)
      : ctx.createLinearGradient(x, 0, x+w, 0);
    g.addColorStop(0, rgb(c1, alpha));
    g.addColorStop(1, rgb(c2, alpha));
    ctx.save();
    if (r > 0) {
      roundRectPath(ctx, x, y, w, h, r);
      ctx.clip();
    }
    ctx.fillStyle = g;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  function drawTextCenter(ctx, x, y, text, font, fill) {
    ctx.save();
    ctx.font = font;
    ctx.fillStyle = fill;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function drawPill(ctx, x, y, text, font, bg, fg, padX, padY, r) {
    ctx.save();
    ctx.font = font;
    const metrics = ctx.measureText(text);
    const tw = metrics.width;
    const th = Math.max(14, (metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent) || 16);

    const w = tw + 2*padX;
    const h = th + 2*padY;

    roundRectPath(ctx, x, y, w, h, r);
    ctx.fillStyle = bg;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.stroke();

    ctx.fillStyle = fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x + padX, y + h/2);
    ctx.restore();
    return { w, h };
  }

  // ============================================================
  // Render card (the website version of your python output)
  // ============================================================
  function renderCard(canvas, snaps, logoA, logoB) {
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;

    ctx.clearRect(0,0,W,H);

    // background
    ctx.fillStyle = rgb(BG, 1);
    ctx.fillRect(0,0,W,H);

    const m = 40;
    const x0 = m, y0 = m, x1 = W - m, y1 = H - m;
    const cardW = x1 - x0, cardH = y1 - y0;
    const cardR = 40;

    // card gradient
    drawGradientRect(ctx, x0, y0, cardW, cardH, CARD, CARD_LIGHT, true, 1, cardR);

    // subtle border
    ctx.save();
    roundRectPath(ctx, x0, y0, cardW, cardH, cardR);
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // header strip
    const headerH = 250;
    drawGradientRect(ctx, x0, y0, cardW, headerH, [36,46,66], [28,37,54], true, 1, cardR);

    const last = snaps[snaps.length - 1];
    const wpA = clamp(last.wp_a, 0.01, 0.99);
    const wpB = 1 - wpA;

    // left/right layout
    const padX = 60;
    const innerW = cardW;
    const leftW = Math.floor(innerW * 0.40);
    const rightW = Math.floor(innerW * 0.40);
    const centerW = innerW - leftW - rightW;

    const L0 = x0 + padX;
    const L1 = L0 + leftW;
    const C0 = L1;
    const C1 = C0 + centerW;
    const R0 = C1;
    const R1 = x1 - padX;

    // logos
    const logoBox = 100;
    const logoY = y0 + 90;
    const logoLeftX = L0 + 10;
    const logoRightX = R1 - 10 - logoBox;

    if (logoA && logoA.complete) ctx.drawImage(logoA, logoLeftX, logoY, logoBox, logoBox);
    if (logoB && logoB.complete) ctx.drawImage(logoB, logoRightX, logoY, logoBox, logoBox);

    // team names + probs
    ctx.save();
    ctx.fillStyle = rgb(TEXT,1);
    ctx.font = "700 40px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    const nameY = y0 + 90;
    const probY = y0 + 148;
    const leftTextX = logoLeftX + logoBox + 22;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(TEAM_A_NAME, leftTextX, nameY);

    ctx.font = "700 24px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = rgb(TEAM_A_COLOR,1);
    ctx.fillText(`Win Prob: ${fmtPct(wpA)}`, leftTextX, probY);

    ctx.font = "700 40px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = rgb(TEXT,1);
    ctx.textAlign = "right";
    ctx.fillText(TEAM_B_NAME, R1 - 22, nameY);

    ctx.font = "700 24px system-ui, -apple-system, Segoe UI, Roboto, Arial";
    ctx.fillStyle = rgb(TEAM_B_COLOR,1);
    ctx.fillText(`Win Prob: ${fmtPct(wpB)}`, R1 - 22, probY);
    ctx.restore();

    // football possession indicator (simple dot substitute)
    if (last.has_ball_a === 0 || last.has_ball_a === 1) {
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      const r = 7;
      if (last.has_ball_a === 1) {
        ctx.beginPath(); ctx.arc(leftTextX + 10, nameY + 58, r, 0, Math.PI*2); ctx.fill();
      } else {
        ctx.beginPath(); ctx.arc(R1 - 22 - 10, nameY + 58, r, 0, Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }

    // center stack (league, week, score, time pill, strip)
    const headerCx = Math.floor((x0 + x1) / 2);
    const headerTop = y0 + 18;
    const headerBot = y0 + headerH - 18;
    const usableH = headerBot - headerTop;

    let scale = 1.0;
    const base = {
      league: 20,
      week: 17,
      score: 110,
      time: 30,
      strip: 20,
      gapTitleToScore: 14,
      gapScoreToTime: 30,
      gapTimeToStrip: 12,
      titleGap: 6,
      pillPadX: 26,
      pillPadY: 13
    };

    const scoreA = String(Math.round(last.score_a));
    const scoreB = String(Math.round(last.score_b));
    const dash = "—";
    const timeStr = `${fmtClock(last.minutes_left)} REMAINING`;

    let strip = null;
    if (last.quarter != null) {
      const parts = [`Q${last.quarter}`];
      const dn = fmtDownOrdinal(last.down);
      if (dn != null && last.distance != null) parts.push(`${dn} & ${last.distance}`);
      if (last.ytg != null) parts.push(`YTG ${last.ytg}`);
      strip = parts.join(" • ");
    }

    function measureStack(sc) {
      const leagueFont = `700 ${Math.max(10, Math.floor(base.league * sc))}px system-ui`;
      const weekFont   = `600 ${Math.max(10, Math.floor(base.week   * sc))}px system-ui`;
      const scoreFont  = `800 ${Math.max(10, Math.floor(base.score  * sc))}px system-ui`;
      const timeFont   = `800 ${Math.max(10, Math.floor(base.time   * sc))}px system-ui`;
      const stripFont  = `700 ${Math.max(10, Math.floor(base.strip  * sc))}px system-ui`;

      ctx.save();
      ctx.font = leagueFont; const lnH = 1.05 * (base.league*sc);
      ctx.font = weekFont;   const wkH = 1.05 * (base.week*sc);

      ctx.font = scoreFont;
      const wA = ctx.measureText(scoreA).width;
      const wD = ctx.measureText(dash).width;
      const wB = ctx.measureText(scoreB).width;
      const scoreH = 1.05 * (base.score*sc);
      const gapSB = 26 * sc;
      const scoreW = wA + gapSB + wD + gapSB + wB;

      ctx.font = timeFont;
      const timeW = ctx.measureText(timeStr).width;
      const pillW = timeW + 2*(base.pillPadX*sc);
      const pillH = 1.5*(base.time*sc) + 2*(base.pillPadY*sc);

      let stripH = 0;
      if (strip) {
        ctx.font = stripFont;
        stripH = 1.15*(base.strip*sc);
      }
      ctx.restore();

      const titleGap = base.titleGap*sc;
      const gapTitleToScore = base.gapTitleToScore*sc;
      const gapScoreToTime  = base.gapScoreToTime*sc;
      const gapTimeToStrip  = strip ? base.gapTimeToStrip*sc : 0;

      const leagueBlockH = lnH + titleGap + wkH;
      let stackH = leagueBlockH + gapTitleToScore + scoreH + gapScoreToTime + pillH;
      if (strip) stackH += gapTimeToStrip + stripH;

      return {
        leagueFont, weekFont, scoreFont, timeFont, stripFont,
        lnH, wkH, scoreH, pillW, pillH, scoreW, stripH,
        titleGap, gapTitleToScore, gapScoreToTime, gapTimeToStrip,
        stackH, gapSB
      };
    }

    let M = measureStack(scale);
    for (let i = 0; i < 18; i++) {
      if (M.stackH <= usableH * 0.92) break;
      scale *= 0.92;
      M = measureStack(scale);
    }

    const stackTop = headerTop + Math.max(0, (usableH - M.stackH) / 2);

    // league + week
    drawTextCenter(ctx, headerCx, stackTop + M.lnH/2, LEAGUE_NAME, M.leagueFont, rgb(TEXT,1));
    drawTextCenter(ctx, headerCx, stackTop + M.lnH + M.titleGap + M.wkH/2, WEEK_LABEL, M.weekFont, rgb(SUBTEXT,1));

    // score
    const scoreY = stackTop + M.lnH + M.titleGap + M.wkH + M.gapTitleToScore;
    ctx.save();
    ctx.font = M.scoreFont;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";

    const wA = ctx.measureText(scoreA).width;
    const wD = ctx.measureText(dash).width;
    const wB = ctx.measureText(scoreB).width;
    const totalW = wA + M.gapSB + wD + M.gapSB + wB;

    let sx = headerCx - totalW/2;
    ctx.fillStyle = rgb(TEXT,1);
    ctx.fillText(scoreA, sx, scoreY);
    sx += wA + M.gapSB;

    ctx.fillStyle = rgb(MUTED,1);
    ctx.fillText(dash, sx, scoreY);
    sx += wD + M.gapSB;

    ctx.fillStyle = rgb(TEXT,1);
    ctx.fillText(scoreB, sx, scoreY);
    ctx.restore();

    // time pill
    const pillY = scoreY + M.scoreH + M.gapScoreToTime;
    const pillX = headerCx - M.pillW/2;
    const pillR = M.pillH/2;

    // pill gradient
    drawGradientRect(ctx, pillX, pillY, M.pillW, M.pillH, CARD_LIGHT, CARD, true, 1, pillR);
    ctx.save();
    roundRectPath(ctx, pillX, pillY, M.pillW, M.pillH, pillR);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    drawTextCenter(ctx, headerCx, pillY + M.pillH/2, timeStr, M.timeFont, rgb(TEXT,1));

    // strip line
    if (strip) {
      drawTextCenter(ctx, headerCx, pillY + M.pillH + M.gapTimeToStrip + M.stripH/2, strip, M.stripFont, rgb(MUTED,1));
    }

    // ============================================================
    // CHART PANEL
    // ============================================================
    const panelPadX = 70;
    const panelTop = y0 + headerH + 32;
    const panelBot = y1 - 145;

    const px0 = x0 + panelPadX;
    const px1 = x1 - panelPadX;
    const py0 = panelTop;
    const py1 = panelBot;
    const pr = 28;

    drawGradientRect(ctx, px0, py0, (px1-px0), (py1-py0), CARD_LIGHT, CARD, true, 1, pr);
    ctx.save();
    roundRectPath(ctx, px0, py0, (px1-px0), (py1-py0), pr);
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    const innerPad = 32;
    const plotX0 = px0 + innerPad;
    const plotY0 = py0 + innerPad;
    const plotX1 = px1 - innerPad;
    const plotY1 = py1 - innerPad;
    const plotW = plotX1 - plotX0;
    const plotH = plotY1 - plotY0;

    // plot background
    drawGradientRect(ctx, plotX0, plotY0, plotW, plotH, CARD_LIGHT, CARD_LIGHT, true, 0.35, 18);

    // data series
    const xRaw = snaps.map(s => s.minutes_elapsed);
    const yRaw = snaps.map(s => clamp(s.wp_a, 0, 1));

    // sort
    const idx = xRaw.map((v,i)=>[v,i]).sort((a,b)=>a[0]-b[0]).map(p=>p[1]);
    let x = idx.map(i=>xRaw[i]);
    let y = idx.map(i=>yRaw[i]);
    [x,y] = compressDuplicateX(x,y);

    const [xs, ys] = smoothSeries(x,y,40);

    const xmax = xs.length ? xs[xs.length-1] : 1;
    const xMin = -xmax * 0.02;
    const xMax =  xmax * 1.02;
    const yMin = -0.03;
    const yMax =  1.03;

    const mapX = (v) => plotX0 + (v - xMin) / (xMax - xMin) * plotW;
    const mapY = (v) => plotY1 - (v - yMin) / (yMax - yMin) * plotH;

    // grid lines
    ctx.save();
    ctx.lineWidth = 1.5;
    for (const t of [0,0.25,0.5,0.75,1]) {
      const yy = mapY(t);
      ctx.strokeStyle = rgb(GRID, t === 0.5 ? 0.28 : 0.45);
      ctx.beginPath(); ctx.moveTo(plotX0, yy); ctx.lineTo(plotX1, yy); ctx.stroke();
    }
    // x dotted grid
    ctx.setLineDash([2,6]);
    ctx.lineWidth = 1.0;
    const xTicks = 6;
    for (let i=1;i<xTicks;i++){
      const xv = xMin + (i/xTicks)*(xMax-xMin);
      const xx = mapX(xv);
      ctx.strokeStyle = rgb(GRID,0.18);
      ctx.beginPath(); ctx.moveTo(xx, plotY0); ctx.lineTo(xx, plotY1); ctx.stroke();
    }
    ctx.restore();

    // pregame baseline (if present)
    const pregame = findPregame(snaps);
    if (pregame != null) {
      ctx.save();
      ctx.setLineDash([8,6]);
      ctx.lineWidth = 2;
      ctx.strokeStyle = rgb(MUTED,0.45);
      const yy = mapY(pregame);
      ctx.beginPath(); ctx.moveTo(plotX0, yy); ctx.lineTo(plotX1, yy); ctx.stroke();
      ctx.restore();
    }

    // fill areas above/below 0.5 + line segments
    const baseY = 0.5;

    // fills
    for (let i = 0; i < xs.length - 1; i++) {
      const x0p = mapX(xs[i]), x1p = mapX(xs[i+1]);
      const y0p = mapY(ys[i]), y1p = mapY(ys[i+1]);
      const mid = 0.5*(ys[i] + ys[i+1]);
      const fillCol = mid >= baseY ? TEAM_A_COLOR : TEAM_B_COLOR;

      ctx.save();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = rgb(fillCol, 1);

      const baseP = mapY(baseY);
      ctx.beginPath();
      ctx.moveTo(x0p, baseP);
      ctx.lineTo(x0p, y0p);
      ctx.lineTo(x1p, y1p);
      ctx.lineTo(x1p, baseP);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // line segments colored by side
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5.2;
    for (let i = 0; i < xs.length - 1; i++) {
      const mid = 0.5*(ys[i] + ys[i+1]);
      const col = mid >= baseY ? TEAM_A_COLOR : TEAM_B_COLOR;
      ctx.strokeStyle = rgb(col, 0.95);
      ctx.beginPath();
      ctx.moveTo(mapX(xs[i]), mapY(ys[i]));
      ctx.lineTo(mapX(xs[i+1]), mapY(ys[i+1]));
      ctx.stroke();
    }
    ctx.restore();

    // endpoint marker (smoothed endpoint)
    const lastX = xs.length ? xs[xs.length-1] : 0;
    const lastY = ys.length ? ys[ys.length-1] : 0.5;
    const endCol = lastY >= 0.5 ? TEAM_A_COLOR : TEAM_B_COLOR;
    const endPx = mapX(lastX), endPy = mapY(lastY);

    ctx.save();
    for (let i = 0; i < 3; i++) {
      const sz = [38, 26, 18][i];
      const a  = [0.14, 0.10, 0.06][i];
      ctx.fillStyle = rgb(endCol, a);
      ctx.beginPath(); ctx.arc(endPx, endPy, sz, 0, Math.PI*2); ctx.fill();
    }
    ctx.fillStyle = rgb(endCol, 1);
    ctx.strokeStyle = rgb(TEXT, 1);
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(endPx, endPy, 13, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    ctx.restore();

    // ============================================================
    // BOTTOM PILLS
    // ============================================================
    const status = last.minutes_left <= 1e-6 ? "FINAL" : "LIVE";
    const mom = computeMomentum(snaps, 5);
    const momPct = Math.round(mom * 100);
    const momBg = momPct >= 0 ? TEAM_A_COLOR : TEAM_B_COLOR;

    const clutch = computeClutchIndex(snaps);
    const [swing, swingU] = computeBigSwing(snaps);
    const swingPct = Math.round(swing * 100);

    const pills = [];
    if (status === "LIVE") pills.push({ t: "● LIVE", bg: rgb(LIVE_BG, 1) });
    else pills.push({ t: "FINAL", bg: rgb(FINAL_BG, 1) });

    pills.push({ t: `MOMENTUM ${momPct >= 0 ? "+" : ""}${momPct}%`, bg: rgb(momBg, 0.96) });
    pills.push({ t: `CLUTCH ${clutch}`, bg: "rgba(100,116,139,0.92)" });
    pills.push({ t: `BIG SWING ${swingPct >= 0 ? "+" : ""}${swingPct}% @#${swingU}`, bg: "rgba(71,85,105,0.88)" });

    if (pregame != null) {
      const edge = Math.round((pregame - 0.5) * 100);
      pills.push({ t: `PREGAME EDGE ${edge >= 0 ? "+" : ""}${edge}%`, bg: "rgba(51,65,85,0.84)" });
    }

    ctx.save();
    const pillsY = y1 - 98;
    const font = "800 24px system-ui, -apple-system, Segoe UI, Roboto, Arial";

    // measure total width
    ctx.font = font;
    const padX2 = 24, padY2 = 14, gap = 18, rP = 24;
    const widths = pills.map(p => ctx.measureText(p.t).width + 2*padX2);
    const total = widths.reduce((a,b)=>a+b,0) + gap*(pills.length-1);
    let startX = x0 + 64 + Math.max(0, ((x1 - 64) - (x0 + 64) - total)/2);

    for (let i=0;i<pills.length;i++){
      const w = widths[i];
      const h = 24 + 2*padY2;
      drawPill(ctx, startX, pillsY, pills[i].t, font, pills[i].bg, "rgba(255,255,255,0.98)", padX2, padY2, rP);
      startX += w + gap;
    }
    ctx.restore();
  }

  // ============================================================
  // Main loop: fetch sheet -> render
  // ============================================================
  const canvas = document.getElementById("card");

  async function fetchCsv() {
    if (!SHEET_CSV_URL) throw new Error("SHEET_CSV_URL is empty in app.js");
    const bust = (SHEET_CSV_URL.includes("?") ? "&" : "?") + "t=" + Date.now();
    const res = await fetch(SHEET_CSV_URL + bust, { cache: "no-store" });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    return await res.text();
  }

  let logoA = null, logoB = null;

  async function initAssets() {
    // logos are optional; if missing, it still renders
    logoA = await loadImage(LOGO_A_PATH).catch(() => null);
    logoB = await loadImage(LOGO_B_PATH).catch(() => null);
  }

  async function tick() {
    try {
      hintEl.textContent = "Updating…";
      const csvText = await fetchCsv();
      const snaps = parseSnapshotsFromCsv(csvText);
      renderCard(canvas, snaps, logoA, logoB);
      hintEl.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
    } catch (e) {
      hintEl.textContent = `Error: ${e.message}`;
      // draw error state
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = rgb(BG, 1);
      ctx.fillRect(0,0,canvas.width,canvas.height);
      drawTextCenter(ctx, canvas.width/2, canvas.height/2, e.message, "700 22px system-ui", "rgba(255,255,255,0.85)");
    }
  }

  (async () => {
    await initAssets();
    await tick();
    setInterval(tick, POLL_MS);
  })();
})();
