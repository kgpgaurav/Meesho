import { rgbToHsl } from './color.js';
import { nearestShades, matchQuality } from './catalogue.js';

const registry = new Map();

export function registerFormat(key, definition) {
  if (!definition || typeof definition.render !== 'function') {
    throw new Error('Format "' + key + '" needs a render function');
  }
  registry.set(key, {
    key,
    label: definition.label || key,
    order: typeof definition.order === 'number' ? definition.order : 100,
    primary: definition.primary === true,
    render: definition.render
  });
}

export function unregisterFormat(key) {
  registry.delete(key);
}

export function formatKeys() {
  return [...registry.keys()];
}

export function runFormats(reading) {
  return [...registry.values()]
    .sort((a, b) => a.order - b.order)
    .map(f => {
      let value, detail = null;
      try {
        const out = f.render(reading);
        if (out && typeof out === 'object' && 'value' in out) {
          value = out.value;
          detail = out.detail || null;
        } else {
          value = out;
        }
      } catch (err) {
        value = 'unavailable';
      }
      return { key: f.key, label: f.label, primary: f.primary, value, detail };
    })
    .filter(r => r.value !== null && r.value !== undefined);
}

registerFormat('hex', {
  label: 'Hex',
  order: 10,
  primary: true,
  render: reading => reading.hex
});

registerFormat('rgb', {
  label: 'RGB',
  order: 20,
  render: reading => {
    const { r, g, b } = reading.rgb;
    return r + ', ' + g + ', ' + b;
  }
});

registerFormat('hsl', {
  label: 'HSL',
  order: 30,
  render: reading => {
    const { r, g, b } = reading.rgb;
    const { h, s, l } = rgbToHsl(r, g, b);
    return h + '°, ' + s + '%, ' + l + '%';
  }
});

registerFormat('lab', {
  label: 'CIE Lab',
  order: 40,
  render: reading => {
    const { L, a, b } = reading.lab;
    return L.toFixed(1) + ', ' + a.toFixed(1) + ', ' + b.toFixed(1);
  }
});

registerFormat('catalogue', {
  label: 'Nearest shade',
  order: 50,
  render: reading => {
    const hits = nearestShades(reading.lab, 1);
    if (!hits.length) return null;
    const { shade, distance } = hits[0];
    return {
      value: shade.shade + ' · ' + shade.id,
      detail: shade.finish + ', ' + shade.coverage.toLowerCase() + ' coverage · ' +
        matchQuality(distance).label + ' (ΔE ' + distance.toFixed(1) + ')'
    };
  }
});
