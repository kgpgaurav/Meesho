import { hexToRgb, rgbToLab, deltaE } from './color.js';

let items = [];

export async function loadCatalogue(url = 'shades.json') {
  let raw = globalThis.SHADE_CATALOGUE;
  if (!raw) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not load ' + url);
    raw = await res.json();
  }
  items = raw.map(entry => {
    const rgb = hexToRgb(entry.hex);
    return { ...entry, rgb, lab: rgbToLab(rgb.r, rgb.g, rgb.b) };
  });
  return items;
}

export function allShades() {
  return items;
}

export function lipShades() {
  return items.filter(s => !s.id.startsWith('ES-'));
}

export function eyeShades() {
  return items.filter(s => s.id.startsWith('ES-'));
}

export function nearestShades(lab, count = 3, pool = items) {
  return pool
    .map(s => ({ shade: s, distance: deltaE(s.lab, lab) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
}

export function matchQuality(distance) {
  if (distance < 6) return { key: 'close', label: 'Close match' };
  if (distance < 14) return { key: 'near', label: 'Visible difference' };
  return { key: 'far', label: 'Clearly different' };
}
