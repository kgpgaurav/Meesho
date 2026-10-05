import { Scanner } from './scanner.js';
import { TryOn } from './tryon.js';
import { runFormats } from './formats.js';
import { loadCatalogue, lipShades, eyeShades, nearestShades, matchQuality } from './catalogue.js';
import { deltaE } from './color.js';

const el = id => document.getElementById(id);

const samples = [];
let activeIndex = -1;

const scanner = new Scanner({
  video: el('scanVideo'),
  frame: el('frameCanvas'),
  plate: el('plate'),
  stage: el('scanStage'),
  readout: el('readoutText'),
  onMode: syncToolbar,
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

function setStatus(node, kind, message) {
  node.textContent = message;
  node.classList.toggle('bad', kind === 'denied' || kind === 'failed' || kind === 'nocamera');
}

function syncToolbar(mode) {
  el('captureBtn').hidden = mode === 'review';
  el('retakeBtn').hidden = mode !== 'review';
  el('captureBtn').disabled = mode === 'idle';
  el('flipBtn').disabled = mode === 'idle';
}

function clearSamples() {
  samples.length = 0;
  activeIndex = -1;
  el('markers').innerHTML = '';
  el('sampleStrip').innerHTML = '';
  el('samples').hidden = true;
  el('result').hidden = true;
  el('compare').hidden = true;
  el('readoutSwatch').style.background = '';
}

function addSample(sample) {
  samples.push(sample);
  activeIndex = samples.length - 1;
  render();
}

function removeSample(index) {
  samples.splice(index, 1);
  if (!samples.length) {
    clearSamples();
    el('readoutText').textContent = scanner.mode === 'review' ? 'Tap a point' : 'Camera off';
    return;
  }
  activeIndex = Math.min(activeIndex, samples.length - 1);
  render();
}

function selectSample(index) {
  activeIndex = index;
  render();
}

function render() {
  renderMarkers();
  renderStrip();
  renderCompare();
  showReading(samples[activeIndex]);
}

function renderMarkers() {
  const holder = el('markers');
  holder.innerHTML = '';
  samples.forEach((s, i) => {
    const pin = document.createElement('button');
    pin.className = 'pin';
    pin.style.left = (s.x * 100).toFixed(3) + '%';
    pin.style.top = (s.y * 100).toFixed(3) + '%';
    pin.style.setProperty('--c', s.reading.hex);
    pin.setAttribute('aria-pressed', String(i === activeIndex));
    pin.setAttribute('aria-label', 'Point ' + (i + 1) + ', ' + s.reading.hex);
    pin.innerHTML = '<b>' + (i + 1) + '</b>';
    pin.addEventListener('click', ev => {
      ev.stopPropagation();
      selectSample(i);
    });
    holder.appendChild(pin);
  });
}

function renderStrip() {
  const strip = el('sampleStrip');
  strip.innerHTML = '';
  samples.forEach((s, i) => {
    const card = document.createElement('button');
    card.className = 'swatchcard';
    card.setAttribute('aria-pressed', String(i === activeIndex));
    card.innerHTML =
      '<span class="sw" style="background:' + s.reading.hex + '"></span>' +
      '<b>' + s.reading.hex + '</b>' +
      '<em>Point ' + (i + 1) + '</em>';
    card.addEventListener('click', () => selectSample(i));
    const kill = document.createElement('span');
    kill.className = 'kill';
    kill.textContent = '×';
    kill.setAttribute('role', 'button');
    kill.setAttribute('aria-label', 'Remove point ' + (i + 1));
    kill.addEventListener('click', ev => {
      ev.stopPropagation();
      removeSample(i);
    });
    card.appendChild(kill);
    strip.appendChild(card);
  });
  el('samples').hidden = samples.length === 0;
}

function renderCompare() {
  const node = el('compare');
  if (samples.length < 2 || activeIndex < 0) {
    node.hidden = true;
    return;
  }
  const active = samples[activeIndex];
  const others = samples
    .map((s, i) => ({ i, d: deltaE(active.reading.lab, s.reading.lab) }))
    .filter(x => x.i !== activeIndex)
    .sort((a, b) => a.d - b.d);
  const closest = others[0];
  const furthest = others[others.length - 1];
  const verdict = d => d < 2 ? 'the same colour' : d < 6 ? 'a close match' : d < 14 ? 'visibly different' : 'clearly different';
  let text = 'Point ' + (activeIndex + 1) + ' against point ' + (closest.i + 1) +
    ': ΔE ' + closest.d.toFixed(1) + ', <b>' + verdict(closest.d) + '</b>.';
  if (others.length > 1) {
    text += ' Widest gap is point ' + (furthest.i + 1) + ' at ΔE ' + furthest.d.toFixed(1) + '.';
  }
  node.innerHTML = text;
  node.hidden = false;
}

function drawLoupe(sample) {
  const canvas = el('loupe');
  const ctx = canvas.getContext('2d');
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sample.patch, 0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.strokeStyle = 'rgba(255,255,255,.9)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(size / 2, size * 0.34);
  ctx.lineTo(size / 2, size * 0.66);
  ctx.moveTo(size * 0.34, size / 2);
  ctx.lineTo(size * 0.66, size / 2);
  ctx.stroke();
}

function showReading(sample) {
  if (!sample) return;
  const reading = sample.reading;
  el('result').hidden = false;
  el('bigHex').textContent = reading.hex;
  el('readoutSwatch').style.background = reading.hex;
  el('readoutText').textContent = reading.hex;
  drawLoupe(sample);

  const conf = el('confidence');
  conf.className = 'confidence ' + reading.confidence;
  conf.textContent = {
    high: 'Even colour across the point',
    medium: 'Some variation here — try a flatter area',
    low: 'Mixed colours here — move off the edge or highlight'
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
  matches.innerHTML = '<h4>Closest shades in the catalogue</h4>';
  nearestShades(reading.lab, 3).forEach(({ shade, distance }) => {
    const q = matchQuality(distance);
    const btn = document.createElement('button');
    btn.className = 'match';
    btn.innerHTML =
      '<span class="sw" style="background:' + shade.hex + '"></span>' +
      '<span><b>' + shade.shade + ' · ' + shade.id + '</b>' +
      '<em>' + shade.finish + ', ' + shade.coverage.toLowerCase() + ' coverage · ' + shade.seller + '</em>' +
      '<span class="tag ' + q.key + '">' + q.label + ' (ΔE ' + distance.toFixed(1) + ')</span></span>' +
      '<span class="price">₹' + shade.price + '</span>';
    btn.addEventListener('click', () => {
      const region = shade.id.startsWith('ES-') ? 'eyes' : 'lips';
      applyColour(region, shade.hex, shade.finish);
      switchTab('tryon');
    });
    matches.appendChild(btn);
  });

  paintScannedSwatch(reading.hex);
}

function paintScannedSwatch(hex) {
  ['lipSwatches', 'eyeSwatches'].forEach(id => {
    const holder = el(id);
    let btn = holder.querySelector('.scanned');
    if (!btn) {
      btn = document.createElement('button');
      btn.className = 'scanned';
      btn.addEventListener('click', () => {
        applyColour(id === 'lipSwatches' ? 'lips' : 'eyes', btn.dataset.hex);
      });
      holder.prepend(btn);
    }
    btn.style.background = hex;
    btn.dataset.hex = hex;
    btn.title = 'Scanned ' + hex;
  });
}

function applyColour(region, hex, finish) {
  tryOn.set(region, finish ? { hex, finish } : { hex });
  const holder = el(region === 'lips' ? 'lipSwatches' : 'eyeSwatches');
  [...holder.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.hex === hex)));
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
  const tabs = el('tabs');
  tabs.dataset.active = name;
  [...tabs.querySelectorAll('[data-tab]')].forEach(b => {
    b.setAttribute('aria-current', b.dataset.tab === name ? 'page' : 'false');
  });
  el('panel-scan').hidden = name !== 'scan';
  el('panel-tryon').hidden = name !== 'tryon';
  if (name !== 'tryon') {
    tryOn.stop();
    el('tryHint').hidden = false;
    el('tryHint').textContent = 'Camera off';
    el('tryBtn').textContent = 'Start camera';
  } else {
    scanner.release();
    if (scanner.mode === 'live') scanner.stop();
  }
}

el('pickArea').addEventListener('click', e => {
  const box = e.currentTarget.getBoundingClientRect();
  if (!box.width || !box.height) return;
  const rx = (e.clientX - box.left) / box.width;
  const ry = (e.clientY - box.top) / box.height;
  const sample = scanner.sampleAt(rx, ry);
  if (!sample) {
    setStatus(el('scanStatus'), 'failed', 'Nothing readable at that point. Try a flatter area.');
    return;
  }
  addSample(sample);
  setStatus(el('scanStatus'), 'review', samples.length === 1
    ? 'Tap another point to compare two areas of the same photo.'
    : samples.length + ' points read. Select one to see its codes.');
});

el('tabs').addEventListener('click', e => {
  const btn = e.target.closest('[data-tab]');
  if (btn) switchTab(btn.dataset.tab);
});

el('cameraBtn').addEventListener('click', async () => {
  clearSamples();
  const ok = await scanner.start();
  el('cameraBtn').textContent = ok ? 'Restart' : 'Camera';
});

el('flipBtn').addEventListener('click', () => {
  clearSamples();
  scanner.flip();
});

el('captureBtn').addEventListener('click', () => {
  clearSamples();
  scanner.capture();
});

el('retakeBtn').addEventListener('click', () => {
  clearSamples();
  scanner.resume();
});

el('clearSamples').addEventListener('click', () => {
  clearSamples();
  if (scanner.mode === 'review') el('readoutText').textContent = 'Tap a point';
});

el('fileInput').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    clearSamples();
    scanner.release();
    scanner.useImage(img);
    URL.revokeObjectURL(url);
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    setStatus(el('scanStatus'), 'failed', 'That file could not be opened as an image.');
  };
  img.src = url;
  e.target.value = '';
});

el('copyHex').addEventListener('click', async () => {
  if (activeIndex < 0) return;
  const hex = samples[activeIndex].reading.hex;
  try {
    await navigator.clipboard.writeText(hex);
    el('copyHex').textContent = 'Copied';
    setTimeout(() => { el('copyHex').textContent = 'Copy'; }, 1400);
  } catch (err) {
    el('copyHex').textContent = hex;
  }
});

el('toTryOn').addEventListener('click', () => {
  if (activeIndex >= 0) applyColour('lips', samples[activeIndex].reading.hex);
  switchTab('tryon');
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
  el('tryBtn').textContent = 'Start camera';
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

syncToolbar('idle');
switchTab('scan');

loadCatalogue()
  .then(() => {
    buildSwatches('lipSwatches', lipShades(), 'lips');
    buildSwatches('eyeSwatches', eyeShades(), 'eyes');
  })
  .catch(() => {
    setStatus(el('scanStatus'), 'failed', 'Shade catalogue did not load. Serve the folder over HTTP, not from a file path.');
  });
