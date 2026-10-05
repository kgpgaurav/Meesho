import { Scanner } from './scanner.js';
import { TryOn } from './tryon.js';
import { runFormats } from './formats.js';
import { loadCatalogue, lipShades, eyeShades, nearestShades, matchQuality } from './catalogue.js';
import { rgbToHex, hexToRgb, rgbToLab } from './color.js';

const el = id => document.getElementById(id);

const scanStage = el('scanStage');
const scanner = new Scanner({
  video: el('scanVideo'),
  bar: el('sweep'),
  readout: el('readoutText'),
  stage: scanStage,
  reticle: el('reticle'),
  onResult: showResult,
  onStatus: (kind, message) => setStatus(el('scanStatus'), kind, message)
});

const tryOn = new TryOn({
  video: el('tryVideo'),
  canvas: el('tryCanvas'),
  stage: el('tryStage'),
  onStatus: (kind, message) => {
    setStatus(el('tryStatus'), kind, message);
    el('tryHint').textContent = kind === 'live' ? 'Tracking' : message;
    el('tryHint').hidden = kind === 'live';
  }
});

let lastReading = null;

function setStatus(node, kind, message) {
  node.textContent = message;
  node.classList.toggle('bad', kind === 'denied' || kind === 'failed' || kind === 'nocamera');
}

function showResult(reading) {
  lastReading = reading;
  el('result').hidden = false;
  el('bigSwatch').style.background = reading.hex;
  el('bigHex').textContent = reading.hex;
  el('readoutSwatch').style.background = reading.hex;

  const conf = el('confidence');
  conf.className = 'confidence ' + reading.confidence;
  conf.textContent = {
    high: 'High confidence reading',
    medium: 'Medium confidence — steady the frame for a cleaner read',
    low: 'Low confidence — move to even light and fill the frame'
  }[reading.confidence];

  const list = el('formats');
  list.innerHTML = '';
  runFormats(reading).forEach(f => {
    const row = document.createElement('div');
    row.className = 'row';
    const dt = document.createElement('dt');
    dt.textContent = f.label;
    const dd = document.createElement('dd');
    dd.textContent = f.value;
    if (f.detail) {
      const small = document.createElement('small');
      small.textContent = f.detail;
      dd.appendChild(small);
    }
    row.append(dt, dd);
    list.appendChild(row);
  });

  const matches = el('matches');
  matches.innerHTML = '<h3>Closest shades in the catalogue</h3>';
  nearestShades(reading.lab, 3).forEach(({ shade, distance }) => {
    const q = matchQuality(distance);
    const btn = document.createElement('button');
    btn.className = 'match';
    btn.innerHTML =
      '<span class="sw" style="background:' + shade.hex + '"></span>' +
      '<span><b>' + shade.shade + ' · ' + shade.id + '</b>' +
      '<span>' + shade.finish + ', ' + shade.coverage.toLowerCase() + ' coverage · ' + shade.seller + '</span>' +
      '<span class="tag ' + q.key + '">' + q.label + ' (ΔE ' + distance.toFixed(1) + ')</span></span>' +
      '<span class="price">₹' + shade.price + '</span>';
    btn.addEventListener('click', () => {
      const region = shade.id.startsWith('ES-') ? 'eyes' : 'lips';
      applyColour(region, shade.hex, shade.finish);
      switchTab('tryon');
    });
    matches.appendChild(btn);
  });

  paintScannedSwatch();
}

function paintScannedSwatch() {
  ['lipSwatches', 'eyeSwatches'].forEach(id => {
    const holder = el(id);
    const existing = holder.querySelector('.scanned');
    if (!lastReading) return;
    if (existing) {
      existing.style.background = lastReading.hex;
      existing.title = 'Scanned ' + lastReading.hex;
      return;
    }
    const btn = document.createElement('button');
    btn.className = 'scanned';
    btn.style.background = lastReading.hex;
    btn.title = 'Scanned ' + lastReading.hex;
    btn.addEventListener('click', () => {
      applyColour(id === 'lipSwatches' ? 'lips' : 'eyes', lastReading.hex);
    });
    holder.prepend(btn);
  });
}

function applyColour(region, hex, finish) {
  tryOn.set(region, finish ? { hex, finish } : { hex });
  const holder = el(region === 'lips' ? 'lipSwatches' : 'eyeSwatches');
  [...holder.children].forEach(b => {
    b.setAttribute('aria-pressed', String(b.dataset.hex === hex || (b.classList.contains('scanned') && lastReading && lastReading.hex === hex)));
  });
  if (finish) {
    const group = el(region === 'lips' ? 'lipFinish' : 'eyeFinish');
    [...group.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.finish === finish)));
  }
  const toggle = el(region === 'lips' ? 'lipsOn' : 'eyesOn');
  if (!toggle.checked) {
    toggle.checked = true;
    tryOn.set(region, { on: true });
  }
}

function buildSwatches(holderId, shades, region) {
  const holder = el(holderId);
  shades.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.style.background = s.hex;
    btn.dataset.hex = s.hex;
    btn.title = s.shade + ' · ' + s.id;
    btn.setAttribute('aria-pressed', String(i === 0));
    btn.addEventListener('click', () => applyColour(region, s.hex, s.finish));
    holder.appendChild(btn);
  });
  if (shades.length) tryOn.set(region, { hex: shades[0].hex });
}

function switchTab(name) {
  [...el('tabs').children].forEach(b => {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  el('panel-scan').hidden = name !== 'scan';
  el('panel-tryon').hidden = name !== 'tryon';
  if (name !== 'tryon') tryOn.stop();
}

el('tabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (btn) switchTab(btn.dataset.tab);
});

el('cameraBtn').addEventListener('click', async () => {
  el('scanStage').querySelector('.still').hidden = true;
  const ok = await scanner.start();
  el('cameraBtn').textContent = ok ? 'Restart camera' : 'Start camera';
});

el('flipBtn').addEventListener('click', () => scanner.flip());
el('scanBtn').addEventListener('click', () => scanner.scan());

el('fileInput').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => scanner.useImage(img);
  img.src = URL.createObjectURL(file);
});

el('tryBtn').addEventListener('click', async () => {
  el('tryBtn').disabled = true;
  el('tryBtn').textContent = 'Starting';
  const ok = await tryOn.start();
  el('tryBtn').disabled = false;
  el('tryBtn').textContent = ok ? 'Restart camera' : 'Start camera';
});

el('stopTryBtn').addEventListener('click', () => {
  tryOn.stop();
  el('tryHint').hidden = false;
  el('tryHint').textContent = 'Camera off';
});

el('toTryOn').addEventListener('click', () => {
  if (lastReading) applyColour('lips', lastReading.hex);
  switchTab('tryon');
});

el('lipsOn').addEventListener('change', e => tryOn.set('lips', { on: e.target.checked }));
el('eyesOn').addEventListener('change', e => tryOn.set('eyes', { on: e.target.checked }));
el('lipIntensity').addEventListener('input', e => tryOn.set('lips', { intensity: e.target.value / 100 }));
el('eyeIntensity').addEventListener('input', e => tryOn.set('eyes', { intensity: e.target.value / 100 }));

[['lipFinish', 'lips'], ['eyeFinish', 'eyes']].forEach(([id, region]) => {
  el(id).addEventListener('click', e => {
    const btn = e.target.closest('[data-finish]');
    if (!btn) return;
    [...el(id).children].forEach(b => b.setAttribute('aria-pressed', String(b === btn)));
    tryOn.set(region, { finish: btn.dataset.finish });
  });
});

loadCatalogue()
  .then(() => {
    buildSwatches('lipSwatches', lipShades(), 'lips');
    buildSwatches('eyeSwatches', eyeShades(), 'eyes');
  })
  .catch(() => {
    setStatus(el('scanStatus'), 'failed', 'Open this through a web server, not as a file. See the README.');
  });

export { rgbToHex, hexToRgb, rgbToLab };
