/* Parchi rig: one function draws any action at any time t (seconds).
 * Same action names and loop lengths as the Tween kit (ACTIONS.md).
 * Usage: ParchiRig.svg(action, t, { look:[x,y], blink:bool, id:"unique" }) -> "<svg …>"
 * Works in the browser (window.ParchiRig) and in Node (module.exports).
 */
(function (root) {
  const C = {
    navy: "#17253b", paper: "#FFFDF6", edge: "#D9E2EE", line: "#C3D0DF",
    teal: "#2BB5B0", tealD: "#1A8C88", tealL: "#E3F6F5", gold: "#F2B33D", blush: "#F7A8A0", fold: "#EEF2F7"
  };
  const ACTIONS = {
    idle: 3.6, "walk-right": 3.2, "walk-left": 3.2, wave: 4.16, "point-right": 3.6, "point-left": 3.6, "point-up": 3.6,
    talk: 3.9, think: 4.8, celebrate: 2.24, sleep: 9.6, shrug: 3.6, peek: 3.6,
    reach: 3.6, present: 3.6, climb: 3.0, perch: 5.6, cover: 3.6, land: 1.2,
    // Parchi's own actions (beyond the Tween set)
    namaste: 3.6, "thumbs-up": 3.6, clap: 2.4, nod: 2.4, "shake-no": 2.4, surprised: 3.6, oops: 3.6, heart: 3.6,
    "check-off": 4.8, write: 3.6, stamp: 2.4, search: 3.6, remind: 3.6, "hold-sign": 3.6, phone: 3.6, send: 2.4,
    jump: 1.6, "run-right": 1.6, "run-left": 1.6, sit: 5.6, "point-down": 3.6, loading: 3.6
  };
  const SHOULDER_L = [80, 132], SHOULDER_R = [160, 132], L1 = 22, L2 = 20;
  // Two-link arm solver: angles (upper, fore) that put the hand on a target point.
  function ik(s, tx, ty, bend) {
    const dx = tx - s[0], dy = ty - s[1];
    const d = Math.min(L1 + L2 - 0.5, Math.max(Math.abs(L1 - L2) + 0.5, Math.hypot(dx, dy)));
    const phi = Math.atan2(dx, dy) / R;
    const alpha = Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)) / R;
    const a1 = phi + bend * alpha;
    const ex = s[0] + L1 * Math.sin(a1 * R), ey = s[1] + L1 * Math.cos(a1 * R);
    const a2 = Math.atan2(tx - ex, ty - ey) / R - a1;
    return [a1, a2];
  }
  const lerp = (a, b, k) => a + (b - a) * k;
  const R = Math.PI / 180;
  const f = n => (Math.round(n * 10) / 10).toString();
  const wav = (t, T) => Math.sin(2 * Math.PI * t / T);

  function pose(action, t) {
    const p = {
      L: [-22, -8], Rt: [22, 8], legL: 0, legR: 0, dx: 0, dy: 0, tilt: 0, sx: 1, sy: 1, skew: 0,
      eyes: "open", mouth: "smile", look: [0, 0], rows: [1, 1, 0], stamp: 0, props: [], flip: false,
      ledge: false, pen: false, slip: false, sit: false, extra: [], write: null, plane: null, heartK: 1
    };
    const T = ACTIONS[action] || 3.6;
    const ph = ((t % T) + T) % T / T;
    switch (action) {
      case "idle":
        p.dy = 1.8 * wav(t, 3.6); p.skew = 1.2 * wav(t, 1.8); break;
      case "walk-right": case "walk-left": {
        const w = wav(t, 0.64), dir = action === "walk-right" ? 1 : -1;
        p.legL = 24 * w; p.legR = -24 * w;
        p.L = [-22 - 20 * w, -10]; p.Rt = [22 - 20 * w, 10];
        p.dy = -2.5 * Math.abs(wav(t, 1.28)); p.tilt = 4 * dir; p.look = [3 * dir, 0]; p.skew = -2 * dir; break;
      }
      case "wave":
        p.Rt = [150, 24 + 24 * wav(t, 0.52)]; p.mouth = "grin"; p.tilt = -2; p.dy = 1.2 * wav(t, 4.16 / 4); break;
      case "point-right":
        p.Rt = [90 + 3 * wav(t, 1.2), 0]; p.look = [3.5, 0]; p.tilt = 2; break;
      case "point-left":
        p.L = [-90 - 3 * wav(t, 1.2), 0]; p.look = [-3.5, 0]; p.tilt = -2; break;
      case "point-up":
        p.Rt = [168, 4 + 3 * wav(t, 1.2)]; p.look = [1, -3.5]; break;
      case "talk":
        p.Rt = [64, 46 + 12 * wav(t, 1.3)]; p.L = [-26 - 6 * wav(t, 1.95), -14]; p.mouth = "talk"; p.dy = 1.2 * wav(t, 1.95); break;
      case "think":
        p.Rt = [150, 86]; p.eyes = "think"; p.look = [2.6, -3]; p.tilt = -3; p.mouth = "small"; p.props = ["dots"]; break;
      case "celebrate": {
        p.dy = -14 * Math.abs(Math.sin(Math.PI * t / 0.56));
        const k = 6 * wav(t, 0.56);
        p.L = [-158 - k, -12]; p.Rt = [158 + k, 12]; p.legL = -10; p.legR = 10;
        p.eyes = "happy"; p.mouth = "open"; p.rows = [1, 1, 1]; p.stamp = 1; p.props = ["confetti"]; break;
      }
      case "sleep":
        p.L = [-10, -4]; p.Rt = [10, 4]; p.eyes = "sleep"; p.mouth = "small"; p.tilt = 6; p.dy = 4;
        p.sy = 1 + 0.015 * wav(t, 4.8); p.props = ["zzz"]; break;
      case "shrug": {
        const b = Math.max(0, wav(t, 1.8));
        p.L = [-50, -90]; p.Rt = [50, 90]; p.eyes = "worried"; p.mouth = "wavy"; p.dy = 2 - 3 * b; p.tilt = 3; break;
      }
      case "peek":
        p.flip = true; p.Rt = [118 + 10 * wav(t, 0.9), 34]; p.tilt = -5; p.look = [2, 0]; break;
      case "reach": {
        const ph = (t % T) / T;
        p.Rt = ph < 0.5 ? [172, 26 + 14 * wav(t, 0.6)] : [70, -50]; p.pen = ph >= 0.5;
        p.look = ph < 0.5 ? [1, -3.5] : [3, 2]; p.eyes = ph < 0.5 ? "think" : "open"; p.tilt = ph < 0.5 ? 3 : 0; break;
      }
      case "present": {
        const ph = (t % T) / T;
        p.dy = ph < 0.18 ? -10 * Math.sin(Math.PI * ph / 0.18) : 0;
        p.Rt = [96, -34]; p.slip = true; p.mouth = "grin"; p.look = [3, 1.5]; break;
      }
      case "climb": {
        const c = wav(t, 0.75);
        p.L = [-165 + 12 * c, -10]; p.Rt = [165 + 12 * c, 10]; p.legL = 26 * c; p.legR = -26 * c;
        p.dy = -3 * Math.abs(c); p.look = [0, -3.5]; break;
      }
      case "perch":
        p.sit = true; p.ledge = true; p.legL = 10 + 14 * wav(t, 1.4); p.legR = -10 + 14 * wav(t, 1.4 * 1.1);
        p.L = [-36, -40]; p.Rt = [36, 40]; p.eyes = "happy"; p.mouth = "smile"; p.dy = -14; break;
      case "cover": {
        const peekNow = (t % 1.8) > 1.1;
        p.cover = true; p.coverPeek = peekNow; p.mouth = "grin"; p.skew = 1.5 * wav(t, 0.3); break;
      }
      case "land": {
        const ph = (t % T) / T;
        if (ph < 0.3) { p.dy = -46 * (1 - ph / 0.3) * (1 - ph / 0.3); p.L = [-140, -10]; p.Rt = [140, 10]; p.eyes = "happy"; }
        else if (ph < 0.55) { const k = Math.sin(Math.PI * (ph - 0.3) / 0.25); p.sy = 1 - 0.14 * k; p.sx = 1 + 0.08 * k; p.L = [-60, -20]; p.Rt = [60, 20]; }
        else { const k = Math.sin(Math.PI * Math.min(1, (ph - 0.55) / 0.25)) * (ph < 0.8 ? 1 : 0); p.sy = 1 + 0.05 * k; p.sx = 1 - 0.03 * k; }
        break;
      }
      /* ---------- Parchi's own actions ---------- */
      case "namaste": {
        const bow = ph > 0.35 && ph < 0.8 ? Math.sin(Math.PI * (ph - 0.35) / 0.45) : 0;
        p.L = ik(SHOULDER_L, 116, 146, -1); p.Rt = ik(SHOULDER_R, 124, 146, 1);
        p.dy = 4 * bow; p.sy = 1 - 0.03 * bow; p.eyes = bow > 0.3 ? "happy" : "open"; p.extra = ["palms"]; break;
      }
      case "thumbs-up":
        p.Rt = [128, 40 + 4 * wav(t, 1.2)]; p.eyes = "wink"; p.mouth = "grin"; p.tilt = -2;
        p.extra = ["thumb", "sparkle"]; break;
      case "clap": {
        const c = (1 + wav(t, 0.4)) / 2;
        p.L = ik(SHOULDER_L, lerp(96, 117, c), 148, -1); p.Rt = ik(SHOULDER_R, lerp(144, 123, c), 148, 1);
        p.eyes = "happy"; p.mouth = "open"; p.dy = -2 * c; if (c > 0.92) p.extra = ["burst-clap"]; break;
      }
      case "nod": {
        const n = wav(t, 0.8);
        p.dy = 2.5 * Math.max(0, n); p.look = [0, 2.6 * n]; p.sy = 1 - 0.02 * Math.max(0, n); p.mouth = "smile"; break;
      }
      case "shake-no": {
        const s = wav(t, 0.6);
        p.look = [3.2 * s, 0]; p.skew = 2.5 * s; p.dx = 1.5 * s; p.mouth = "small"; p.eyes = "worried"; break;
      }
      case "surprised": {
        p.dy = ph < 0.12 ? -8 * Math.sin(Math.PI * ph / 0.12) : 0;
        p.L = [-120, -40]; p.Rt = [120, 40]; p.eyes = "wide"; p.mouth = "open"; p.extra = ["exclaim"]; break;
      }
      case "oops":
        p.Rt = [160, 72 + 6 * wav(t, 0.5)]; p.eyes = "worried"; p.mouth = "wavy"; p.tilt = 4; p.extra = ["sweat"]; break;
      case "heart":
        p.L = ik(SHOULDER_L, 108, 162, -1); p.Rt = ik(SHOULDER_R, 132, 162, 1);
        p.eyes = "happy"; p.mouth = "smile"; p.heartK = 1 + 0.08 * Math.max(0, wav(t, 0.9)); p.extra = ["heart"]; break;
      case "check-off": {
        const step = Math.min(3, Math.floor(ph * 4));
        p.rows = [step > 0 ? 1 : 0, step > 1 ? 1 : 0, step > 2 ? 1 : 0];
        const rowY = [136, 154, 172][Math.min(2, step)];
        const wig = (ph * 4) % 1 < 0.5 ? 2 * wav(t, 0.18) : 0;
        p.Rt = step < 3 ? ik(SHOULDER_R, 100 + wig, rowY - 4, 1) : [60, 40];
        p.pen = true; p.look = step < 3 ? [-1.5, 3] : [0, 0]; p.eyes = step < 3 ? "open" : "happy"; p.mouth = step < 3 ? "small" : "grin";
        p.dy = step === 3 ? -6 * Math.abs(Math.sin(Math.PI * ((ph - 0.75) / 0.25))) : 0; break;
      }
      case "write": {
        const k = Math.min(1, ph * 1.3);
        p.rows = [1, 1, 0]; p.write = k; p.pen = true;
        p.Rt = ik(SHOULDER_R, 105 + 44 * k, 168 + 2 * wav(t, 0.12), 1); p.look = [0, 3]; p.mouth = "small"; break;
      }
      case "stamp": {
        let tx = 150, ty = 74, sq = 0;
        if (ph < 0.4) { ty = lerp(150, 60, ph / 0.4); }
        else if (ph < 0.5) { ty = lerp(60, 184, (ph - 0.4) / 0.1); }
        else { ty = lerp(184, 150, Math.min(1, (ph - 0.5) / 0.5)); sq = ph < 0.62 ? Math.sin(Math.PI * (ph - 0.5) / 0.12) : 0; }
        p.Rt = ik(SHOULDER_R, tx, ty, 1); p.extra = ["stamp-tool"]; p.stamp = ph >= 0.48 ? 1 : 0;
        p.sy = 1 - 0.06 * sq; p.sx = 1 + 0.03 * sq; if (sq > 0.2) p.extra.push("burst-stamp");
        p.eyes = ph >= 0.48 ? "happy" : "open"; p.mouth = ph >= 0.48 ? "grin" : "small"; p.rows = ph >= 0.48 ? [1, 1, 1] : [1, 1, 0]; break;
      }
      case "search": {
        const sx = 132 + 14 * wav(t, 1.8);
        p.Rt = ik(SHOULDER_R, sx + 4, 120, 1); p.extra = ["magnifier"]; p.look = [3 * wav(t, 1.8), 0]; p.mouth = "small"; p.eyes = "think"; break;
      }
      case "remind":
        p.Rt = [152, 18 + 18 * Math.max(0, wav(t, 0.5))]; p.mouth = "smile"; p.look = [2, -2]; p.extra = ["remind"]; break;
      case "hold-sign":
        p.L = ik(SHOULDER_L, 58, 152, -1); p.Rt = ik(SHOULDER_R, 182, 152, 1); p.dy = 1.5 * wav(t, 1.8);
        p.mouth = "grin"; p.extra = ["sign"]; break;
      case "phone": {
        const show = ph > 0.5;
        p.Rt = ik(SHOULDER_R, show ? 166 : 146, show ? 150 : 140, 1); p.extra = ["phone"];
        p.look = show ? [0, 0] : [3, 3]; p.mouth = show ? "grin" : "small"; p.eyes = "open"; break;
      }
      case "send": {
        if (ph < 0.3) p.Rt = [lerp(70, 40, ph / 0.3), lerp(-60, -100, ph / 0.3)];
        else if (ph < 0.45) p.Rt = [lerp(40, 115, (ph - 0.3) / 0.15), lerp(-100, -10, (ph - 0.3) / 0.15)];
        else p.Rt = [115, -10];
        p.plane = ph < 0.42 ? "hand" : (ph - 0.42) / 0.58; p.look = ph < 0.45 ? [2, 1] : [3.5, -2.5]; p.mouth = ph < 0.45 ? "small" : "grin"; break;
      }
      case "jump": {
        const h = Math.sin(Math.PI * ph);
        p.dy = -26 * h; p.L = [-150 - 10 * h, -20]; p.Rt = [150 + 10 * h, 20]; p.legL = -26 * h; p.legR = 26 * h;
        if (ph < 0.08 || ph > 0.92) { p.sy = 0.92; p.sx = 1.04; }
        p.eyes = "happy"; p.mouth = "open"; break;
      }
      case "run-right": case "run-left": {
        const w = wav(t, 0.4), dir = action === "run-right" ? 1 : -1;
        p.legL = 34 * w; p.legR = -34 * w; p.L = [-15 - 30 * w, -50]; p.Rt = [15 - 30 * w, 50];
        p.dy = -4 * Math.abs(wav(t, 0.8)); p.tilt = 8 * dir; p.skew = -4 * dir; p.look = [3.5 * dir, 0]; p.mouth = "open";
        p.extra = [dir > 0 ? "speed-right" : "speed-left"]; break;
      }
      case "sit":
        p.dy = 20; p.legL = -78; p.legR = 78; p.L = [-34, -20]; p.Rt = [34, 20]; p.skew = 1 * wav(t, 2.8);
        p.eyes = (t % 5.6) > 4.6 ? "happy" : "open"; p.mouth = "smile"; break;
      case "point-down":
        p.Rt = [30, -6 + 3 * wav(t, 1.2)]; p.look = [2.4, 3.5]; p.tilt = 3; break;
      case "loading": {
        p.L = ik(SHOULDER_L, 136, 150, 1); p.Rt = ik(SHOULDER_R, 104, 150, -1);
        p.legR = 12 * Math.max(0, wav(t, 0.6)); p.look = [-2, -2.5]; p.mouth = "small"; p.extra = ["typing"]; break;
      }
    }
    return p;
  }

  function arm(sx, sy, a1, a2, L1, L2) {
    const ex = sx + L1 * Math.sin(a1 * R), ey = sy + L1 * Math.cos(a1 * R);
    const hx = ex + L2 * Math.sin((a1 + a2) * R), hy = ey + L2 * Math.cos((a1 + a2) * R);
    return { d: `M${f(sx)},${f(sy)} L${f(ex)},${f(ey)} L${f(hx)},${f(hy)}`, hx, hy };
  }

  function eyes(type, look, blink) {
    let s = "";
    const shut = blink && type !== "happy" && type !== "sleep";
    [[106, 100], [134, 100]].forEach(([x, y], i) => {
      const side = i === 0 ? -1 : 1;
      if (type === "happy" || (type === "wink" && side === 1)) s += `<path d="M${x - 7},${y + 3} Q${x},${y - 8} ${x + 7},${y + 3}" stroke="${C.navy}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      else if (type === "wide") s += `<ellipse cx="${x}" cy="${y}" rx="6.8" ry="9.6" fill="${C.navy}"/><circle cx="${x + 2}" cy="${y - 3.4}" r="2.4" fill="#ffffff"/><path d="M${x - 7},${y - 17} Q${x},${y - 22} ${x + 7},${y - 17}" stroke="${C.navy}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
      else if (type === "sleep" || shut) s += `<path d="M${x - 7},${y} Q${x},${y + 6} ${x + 7},${y}" stroke="${C.navy}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
      else s += `<ellipse cx="${f(x + look[0] * .7)}" cy="${f(y + look[1] * .7)}" rx="5.8" ry="7.8" fill="${C.navy}"/><circle cx="${f(x + look[0] * .7 + 1.8)}" cy="${f(y + look[1] * .7 - 2.8)}" r="2" fill="#ffffff"/>`;
      if (type === "worried") s += `<path d="M${x + side * 8},${y - 11} L${x - side * 5},${y - 16}" stroke="${C.navy}" stroke-width="3.5" stroke-linecap="round"/>`;
      if (type === "think") s += side === 1
        ? `<path d="M${x - 7},${y - 15} Q${x},${y - 21} ${x + 7},${y - 16}" stroke="${C.navy}" stroke-width="3.5" fill="none" stroke-linecap="round"/>`
        : `<path d="M${x - 6},${y - 12} L${x + 6},${y - 13}" stroke="${C.navy}" stroke-width="3.5" stroke-linecap="round"/>`;
    });
    return s;
  }

  function mouth(type, t) {
    if (type === "talk") type = ["open", "small", "grin"][Math.floor(t / 0.16) % 3];
    const x = 120, y = 116;
    switch (type) {
      case "grin": return `<path d="M${x - 9},${y - 1} Q${x},${y + 11} ${x + 9},${y - 1} Z" fill="${C.navy}"/>`;
      case "open": return `<ellipse cx="${x}" cy="${y + 3}" rx="5.5" ry="6.5" fill="${C.navy}"/>`;
      case "wavy": return `<path d="M${x - 9},${y + 3} q2.25,-4 4.5,0 t4.5,0 t4.5,0 t4.5,0" stroke="${C.navy}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
      case "small": return `<path d="M${x - 4},${y + 1} Q${x},${y + 3.5} ${x + 4},${y + 1}" stroke="${C.navy}" stroke-width="3.4" fill="none" stroke-linecap="round"/>`;
      default: return `<path d="M${x - 7},${y} Q${x},${y + 7} ${x + 7},${y}" stroke="${C.navy}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`;
    }
  }

  function tick(x, y, s, col, w) {
    return `<path d="M${f(x - 7 * s)},${f(y)} l${f(5 * s)},${f(6 * s)} l${f(11 * s)},${f(-13 * s)}" stroke="${col}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  }

  function slipBody(p, id) {
    const zig = "M78,62 " + Array.from({ length: 11 }, (_, i) => `L${82 + 8 * i},${i % 2 === 0 ? 55 : 62}`).join(" ") + " L162,62";
    const body = `${zig} L162,190 L148,204 L78,204 Z`;
    let rows = "";
    [136, 154, 172].forEach((y, i) => {
      const done = p.rows[i], next = !done && p.rows.indexOf(0) === i;
      if (next) rows += `<rect x="84" y="${y - 8}" width="72" height="16" rx="5" fill="${C.tealL}" stroke="${C.teal}" stroke-width="1.4"/>`;
      rows += `<rect x="89" y="${y - 5}" width="10" height="10" rx="2" fill="#ffffff" stroke="${C.navy}" stroke-width="2"/>`;
      if (done) rows += tick(95, y, .55, C.tealD, 2.8);
      const w = i === 2 && p.write != null ? Math.max(1, 44 * p.write) : [40, 32, 44][i];
      rows += `<rect x="105" y="${y - 2}" width="${f(w)}" height="4" rx="2" fill="${done ? C.line : C.navy}" opacity="${done ? 1 : .55}"/>`;
    });
    const stamp = p.stamp
      ? `<g transform="rotate(-12 146 192)"><circle cx="146" cy="192" r="13" fill="none" stroke="${C.tealD}" stroke-width="2.6"/><circle cx="146" cy="192" r="9" fill="none" stroke="${C.tealD}" stroke-width="1" opacity=".6"/>${tick(147, 192, .55, C.tealD, 3)}</g>`
      : "";
    return `<defs><clipPath id="${id}-s"><path d="${body}"/></clipPath></defs>` +
      `<path d="${body}" fill="${C.navy}" opacity=".10" transform="translate(4 4)"/>` +
      `<path d="${body}" fill="${C.paper}" stroke="${C.edge}" stroke-width="1.5" stroke-linejoin="round"/>` +
      `<g clip-path="url(#${id}-s)"><rect x="78" y="62" width="84" height="16" fill="${C.teal}"/>` +
      `${tick(91, 70, .5, "#ffffff", 2.6)}<rect x="104" y="68" width="30" height="4" rx="2" fill="#ffffff" opacity=".8"/><rect x="138" y="68" width="16" height="4" rx="2" fill="#ffffff" opacity=".5"/></g>` +
      `<path d="M162,190 L148,204 L148,190 Z" fill="${C.fold}" stroke="${C.edge}" stroke-width="1"/>` +
      rows + stamp;
  }

  function props(p, t) {
    let s = "";
    if (p.props.includes("dots")) [[182, 56, 4], [194, 40, 5.5], [208, 22, 7]].forEach(([x, y, r], i) => {
      const o = .35 + .65 * Math.max(0, Math.sin(t * 2.6 - i * .9));
      s += `<circle cx="${x}" cy="${y}" r="${r}" fill="${C.tealD}" opacity="${f(o)}"/>`;
    });
    if (p.props.includes("zzz")) [[176, 60, 13], [190, 42, 17], [206, 22, 21]].forEach(([x, y, sz], i) => {
      const k = ((t / 3 + i / 3) % 1);
      s += `<text x="${x}" y="${f(y - k * 8)}" font-family="Geist, Arial, sans-serif" font-weight="600" font-size="${sz}" fill="${C.tealD}" opacity="${f(1 - k * .6)}">z</text>`;
    });
    if (p.props.includes("confetti")) [[40, 70, C.teal], [198, 62, C.gold], [58, 32, "#F08A6C"], [184, 28, "#2c5f8f"], [28, 124, C.gold], [212, 116, C.teal]].forEach(([x, y, c], i) => {
      const o = .4 + .6 * Math.abs(Math.sin(t * 3 + i));
      s += i % 2 ? `<rect x="${x}" y="${y}" width="7" height="7" rx="1.5" fill="${c}" opacity="${f(o)}" transform="rotate(${20 + i * 25} ${x + 3} ${y + 3})"/>`
                 : `<circle cx="${x}" cy="${y}" r="4" fill="${c}" opacity="${f(o)}"/>`;
    });
    return s;
  }

  function svg(action, t, opts) {
    opts = opts || {};
    const id = opts.id || "p";
    const p = pose(action, t || 0);
    let look = p.look;
    if (action === "idle" && opts.look) look = opts.look;
    // limbs
    const lim = (a, big) => `<path d="${a.d}" stroke="${C.navy}" stroke-width="5.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="${f(a.hx)}" cy="${f(a.hy)}" r="${big ? 9 : 5.8}" fill="${C.navy}"/>`;
    let armL, armR;
    if (p.cover) {
      const aim = (sx, sy, tx, ty) => Math.atan2(tx - sx, ty - sy) / R;
      armL = arm(80, 132, aim(80, 132, 106, 100), 0, 20, 21);
      armR = p.coverPeek ? arm(160, 132, aim(160, 132, 136, 112), 0, 20, 21) : arm(160, 132, aim(160, 132, 134, 100), 0, 20, 21);
    } else {
      armL = arm(80, 132, p.L[0], p.L[1], 22, 20);
      armR = arm(160, 132, p.Rt[0], p.Rt[1], 22, 20);
    }
    const leg = (hx, a) => {
      const L = p.sit ? 26 : 24;
      const fx = hx + L * Math.sin(a * R), fy = 204 + L * Math.cos(a * R);
      return `<path d="M${hx},204 L${f(fx)},${f(fy)}" stroke="${C.navy}" stroke-width="5.5" stroke-linecap="round"/>` +
        `<ellipse cx="${f(fx + (hx < 120 ? -5 : 5))}" cy="${f(fy + 2)}" rx="10" ry="5" fill="${C.navy}" transform="rotate(${f(-a * .4)} ${f(fx)} ${f(fy)})"/>`;
    };
    let held = "";
    if (p.pen) held = `<g transform="translate(${f(armR.hx)} ${f(armR.hy)}) rotate(-35)"><rect x="-3" y="-26" width="6" height="30" rx="2" fill="${C.teal}"/><path d="M-3,4 L0,11 L3,4 Z" fill="${C.navy}"/><rect x="-3" y="-26" width="6" height="6" rx="2" fill="${C.tealD}"/></g>`;
    if (p.slip) held = `<g transform="translate(${f(armR.hx + 14)} ${f(armR.hy - 6)}) rotate(8)"><rect x="-13" y="-16" width="26" height="32" rx="3" fill="${C.paper}" stroke="${C.edge}" stroke-width="1.4"/><rect x="-13" y="-16" width="26" height="7" fill="${C.teal}"/>${tick(1, 4, .6, C.tealD, 3)}</g>`;
    const ex = p.extra || [];
    const H = armR, HL = armL;
    let front = "", back = "", over = "";
    if (ex.includes("palms")) front += `<ellipse cx="120" cy="${f((H.hy + HL.hy) / 2 - 4)}" rx="6" ry="11" fill="${C.navy}"/>`;
    if (ex.includes("thumb")) front += `<g transform="translate(${f(H.hx)} ${f(H.hy)})"><rect x="-7" y="-6" width="14" height="13" rx="5" fill="${C.navy}"/><rect x="-3" y="-17" width="6" height="14" rx="3" fill="${C.navy}"/></g>`;
    if (ex.includes("sparkle")) over += `<path d="M${f(H.hx + 18)},${f(H.hy - 26)} l3,7 l7,3 l-7,3 l-3,7 l-3,-7 l-7,-3 l7,-3 z" fill="${C.gold}"/>`;
    if (ex.includes("burst-clap")) over += `<path d="M120,128 v-10 M108,132 l-6,-7 M132,132 l6,-7" stroke="${C.gold}" stroke-width="3" stroke-linecap="round"/>`;
    if (ex.includes("exclaim")) over += `<g transform="translate(186 40)"><circle r="14" fill="${C.gold}"/><rect x="-2.5" y="-8" width="5" height="10" rx="2.5" fill="${C.navy}"/><circle cy="6" r="2.6" fill="${C.navy}"/></g>`;
    if (ex.includes("sweat")) over += `<path d="M176,62 C171,72 170,78 176,80 C182,78 181,72 176,62 Z" fill="#7FD6D1" stroke="${C.tealD}" stroke-width="1.5"/>`;
    if (ex.includes("heart")) {
      const k = p.heartK || 1;
      front += `<g transform="translate(120 152) scale(${f(k)})"><path d="M0,16 C-22,2 -20,-16 -9,-16 C-3,-16 0,-11 0,-8 C0,-11 3,-16 9,-16 C20,-16 22,2 0,16 Z" fill="#F2766B" stroke="#D2564C" stroke-width="2"/></g>`;
    }
    if (ex.includes("stamp-tool")) front += `<g transform="translate(${f(H.hx)} ${f(H.hy)})"><rect x="-4" y="-22" width="8" height="18" rx="4" fill="${C.teal}"/><circle cy="-24" r="6" fill="${C.tealD}"/><rect x="-11" y="-5" width="22" height="9" rx="2.5" fill="${C.navy}"/></g>`;
    if (ex.includes("burst-stamp")) over += `<path d="M168,184 l10,-4 M168,196 l11,3 M160,206 l5,8" stroke="${C.gold}" stroke-width="3" stroke-linecap="round"/>`;
    if (ex.includes("magnifier")) {
      const lx = H.hx - 10, ly = H.hy - 20;
      front += `<path d="M${f(H.hx)},${f(H.hy)} L${f(lx + 6)},${f(ly + 9)}" stroke="${C.navy}" stroke-width="6" stroke-linecap="round"/><circle cx="${f(lx)}" cy="${f(ly)}" r="14" fill="#ffffff" fill-opacity=".35" stroke="${C.navy}" stroke-width="4"/><path d="M${f(lx - 7)},${f(ly - 4)} q4,-6 10,-6" stroke="#ffffff" stroke-width="2.5" fill="none" stroke-linecap="round"/>`;
    }
    if (ex.includes("remind")) over += `<g transform="translate(${f(H.hx + 18)} ${f(H.hy - 22)})"><path d="M-13,-12 h26 a5,5 0 0 1 5,5 v14 a5,5 0 0 1 -5,5 h-14 l-7,7 v-7 h-5 a5,5 0 0 1 -5,-5 v-14 a5,5 0 0 1 5,-5 z" fill="${C.teal}"/><rect x="-2" y="-8" width="4" height="9" rx="2" fill="#ffffff"/><circle cy="5" r="2.3" fill="#ffffff"/></g>` +
      `<path d="M${f(H.hx - 10)},${f(H.hy - 6)} a10,10 0 0 1 0,-14 M${f(H.hx - 15)},${f(H.hy - 2)} a16,16 0 0 1 0,-22" stroke="${C.tealD}" stroke-width="2" fill="none" stroke-linecap="round" opacity=".7"/>`;
    if (ex.includes("sign")) back += `<rect x="50" y="124" width="140" height="62" rx="8" fill="#ffffff" stroke="${C.edge}" stroke-width="2"/><rect x="50" y="124" width="140" height="10" rx="5" fill="${C.teal}"/><rect x="66" y="148" width="92" height="6" rx="3" fill="${C.line}"/><rect x="66" y="162" width="66" height="6" rx="3" fill="${C.line}"/>`;
    if (ex.includes("phone")) front += `<g transform="translate(${f(H.hx)} ${f(H.hy - 14)}) rotate(-8)"><rect x="-13" y="-22" width="26" height="44" rx="6" fill="${C.navy}"/><rect x="-10" y="-17" width="20" height="33" rx="3" fill="#ffffff"/><rect x="-8" y="-13" width="12" height="6" rx="3" fill="${C.tealL}"/><rect x="-4" y="-4" width="12" height="6" rx="3" fill="${C.teal}"/><rect x="-8" y="5" width="10" height="6" rx="3" fill="${C.tealL}"/><circle cx="11" cy="-20" r="4" fill="#F2766B"/></g>`;
    if (p.plane != null) {
      const plane = (x, y, r, o) => `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(r)})" opacity="${f(o)}"><path d="M-14,0 L14,-6 L-4,8 Z" fill="#ffffff" stroke="${C.edge}" stroke-width="1.2"/><path d="M-14,0 L14,-6 L-2,1 Z" fill="${C.tealL}" stroke="${C.edge}" stroke-width="1.2"/></g>`;
      if (p.plane === "hand") front += plane(H.hx + 8, H.hy - 4, -10, 1);
      else { const k = p.plane; over += plane(lerp(H.hx + 10, 236, k), lerp(H.hy - 6, 30, k) - 20 * Math.sin(Math.PI * k), -18, 1 - k * .6) + `<path d="M${f(lerp(H.hx + 10, 236, k) - 30)},${f(lerp(H.hy - 6, 30, k) - 20 * Math.sin(Math.PI * k) + 10)} h-16" stroke="${C.line}" stroke-width="2" stroke-linecap="round" opacity="${f(1 - k)}"/>`; }
    }
    if (ex.includes("speed-right")) over += `<path d="M34,110 h22 M26,132 h28 M36,154 h20" stroke="${C.line}" stroke-width="3" stroke-linecap="round"/>`;
    if (ex.includes("speed-left")) over += `<path d="M206,110 h-22 M214,132 h-28 M204,154 h-20" stroke="${C.line}" stroke-width="3" stroke-linecap="round"/>`;
    if (ex.includes("typing")) [0, 1, 2].forEach(i => {
      const o = .3 + .7 * Math.max(0, Math.sin(2 * Math.PI * ((t || 0) / 1.2) - i * 0.9));
      over += `<circle cx="${108 + 12 * i}" cy="34" r="4.5" fill="${C.tealD}" opacity="${f(o)}"/>`;
    });
    const ledge = p.ledge ? `<rect x="14" y="180" width="212" height="14" rx="7" fill="${C.navy}"/><rect x="14" y="180" width="212" height="4" rx="2" fill="#ffffff" opacity=".14"/>` : "";
    const baseY = p.sit ? -10 : 0;
    const body = slipBody(p, id) + eyes(p.eyes, look, !!opts.blink) +
      `<circle cx="94" cy="112" r="5.5" fill="${C.blush}" opacity=".75"/><circle cx="146" cy="112" r="5.5" fill="${C.blush}" opacity=".75"/>` +
      mouth(p.mouth, t || 0);
    const inner =
      ledge +
      `<ellipse cx="120" cy="${p.sit ? 212 : 246}" rx="${f(48 + p.dy * .5)}" ry="6.5" fill="${C.navy}" opacity="${p.sit ? 0 : .12}"/>` +
      `<g transform="translate(${f(p.dx)} ${f(p.dy + baseY)}) rotate(${f(p.tilt)} 120 226)">` +
        leg(104, p.legL) + leg(136, p.legR) +
        `<g transform="translate(120 204) scale(${f(p.sx)} ${f(p.sy)}) skewX(${f(p.skew)}) translate(-120 -204)">${body}</g>` +
        back + lim(armL, p.cover) + lim(armR, p.cover) + held + front + over +
      `</g>` + props(p, t || 0);
    const content = p.flip ? `<g transform="translate(240 0) scale(-1 1)">${inner}</g>` : inner;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${opts.viewBox || "0 0 240 260"}" role="img" aria-label="Parchi, ${action}">${content}</svg>`;
  }

  const api = { svg, ACTIONS, COLORS: C };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ParchiRig = api;
})(typeof window !== "undefined" ? window : globalThis);
