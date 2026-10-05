export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function rgbToHex(r, g, b) {
  const h = v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return ('#' + h(r) + h(g) + h(b)).toUpperCase();
}

export function hexToRgb(hex) {
  const s = hex.trim().replace(/^#/, '');
  const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16)
  };
}

function toLinear(v) {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function fromLinear(v) {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return clamp(Math.round(c * 255), 0, 255);
}

const WHITE = { x: 0.95047, y: 1, z: 1.08883 };

export function rgbToLab(r, g, b) {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / WHITE.x;
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / WHITE.y;
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / WHITE.z;
  const f = v => v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116;
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToRgb(L, a, bb) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const inv = v => {
    const c = v * v * v;
    return c > 0.008856 ? c : (v - 16 / 116) / 7.787;
  };
  const x = inv(fx) * WHITE.x, y = inv(fy) * WHITE.y, z = inv(fz) * WHITE.z;
  const R = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const G = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  const B = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  return { r: fromLinear(R), g: fromLinear(G), b: fromLinear(B) };
}

export function rgbToHsl(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === R) h = ((G - B) / d + (G < B ? 6 : 0));
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function deltaE(p, q) {
  return Math.sqrt((p.L - q.L) ** 2 + (p.a - q.a) ** 2 + (p.b - q.b) ** 2);
}

export function chroma(lab) {
  return Math.hypot(lab.a, lab.b);
}

function kmeans(points, k, iterations) {
  if (points.length <= k) {
    return points.map(p => ({ ...p, n: 1 }));
  }
  const sorted = points.slice().sort((p, q) => p.L - q.L);
  const centroids = [];
  for (let i = 0; i < k; i++) {
    centroids.push({ ...sorted[Math.floor((i + 0.5) / k * sorted.length)] });
  }
  let assign = new Array(points.length).fill(0);
  for (let it = 0; it < iterations; it++) {
    let moved = false;
    for (let i = 0; i < points.length; i++) {
      let best = 0, bestD = Infinity;
      for (let c = 0; c < centroids.length; c++) {
        const d = deltaE(points[i], centroids[c]);
        if (d < bestD) { bestD = d; best = c; }
      }
      if (assign[i] !== best) { assign[i] = best; moved = true; }
    }
    const sums = centroids.map(() => ({ L: 0, a: 0, b: 0, n: 0 }));
    for (let i = 0; i < points.length; i++) {
      const s = sums[assign[i]];
      s.L += points[i].L; s.a += points[i].a; s.b += points[i].b; s.n++;
    }
    for (let c = 0; c < centroids.length; c++) {
      if (sums[c].n) {
        centroids[c] = { L: sums[c].L / sums[c].n, a: sums[c].a / sums[c].n, b: sums[c].b / sums[c].n };
      }
    }
    if (!moved && it > 0) break;
  }
  const counts = centroids.map(() => 0);
  const spread = centroids.map(() => 0);
  for (let i = 0; i < points.length; i++) {
    counts[assign[i]]++;
    spread[assign[i]] += deltaE(points[i], centroids[assign[i]]);
  }
  return centroids.map((c, i) => ({
    ...c,
    n: counts[i],
    spread: counts[i] ? spread[i] / counts[i] : 0
  }));
}

export function extractShade(pixels, width, height) {
  const points = [];
  const step = Math.max(1, Math.round(Math.sqrt((width * height) / 4000)));
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3] < 200) continue;
      points.push(rgbToLab(pixels[i], pixels[i + 1], pixels[i + 2]));
    }
  }
  if (points.length < 40) return null;

  const levels = points.map(p => p.L).sort((p, q) => p - q);
  const lo = levels[Math.floor(levels.length * 0.12)];
  const hi = levels[Math.floor(levels.length * 0.88)];
  let kept = points.filter(p => p.L >= lo && p.L <= hi);
  if (kept.length < 40) kept = points;

  const clusters = kmeans(kept, 3, 14).filter(c => c.n);
  let separation = 0;
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      separation = Math.max(separation, deltaE(clusters[i], clusters[j]));
    }
  }
  if (separation < 9) {
    const mean = kept.reduce((acc, p) => ({
      L: acc.L + p.L / kept.length,
      a: acc.a + p.a / kept.length,
      b: acc.b + p.b / kept.length
    }), { L: 0, a: 0, b: 0 });
    const spread = kept.reduce((s, p) => s + deltaE(p, mean), 0) / kept.length;
    const flat = labToRgb(mean.L, mean.a, mean.b);
    return {
      lab: mean,
      rgb: flat,
      hex: rgbToHex(flat.r, flat.g, flat.b),
      spread,
      share: 1,
      confidence: spread < 6.5 ? 'high' : spread < 13 ? 'medium' : 'low'
    };
  }

  let best = null;
  for (const c of clusters) {
    if (!c.n) continue;
    const ch = chroma(c);
    if (c.L > 92 && ch < 8) continue;
    if (c.L < 6) continue;
    const share = c.n / kept.length;
    const score = (ch + 7) * Math.pow(share, 0.55);
    if (!best || score > best.score) best = { ...c, share, score, chromaValue: ch };
  }
  if (!best) return null;

  const rgb = labToRgb(best.L, best.a, best.b);
  const confidence = best.spread < 6.5 ? 'high' : best.spread < 13 ? 'medium' : 'low';
  return {
    lab: { L: best.L, a: best.a, b: best.b },
    rgb,
    hex: rgbToHex(rgb.r, rgb.g, rgb.b),
    spread: best.spread,
    share: best.share,
    confidence
  };
}

export function averageShades(results) {
  const valid = results.filter(Boolean);
  if (!valid.length) return null;
  const lab = valid.reduce((acc, r) => ({
    L: acc.L + r.lab.L / valid.length,
    a: acc.a + r.lab.a / valid.length,
    b: acc.b + r.lab.b / valid.length
  }), { L: 0, a: 0, b: 0 });
  const rgb = labToRgb(lab.L, lab.a, lab.b);
  const spread = valid.reduce((s, r) => s + r.spread, 0) / valid.length;
  const drift = valid.reduce((s, r) => s + deltaE(r.lab, lab), 0) / valid.length;
  const total = spread * 0.7 + drift * 1.3;
  return {
    lab,
    rgb,
    hex: rgbToHex(rgb.r, rgb.g, rgb.b),
    spread,
    drift,
    share: valid.reduce((s, r) => s + r.share, 0) / valid.length,
    confidence: total < 7 ? 'high' : total < 14 ? 'medium' : 'low'
  };
}
