/* ============================================================
   WIN PROBABILITY CARD — PURE FRONTEND (GitHub Pages)
   - Fetches Google Sheet (Published as CSV)
   - Detects teams from:
       A) Away/Home columns (if you add them), OR
       B) Column C/D HEADERS (your current CSV: Giants,Bengals)
   - Draws a premium dark card + chart + endpoint marker
   ============================================================ */

/** =========================
 *  CONFIG
 *  ========================= */
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRxNr3jLVjL4e24TvQR9iSkJP0T_lBiA2Dh5G9iut5_zDksYHEnbsu8k8f5Eo888Aha_UWuZXRhFNV0/pub?gid=0&single=true&output=csv"; // must be public "Publish to web -> CSV"
const REFRESH_MS = 5000;

const LEAGUE_NAME = "Tate Football League";
const WEEK_LABEL  = "Live Win Probability";

const FINAL_W = 1800;
const FINAL_H = 1050;

const DISPLAY_CLAMP_LO = 0.01;
const DISPLAY_CLAMP_HI = 0.99;

const MOMENTUM_N = 5;
const SHOW_PREGAME_BASELINE = true;

// Fallback CSV (used when the live sheet can't be fetched).
// Structure matches the "team headers in column C/D" layout.
const SAMPLE_CSV = `Update #,Minutes Left,Giants,Bengals,Away Win Probability,Quarter,Down,Distance,Yards To Goal,Pregame Win Prob
1,60,0,0,0.55,1,1,10,75,0.48
2,50,3,0,0.58,2,2,6,60,
3,38,3,7,0.44,3,3,8,52,
4,24,10,10,0.51,3,1,10,38,
5,12,13,17,0.33,4,2,5,26,
6,4,16,24,0.18,4,3,12,12,
7,0,16,24,0.05,4,4,15,0,
`;

/** =========================
 *  ASSET MAP (your keys)
 *  logos/ in your repo
 *  ========================= */
const TEAM_META = {
  Giants: {
    display: "New York Giants",
    logo: "logos/giants.png",
    color: [0, 28, 142],
  },
  Bengals: {
    display: "Cincinnati Bengals",
    logo: "logos/bengals.png",
    color: [255, 165, 0],
  },
  Cowboys: {
    display: "Dallas Cowboys",
    logo: "logos/cowboys.png",
    color: [0, 34, 68],
  },
  SanFran: {
    display: "San Francisco 49ers",
    logo: "logos/Sanfran.png", // matches your repo screenshot (case-sensitive)
    color: [170, 0, 0],
  },
  Louis: {
    display: "St. Louis Cardinals",
    logo: "logos/Cards.png", // matches your repo screenshot
    color: [153, 0, 0],
  }
};

/** =========================
 *  THEME
 *  ========================= */
const THEME = {
  BG:   [12, 16, 28],
  CARD: [28, 37, 54],
  CARD_LIGHT: [43, 55, 75],

  TEXT:    [245, 247, 252],
  SUBTEXT: [199, 207, 220],
  MUTED:   [146, 158, 178],
  GRID:    [79, 95, 122],
  AXIS:    [112, 126, 152],

  LIVE_BG:  [239, 68, 68],
  FINAL_BG: [107, 114, 128],
};

/** =========================
 *  CSV HEADER ALIASES
 *  ========================= */
const ALIASES = {
  update: ["Update #", "Update", "Update#", "Index"],
  minutesLeft: ["Minutes Left", "Time Left", "Clock"],
  // Team names:
  awayTeam: ["Away", "Away Team", "AwayTeam"],
  homeTeam: ["Home", "Home Team", "HomeTeam"],

  // Scores:
  awayScore: ["Away Score", "Team A", "Score A", "A Score"],
  homeScore: ["Home Score", "Team B", "Score B", "B Score"],

  // Win prob (Away):
  awayWP: ["Away Win Probability", "Team A Win Probability", "Team A Win Prob", "Win Prob A", "Win Probability"],

  // Possession (Away):
  awayHasBall: ["Away has Ball (1=yes, 0=no)", "Team A has Ball (1=yes, 0=no)", "Has Ball", "Possession"],

  quarter: ["Quarter", "Q"],
  down: ["Down", "Down#"],
  distance: ["Distance", "To Go", "Yards To Go"],
  ytg: ["Yards to Goal", "YTG", "Yards To Goal"],

  pregame: ["Pregame Win Prob", "Pregame WP", "Pregame Probability", "Baseline Win Prob"],

  minutesElapsed: ["Minutes Elapsed", "Elapsed", "Game Progress"],
};

/** ============================================================
 *  UTIL
 *  ============================================================ */
function clamp(x, lo, hi){ return Math.max(lo, Math.min(hi, x)); }
function rgb(a){ return `rgb(${a[0]},${a[1]},${a[2]})`; }
function rgba(a, alpha){ return `rgba(${a[0]},${a[1]},${a[2]},${alpha})`; }
function isBlank(v){ return v == null || String(v).trim() === ""; }

function toFloat(v, def=NaN){
  if (v == null) return def;
  const s = String(v).trim();
  if (!s) return def;
  const n = Number(s);
  return Number.isFinite(n) ? n : def;
}
function toInt(v, def=null){
  const n = toFloat(v, NaN);
  if (!Number.isFinite(n)) return def;
  return Math.round(n);
}
function fmtPct(p){ return `${Math.round(p*100)}%`; }
function fmtClock(minutes){
  minutes = Math.max(0, minutes);
  const m = Math.floor(minutes);
  let s = Math.round((minutes - m)*60);
  let mm = m;
  if (s === 60){ mm += 1; s = 0; }
  return `${mm}:${String(s).padStart(2,"0")}`;
}
function parseMinutesLeft(v){
  // Accepts MM.SS style (18.40 => 18m40s) if needed
  if (!Number.isFinite(v) || v < 0) return v;
  const m = Math.floor(v);
  const frac = v - m;
  const ss = Math.round(frac * 100);
  if (ss >= 0 && ss <= 59) return m + ss/60;
  return v;
}

function pickHeader(headerMap, names){
  for (const n of names){
    const key = String(n).trim().toLowerCase();
    if (headerMap.has(key)) return headerMap.get(key);
  }
  return null;
}

/** Robust CSV parse (handles quoted commas) */
function parseCSV(text){
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;

  for (let i=0;i<text.length;i++){
    const c = text[i];
    const nxt = text[i+1];

    if (c === '"' && inQuotes && nxt === '"'){ // escaped quote
      cur += '"';
      i++;
      continue;
    }
    if (c === '"'){
      inQuotes = !inQuotes;
      continue;
    }
    if (c === "," && !inQuotes){
      row.push(cur);
      cur = "";
      continue;
    }
    if ((c === "\n" || c === "\r") && !inQuotes){
      if (c === "\r" && nxt === "\n") i++;
      row.push(cur);
      cur = "";
      // ignore trailing completely-empty last line
      const allEmpty = row.every(x => String(x ?? "").trim() === "");
      if (!allEmpty) rows.push(row);
      row = [];
      continue;
    }
    cur += c;
  }
  // last cell
  row.push(cur);
  const allEmpty = row.every(x => String(x ?? "").trim() === "");
  if (!allEmpty) rows.push(row);

  if (rows.length === 0) return { headers: [], data: [] };

  const headers = rows[0].map(h => String(h ?? "").trim());
  const data = rows.slice(1).map(r => {
    const obj = {};
    for (let i=0;i<headers.length;i++){
      obj[headers[i]] = r[i] ?? "";
    }
    return obj;
  });
  return { headers, data };
}

function buildHeaderMap(headers){
  const m = new Map();
  headers.forEach(h => m.set(String(h).trim().toLowerCase(), h));
  return m;
}

/** ============================================================
 *  SNAPSHOT PARSE
 *  ============================================================ */
function detectTeamsAndScoreCols(headers, data){
  const headerMap = buildHeaderMap(headers);

  const H_AWAY = pickHeader(headerMap, ALIASES.awayTeam);
  const H_HOME = pickHeader(headerMap, ALIASES.homeTeam);

  // Case A: sheet has explicit Away/Home columns containing team keys
  if (H_AWAY && H_HOME){
    const first = data.find(r => !isBlank(r[H_AWAY]) && !isBlank(r[H_HOME])) || data[0] || {};
    const awayKey = String(first[H_AWAY] ?? "").trim();
    const homeKey = String(first[H_HOME] ?? "").trim();

    // Scores can be in columns named by team key OR in Away Score/Home Score columns
    const H_AWAY_SCORE = headers.includes(awayKey) ? awayKey : pickHeader(headerMap, ALIASES.awayScore);
    const H_HOME_SCORE = headers.includes(homeKey) ? homeKey : pickHeader(headerMap, ALIASES.homeScore);

    return { awayKey, homeKey, H_AWAY_SCORE, H_HOME_SCORE, mode: "awayHomeCols" };
  }

  // Case B: your current format — Column C & D HEADERS are team keys
  // Example: headers[2]="Giants", headers[3]="Bengals"
  const awayKey = headers[2] ? String(headers[2]).trim() : "";
  const homeKey = headers[3] ? String(headers[3]).trim() : "";
  const H_AWAY_SCORE = awayKey;
  const H_HOME_SCORE = homeKey;

  return { awayKey, homeKey, H_AWAY_SCORE, H_HOME_SCORE, mode: "headerTeams" };
}

function computeClutchIndex(wps){
  if (wps.length < 3) return 0;
  const diffs = [];
  for (let i=1;i<wps.length;i++) diffs.push(wps[i] - wps[i-1]);
  const mean = diffs.reduce((a,b)=>a+b,0) / diffs.length;
  const varr = diffs.reduce((a,d)=>a + (d-mean)*(d-mean),0) / Math.max(1, diffs.length-1);
  const vol = Math.sqrt(varr);
  let crossings = 0;
  for (let i=1;i<wps.length;i++){
    if ((wps[i-1] < 0.5 && wps[i] >= 0.5) || (wps[i-1] >= 0.5 && wps[i] < 0.5)) crossings++;
  }
  const score = crossings * 18 + vol * 240;
  return Math.round(clamp(score, 0, 100));
}

function parseSnapshotsFromCSV(headers, data){
  const headerMap = buildHeaderMap(headers);

  const H_UPDATE = pickHeader(headerMap, ALIASES.update);
  const H_MINLEFT = pickHeader(headerMap, ALIASES.minutesLeft);

  const H_AWAY_WP = pickHeader(headerMap, ALIASES.awayWP);
  const H_AWAY_HASBALL = pickHeader(headerMap, ALIASES.awayHasBall);

  const H_Q = pickHeader(headerMap, ALIASES.quarter);
  const H_DOWN = pickHeader(headerMap, ALIASES.down);
  const H_DIST = pickHeader(headerMap, ALIASES.distance);
  const H_YTG = pickHeader(headerMap, ALIASES.ytg);

  const H_PREGAME = pickHeader(headerMap, ALIASES.pregame);
  const H_ELAPSED = pickHeader(headerMap, ALIASES.minutesElapsed);

  const { awayKey, homeKey, H_AWAY_SCORE, H_HOME_SCORE } = detectTeamsAndScoreCols(headers, data);

  if (!awayKey || !homeKey) throw new Error("Could not detect Away/Home teams. Need Away/Home columns OR team headers in C/D.");

  const snapsRaw = [];

  let autoUpdate = 1;
  for (const r of data){
    const upd = Number.isFinite(toFloat(r[H_UPDATE], NaN)) ? toInt(r[H_UPDATE]) : autoUpdate;
    autoUpdate++;

    const tLeft0 = toFloat(r[H_MINLEFT], NaN);
    const wp0 = toFloat(r[H_AWAY_WP], NaN);

    if (!Number.isFinite(tLeft0) || !Number.isFinite(wp0)) continue;

    const tLeft = parseMinutesLeft(tLeft0);
    const awayScore = toFloat(r[H_AWAY_SCORE], 0);
    const homeScore = toFloat(r[H_HOME_SCORE], 0);

    const hasBall = H_AWAY_HASBALL ? toInt(r[H_AWAY_HASBALL], null) : null;

    const q = H_Q ? toInt(r[H_Q], null) : null;
    const dn = H_DOWN ? toInt(r[H_DOWN], null) : null;
    const dist = H_DIST ? toInt(r[H_DIST], null) : null;
    const ytg = H_YTG ? toInt(r[H_YTG], null) : null;

    const pre = H_PREGAME ? toFloat(r[H_PREGAME], NaN) : NaN;
    const pregame = Number.isFinite(pre) ? clamp(pre, 0, 1) : null;

    const elapsed = H_ELAPSED ? toFloat(r[H_ELAPSED], NaN) : NaN;

    snapsRaw.push({
      update: upd,
      minutesLeft: tLeft,
      awayWP: clamp(wp0, 0, 1),
      awayScore,
      homeScore,
      hasBall,
      quarter: q,
      down: dn,
      distance: dist,
      ytg,
      pregame,
      minutesElapsed: elapsed
    });
  }

  if (snapsRaw.length === 0) throw new Error("No valid rows found (need Minutes Left + Away Win Prob).");

  snapsRaw.sort((a,b)=>a.update-b.update);

  // compute minutesElapsed if missing/invalid
  let prevLeft = snapsRaw[0].minutesLeft;
  let runningElapsed = 0;

  for (let i=0;i<snapsRaw.length;i++){
    const s = snapsRaw[i];
    if (!Number.isFinite(s.minutesElapsed)){
      if (i === 0){
        s.minutesElapsed = 0;
        prevLeft = s.minutesLeft;
        runningElapsed = 0;
      } else {
        const step = prevLeft - s.minutesLeft;
        if (step > 0){ runningElapsed += step; prevLeft = s.minutesLeft; }
        else { prevLeft = Math.min(prevLeft, s.minutesLeft); }
        s.minutesElapsed = runningElapsed;
      }
    }
  }

  return {
    awayKey, homeKey,
    snaps: snapsRaw
  };
}

/** ============================================================
 *  SMOOTHING (edge-padded moving average, like your python)
 *  ============================================================ */
function smoothSeries(x, y, pointsPerSegment=40){
  if (x.length < 2) return { xs: x.slice(), ys: y.slice() };

  const xs = [];
  const ys = [];
  for (let i=0;i<x.length-1;i++){
    const x0=x[i], x1=x[i+1];
    const y0=y[i], y1=y[i+1];
    for (let k=0;k<pointsPerSegment;k++){
      const t = k / pointsPerSegment;
      xs.push(x0 + (x1-x0)*t);
      ys.push(y0 + (y1-y0)*t);
    }
  }
  xs.push(x[x.length-1]);
  ys.push(y[y.length-1]);

  const win = 13; // odd
  if (ys.length >= win){
    const pad = Math.floor(win/2);
    const ypad = [];
    for (let i=0;i<pad;i++) ypad.push(ys[0]);
    for (let v of ys) ypad.push(v);
    for (let i=0;i<pad;i++) ypad.push(ys[ys.length-1]);

    const out = new Array(ys.length).fill(0);
    for (let i=0;i<ys.length;i++){
      let sum=0;
      for (let k=0;k<win;k++) sum += ypad[i+k];
      out[i] = sum / win;
    }
    return { xs, ys: out };
  }
  return { xs, ys };
}

/** ============================================================
 *  CANVAS DRAW HELPERS
 *  ============================================================ */
function roundRectPath(ctx, x,y,w,h,r){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr, y);
  ctx.arcTo(x+w, y, x+w, y+h, rr);
  ctx.arcTo(x+w, y+h, x, y+h, rr);
  ctx.arcTo(x, y+h, x, y, rr);
  ctx.arcTo(x, y, x+w, y, rr);
  ctx.closePath();
}
function drawShadowCard(ctx, x,y,w,h,r, shadowAlpha=0.22, blur=40, oy=24){
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${shadowAlpha})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = oy;
  ctx.fillStyle = "rgba(0,0,0,0.001)"; // force shadow
  roundRectPath(ctx, x,y,w,h,r);
  ctx.fill();
  ctx.restore();
}
function drawGradientRoundedRect(ctx, x,y,w,h,r, c1, c2){
  ctx.save();
  const g = ctx.createLinearGradient(0, y, 0, y+h);
  g.addColorStop(0, rgb(c1));
  g.addColorStop(1, rgb(c2));
  roundRectPath(ctx, x,y,w,h,r);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}
function strokeRoundedRect(ctx, x,y,w,h,r, color, lineWidth=2, alpha=0.25){
  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = rgba(color, alpha);
  roundRectPath(ctx, x,y,w,h,r);
  ctx.stroke();
  ctx.restore();
}
function setFont(ctx, px, weight=700){
  ctx.font = `${weight} ${px}px system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial`;
}

function loadImage(src){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = ()=>resolve(null);
    img.src = src;
  });
}

/** ============================================================
 *  DRAW CHART
 *  ============================================================ */
function drawChart(ctx, rect, xs, ys, awayColor, homeColor, pregame){
  const { x, y, w, h } = rect;

  // panel background already drawn outside; here draw grid + line
  const baselineVal = 0.5;

  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = -0.03;
  const yMax = 1.03;

  const X = (v)=> x + (v - xMin) / (xMax - xMin || 1) * w;
  const Y = (v)=> y + (1 - (v - yMin) / (yMax - yMin)) * h;

  // grid
  ctx.save();
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = rgb(THEME.GRID);
  // y grid at 0, .25, .5, .75, 1
  const yTicks = [0,0.25,0.5,0.75,1];
  for (const t of yTicks){
    const yy = Y(t);
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.lineTo(x+w, yy);
    ctx.stroke();
  }
  ctx.restore();

  // midline subtle
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgb(210,210,210)";
  const midY = Y(0.5);
  ctx.beginPath();
  ctx.moveTo(x, midY);
  ctx.lineTo(x+w, midY);
  ctx.stroke();
  ctx.restore();

  // pregame
  if (SHOW_PREGAME_BASELINE && pregame != null){
    ctx.save();
    ctx.setLineDash([10,10]);
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 3;
    ctx.strokeStyle = rgb(THEME.MUTED);
    const py = Y(pregame);
    ctx.beginPath();
    ctx.moveTo(x, py);
    ctx.lineTo(x+w, py);
    ctx.stroke();
    ctx.restore();
  }

  // build points
  const pts = xs.map((vx,i)=>({ x: X(vx), y: Y(ys[i]), v: ys[i] }));

  // fill areas above/below baseline with crossings
  function fillBetween(predicateAbove, fillRGBA){
    let poly = null;

    const baselineY = Y(baselineVal);

    function flush(){
      if (!poly || poly.length < 3) { poly=null; return; }
      ctx.save();
      ctx.fillStyle = fillRGBA;
      ctx.beginPath();
      ctx.moveTo(poly[0].x, poly[0].y);
      for (let i=1;i<poly.length;i++) ctx.lineTo(poly[i].x, poly[i].y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      poly = null;
    }

    for (let i=0;i<pts.length-1;i++){
      const p = pts[i], q = pts[i+1];
      const a = p.v >= baselineVal;
      const b = q.v >= baselineVal;

      const inA = predicateAbove(a);
      const inB = predicateAbove(b);

      if (a === b){
        if (inA){
          if (!poly){
            poly = [{x:p.x, y:baselineY},{x:p.x, y:p.y}];
          }
          poly.push({x:q.x, y:q.y});
        }
      } else {
        // intersection t where v==baseline
        const t = (baselineVal - p.v) / (q.v - p.v);
        const xi = p.x + (q.x - p.x)*t;
        const yi = p.y + (q.y - p.y)*t;

        if (inA){
          if (!poly){
            poly = [{x:p.x, y:baselineY},{x:p.x, y:p.y}];
          }
          poly.push({x:xi, y:yi});
          poly.push({x:xi, y:baselineY});
          flush();
        }

        if (inB){
          poly = [{x:xi, y:baselineY},{x:xi, y:yi},{x:q.x, y:q.y}];
        }
      }
    }

    if (poly){
      // close to baseline at end
      poly.push({x: poly[poly.length-1].x, y: Y(baselineVal)});
      flush();
    }
  }

  // fills (alpha similar to python)
  fillBetween((isAbove)=>isAbove, rgba(awayColor, 0.28));
  fillBetween((isAbove)=>!isAbove, rgba(homeColor, 0.28));

  // line (segment-colored)
  ctx.save();
  ctx.lineWidth = 6;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.95;

  for (let i=0;i<pts.length-1;i++){
    const p=pts[i], q=pts[i+1];
    const mid = (p.v + q.v)/2;
    const col = mid >= 0.5 ? awayColor : homeColor;
    ctx.strokeStyle = rgb(col);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  }
  ctx.restore();

  // endpoint marker (glow + dot)
  const last = pts[pts.length-1];
  const lastCol = (ys[ys.length-1] >= 0.5) ? awayColor : homeColor;

  ctx.save();
  const glowSizes = [46, 36, 28];
  const glowAlphas = [0.14, 0.10, 0.06];
  for (let i=0;i<glowSizes.length;i++){
    ctx.globalAlpha = glowAlphas[i];
    ctx.fillStyle = rgb(lastCol);
    ctx.beginPath();
    ctx.arc(last.x, last.y, glowSizes[i], 0, Math.PI*2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = rgb(lastCol);
  ctx.strokeStyle = rgb(THEME.TEXT);
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(last.x, last.y, 16, 0, Math.PI*2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** ============================================================
 *  RENDER CARD
 *  ============================================================ */
async function renderCardFromData(canvas, parsed){
  const { awayKey, homeKey, snaps } = parsed;

  const awayMeta = TEAM_META[awayKey] || { display: awayKey, logo: null, color: [59,130,246] };
  const homeMeta = TEAM_META[homeKey] || { display: homeKey, logo: null, color: [239,68,68] };

  const awayColor = awayMeta.color;
  const homeColor = homeMeta.color;

  // Load logos
  const [awayLogo, homeLogo] = await Promise.all([
    awayMeta.logo ? loadImage(awayMeta.logo) : Promise.resolve(null),
    homeMeta.logo ? loadImage(homeMeta.logo) : Promise.resolve(null),
  ]);

  // hi-dpi canvas
  const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
  canvas.width  = FINAL_W * dpr;
  canvas.height = FINAL_H * dpr;
  canvas.style.width = "100%";
  canvas.style.height = "auto";

  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr,0,0,dpr,0,0);

  // background
  ctx.fillStyle = rgb(THEME.BG);
  ctx.fillRect(0,0,FINAL_W,FINAL_H);

  // outer card
  const m = 40;
  const x0 = m, y0 = m, x1 = FINAL_W - m, y1 = FINAL_H - m;
  const cw = x1-x0, ch = y1-y0;
  const cardR = 40;

  drawShadowCard(ctx, x0,y0,cw,ch,cardR, 0.35, 60, 28);
  drawGradientRoundedRect(ctx, x0,y0,cw,ch,cardR, THEME.CARD, THEME.CARD_LIGHT);
  strokeRoundedRect(ctx, x0,y0,cw,ch,cardR, [255,255,255], 3, 0.18);

  // header
  const headerH = 250;
  drawGradientRoundedRect(ctx, x0,y0,cw,headerH,cardR, [36,46,66], [28,37,54]);

  const last = snaps[snaps.length-1];
  const wpAwayDisp = clamp(last.awayWP, DISPLAY_CLAMP_LO, DISPLAY_CLAMP_HI);
  const wpHomeDisp = 1 - wpAwayDisp;

  // left/right zones
  const padX = 60;
  const innerW = cw;
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

  function drawLogo(img, x,y,size){
    if (!img) return;
    // contain
    const scale = Math.min(size/img.width, size/img.height);
    const w = img.width*scale, h = img.height*scale;
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.filter = "blur(8px)";
    ctx.drawImage(img, x+4, y+8, w, h);
    ctx.restore();

    ctx.save();
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();
  }

  const logoLeftX = L0 + 10;
  const logoRightX = R1 - 10 - logoBox;

  drawLogo(awayLogo, logoLeftX, logoY, logoBox);
  drawLogo(homeLogo, logoRightX, logoY, logoBox);

  // team names + probs
  const nameY = y0 + 90;
  const probY = y0 + 148;

  setFont(ctx, 40, 800);
  ctx.fillStyle = rgb(THEME.TEXT);
  const awayNameX = logoLeftX + logoBox + 22;
  ctx.fillText(awayMeta.display, awayNameX, nameY + 40);

  setFont(ctx, 24, 800);
  ctx.fillStyle = rgb(awayColor);
  ctx.fillText(`Win Prob: ${fmtPct(wpAwayDisp)}`, awayNameX, probY + 24);

  // right side
  setFont(ctx, 40, 800);
  ctx.fillStyle = rgb(THEME.TEXT);
  const homeName = homeMeta.display;
  const homeNameW = ctx.measureText(homeName).width;
  const homeNameX = (logoRightX - 22) - homeNameW;
  ctx.fillText(homeName, homeNameX, nameY + 40);

  setFont(ctx, 24, 800);
  ctx.fillStyle = rgb(homeColor);
  const homeProbText = `Win Prob: ${fmtPct(wpHomeDisp)}`;
  const homeProbW = ctx.measureText(homeProbText).width;
  ctx.fillText(homeProbText, (logoRightX - 22) - homeProbW, probY + 24);

  // Center stack (league/week/score/time)
  const headerCX = Math.floor((x0+x1)/2);
  const headerInnerTop = y0 + 18;
  const headerInnerBot = y0 + headerH - 18;
  const usableH = headerInnerBot - headerInnerTop;

  const scoreAway = String(Math.trunc(last.awayScore));
  const scoreHome = String(Math.trunc(last.homeScore));
  const dash = "—";
  const timeStr = `${fmtClock(last.minutesLeft)} REMAINING`;

  // Auto-scale center stack
  let scale = 1.0;
  let metrics = null;

  for (let i=0;i<18;i++){
    const leaguePx = Math.max(10, Math.floor(20*scale));
    const weekPx   = Math.max(10, Math.floor(17*scale));
    const scorePx  = Math.max(10, Math.floor(110*scale));
    const timePx   = Math.max(10, Math.floor(30*scale));
    const stripPx  = Math.max(10, Math.floor(20*scale));

    const titleGap = Math.floor(6*scale);
    const gapTitleToScore = Math.floor(14*scale);
    const gapScoreToTime  = Math.floor(30*scale);

    // optional strip
    let strip = null;
    if (last.quarter != null){
      const parts = [`Q${last.quarter}`];
      if (last.down != null && last.distance != null){
        const ord = last.down===1?"1st":last.down===2?"2nd":last.down===3?"3rd":`${last.down}th`;
        parts.push(`${ord} & ${last.distance}`);
      }
      if (last.ytg != null) parts.push(`YTG ${last.ytg}`);
      strip = parts.join(" • ");
    }

    // measure
    setFont(ctx, leaguePx, 800);
    const lnH = leaguePx + 6;
    setFont(ctx, weekPx, 700);
    const wkH = weekPx + 6;

    setFont(ctx, scorePx, 900);
    const wA = ctx.measureText(scoreAway).width;
    const wD = ctx.measureText(dash).width;
    const wB = ctx.measureText(scoreHome).width;
    const scoreH = scorePx + 10;
    const gapSB = Math.floor(26*scale);
    const scoreTotalW = wA + gapSB + wD + gapSB + wB;

    setFont(ctx, timePx, 800);
    const tw = ctx.measureText(timeStr).width;
    const th = timePx + 8;

    const pillPadX = Math.floor(26*scale);
    const pillPadY = Math.floor(13*scale);
    const pillW = tw + 2*pillPadX;
    const pillH = th + 2*pillPadY;

    setFont(ctx, stripPx, 700);
    const stripH = strip ? (stripPx + 6) : 0;
    const gapTimeToStrip = strip ? Math.floor(12*scale) : 0;

    const leagueBlockH = lnH + titleGap + wkH;
    let stackH = leagueBlockH + gapTitleToScore + scoreH + gapScoreToTime + pillH;
    if (strip) stackH += gapTimeToStrip + stripH;

    if (stackH <= usableH*0.92){
      metrics = {
        scale, leaguePx, weekPx, scorePx, timePx, stripPx,
        titleGap, gapTitleToScore, gapScoreToTime, gapSB, scoreTotalW, scoreH,
        pillPadX, pillPadY, pillW, pillH, strip, stripH, gapTimeToStrip,
        lnH, wkH
      };
      break;
    }
    scale *= 0.92;
  }

  if (!metrics) metrics = { scale:1, leaguePx:20, weekPx:17, scorePx:110, timePx:30, stripPx:20, titleGap:6, gapTitleToScore:14, gapScoreToTime:30, gapSB:26, scoreTotalW:0, scoreH:110, pillPadX:26, pillPadY:13, pillW:0, pillH:0, strip:null, stripH:0, gapTimeToStrip:0, lnH:26, wkH:24 };

  const stackH =
    (metrics.lnH + metrics.titleGap + metrics.wkH) +
    metrics.gapTitleToScore + metrics.scoreH + metrics.gapScoreToTime + metrics.pillH +
    (metrics.strip ? (metrics.gapTimeToStrip + metrics.stripH) : 0);

  const stackTop = headerInnerTop + Math.max(0, Math.floor((usableH - stackH)/2));

  // league + week
  setFont(ctx, metrics.leaguePx, 800);
  ctx.fillStyle = rgb(THEME.TEXT);
  const leagueW = ctx.measureText(LEAGUE_NAME).width;
  ctx.fillText(LEAGUE_NAME, headerCX - leagueW/2, stackTop + metrics.lnH);

  setFont(ctx, metrics.weekPx, 700);
  ctx.fillStyle = rgb(THEME.SUBTEXT);
  const weekW = ctx.measureText(WEEK_LABEL).width;
  const weekY = stackTop + metrics.lnH + metrics.titleGap + metrics.wkH;
  ctx.fillText(WEEK_LABEL, headerCX - weekW/2, weekY);

  // score line
  setFont(ctx, metrics.scorePx, 900);
  const wA = ctx.measureText(scoreAway).width;
  const wD = ctx.measureText(dash).width;
  const wB = ctx.measureText(scoreHome).width;
  const scoreTotalW = wA + metrics.gapSB + wD + metrics.gapSB + wB;
  const scoreY = weekY + metrics.gapTitleToScore + metrics.scoreH;

  let sx = headerCX - scoreTotalW/2;
  ctx.fillStyle = rgb(THEME.TEXT);
  ctx.fillText(scoreAway, sx, scoreY);
  sx += wA + metrics.gapSB;
  ctx.fillStyle = rgb(THEME.MUTED);
  ctx.fillText(dash, sx, scoreY);
  sx += wD + metrics.gapSB;
  ctx.fillStyle = rgb(THEME.TEXT);
  ctx.fillText(scoreHome, sx, scoreY);

  // time pill
  const pillX = headerCX - metrics.pillW/2;
  const pillY = scoreY + metrics.gapScoreToTime;

  // pill background gradient
  ctx.save();
  const g = ctx.createLinearGradient(0, pillY, 0, pillY + metrics.pillH);
  g.addColorStop(0, rgb(THEME.CARD_LIGHT));
  g.addColorStop(1, rgb(THEME.CARD));
  ctx.fillStyle = g;
  roundRectPath(ctx, pillX, pillY, metrics.pillW, metrics.pillH, Math.floor(metrics.pillH/2));
  ctx.fill();
  ctx.restore();
  strokeRoundedRect(ctx, pillX, pillY, metrics.pillW, metrics.pillH, Math.floor(metrics.pillH/2), [255,255,255], 3, 0.35);

  setFont(ctx, metrics.timePx, 800);
  ctx.fillStyle = rgb(THEME.TEXT);
  const tW = ctx.measureText(timeStr).width;
  ctx.fillText(timeStr, headerCX - tW/2, pillY + metrics.pillH/2 + metrics.timePx/2 - 4);

  // strip
  if (metrics.strip){
    setFont(ctx, metrics.stripPx, 700);
    ctx.fillStyle = rgb(THEME.MUTED);
    const sW = ctx.measureText(metrics.strip).width;
    const stripY = pillY + metrics.pillH + metrics.gapTimeToStrip + metrics.stripH;
    ctx.fillText(metrics.strip, headerCX - sW/2, stripY);
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

  const pw = px1-px0, ph = py1-py0;

  drawShadowCard(ctx, px0,py0,pw,ph,pr, 0.28, 50, 22);
  drawGradientRoundedRect(ctx, px0,py0,pw,ph,pr, THEME.CARD_LIGHT, THEME.CARD);
  strokeRoundedRect(ctx, px0,py0,pw,ph,pr, [255,255,255], 3, 0.22);

  const innerPad = 32;
  const plotRect = {
    x: px0 + innerPad,
    y: py0 + innerPad,
    w: pw - 2*innerPad,
    h: ph - 2*innerPad,
  };

  // series
  const xRaw = snaps.map(s => s.minutesElapsed);
  const yRaw = snaps.map(s => clamp(s.awayWP, 0, 1));

  // remove duplicate x (keep last y)
  const x2 = [];
  const y2 = [];
  for (let i=0;i<xRaw.length;i++){
    const x = xRaw[i], y = yRaw[i];
    if (x2.length && x === x2[x2.length-1]){
      y2[y2.length-1] = y;
    } else {
      x2.push(x); y2.push(y);
    }
  }

  const { xs, ys } = smoothSeries(x2, y2, 40);

  // pregame (last non-null)
  let pregame = null;
  for (let i=snaps.length-1;i>=0;i--){
    if (snaps[i].pregame != null){ pregame = snaps[i].pregame; break; }
  }

  drawChart(ctx, plotRect, xs, ys, awayColor, homeColor, pregame);

  // Bottom pills
  const status = (last.minutesLeft <= 1e-6) ? "FINAL" : "LIVE";

  const momBaseIdx = Math.max(0, snaps.length-1-MOMENTUM_N);
  const momentum = snaps[snaps.length-1].awayWP - snaps[momBaseIdx].awayWP;
  const momPct = Math.round(momentum*100);
  const momBg = (momPct >= 0) ? awayColor : homeColor;

  // big swing
  let bestSwing = 0;
  let bestUpdate = snaps[snaps.length-1].update;
  for (let i=1;i<snaps.length;i++){
    const d = snaps[i].awayWP - snaps[i-1].awayWP;
    if (Math.abs(d) > Math.abs(bestSwing)){ bestSwing = d; bestUpdate = snaps[i].update; }
  }
  const swingPct = Math.round(bestSwing*100);

  const clutch = computeClutchIndex(snaps.map(s=>s.awayWP));

  const pills = [];
  if (status === "LIVE") pills.push({ t:"● LIVE", bg:[...THEME.LIVE_BG, 1] });
  else pills.push({ t:"FINAL", bg:[...THEME.FINAL_BG, 1] });

  pills.push({ t:`MOMENTUM ${momPct>=0?"+":""}${momPct}%`, bg:[...momBg, 0.96] });
  pills.push({ t:`CLUTCH ${clutch}`, bg:[100,116,139,0.92] });
  pills.push({ t:`BIG SWING ${swingPct>=0?"+":""}${swingPct}% @#${bestUpdate}`, bg:[71,85,105,0.88] });

  if (pregame != null){
    const edge = Math.round((pregame - 0.5)*100);
    pills.push({ t:`PREGAME EDGE ${edge>=0?"+":""}${edge}%`, bg:[51,65,85,0.84] });
  }

  drawPills(ctx, x0+64, x1-64, y1-98, pills);
}

function drawPills(ctx, xLeft, xRight, yTop, pills){
  // auto fit by shrinking font
  const avail = xRight - xLeft;
  let fontPx = 24;
  const padX = 24;
  const padY = 14;
  const gap = 18;
  const r = 24;

  function measureAll(){
    setFont(ctx, fontPx, 800);
    const widths = pills.map(p => ctx.measureText(p.t).width + 2*padX);
    const heights = pills.map(()=> (fontPx+8) + 2*padY);
    const total = widths.reduce((a,b)=>a+b,0) + gap*(pills.length-1);
    return { widths, heights, total, pillH: Math.max(...heights) };
  }

  let m = measureAll();
  while (m.total > avail && fontPx > 16){
    fontPx = Math.floor(fontPx * 0.92);
    m = measureAll();
  }

  let x = xLeft + Math.max(0, Math.floor((avail - m.total)/2));
  const pillH = m.pillH;
  const rr = Math.floor(pillH/2);

  for (let i=0;i<pills.length;i++){
    const p = pills[i];
    const w = m.widths[i];

    // bg
    ctx.save();
    ctx.fillStyle = `rgba(${p.bg[0]},${p.bg[1]},${p.bg[2]},${p.bg[3]})`;
    roundRectPath(ctx, x, yTop, w, pillH, rr);
    ctx.fill();
    ctx.restore();

    // border
    ctx.save();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    roundRectPath(ctx, x, yTop, w, pillH, rr);
    ctx.stroke();
    ctx.restore();

    // text
    setFont(ctx, fontPx, 800);
    ctx.fillStyle = rgb(THEME.TEXT);
    ctx.fillText(p.t, x + padX, yTop + padY + fontPx + 2);

    x += w + gap;
  }
}

/** ============================================================
 *  FETCH + LOOP
 *  ============================================================ */
async function fetchCSV(url){
  const bust = (url.includes("?") ? "&" : "?") + "t=" + Date.now();
  const res = await fetch(url + bust, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  return await res.text();
}

async function tick(canvas){
  if (!SHEET_CSV_URL || SHEET_CSV_URL.startsWith("PASTE_")){
    throw new Error("Set SHEET_CSV_URL in app.js to your published Google Sheet CSV link.");
  }
  let csvText = null;
  try {
    csvText = await fetchCSV(SHEET_CSV_URL);
  } catch (e) {
    console.warn("Falling back to sample CSV due to fetch error", e);
    csvText = SAMPLE_CSV;
  }

  const { headers, data } = parseCSV(csvText);
  const parsed = parseSnapshotsFromCSV(headers, data);
  await renderCardFromData(canvas, parsed);
}

(function start(){
  const canvas = document.getElementById("wpCanvas");
  let running = false;

  async function loop(){
    if (running) return;
    running = true;
    try {
      await tick(canvas);
    } catch (e){
      // simple error render
      const dpr = Math.max(1, Math.floor(window.devicePixelRatio || 1));
      canvas.width = FINAL_W * dpr;
      canvas.height = FINAL_H * dpr;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.fillStyle = rgb(THEME.BG);
      ctx.fillRect(0,0,FINAL_W,FINAL_H);
      setFont(ctx, 30, 800);
      ctx.fillStyle = rgb(THEME.TEXT);
      ctx.fillText("ERROR", 60, 90);
      setFont(ctx, 18, 600);
      ctx.fillStyle = rgb(THEME.SUBTEXT);
      ctx.fillText(String(e?.message || e), 60, 130);
      ctx.fillText("Make sure the sheet is Published as CSV and SHEET_CSV_URL is correct.", 60, 160);
    } finally {
      running = false;
    }
  }

  loop();
  setInterval(loop, REFRESH_MS);
})();
