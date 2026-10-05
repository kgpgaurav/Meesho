import { extractShade } from './color.js';

const SWEEP_MS = 850;

export class Scanner {
  constructor(options) {
    this.video = options.video;
    this.frame = options.frame;
    this.plate = options.plate;
    this.stage = options.stage;
    this.readout = options.readout;
    this.onMode = options.onMode || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.frameCtx = this.frame.getContext('2d', { willReadFrequently: true });
    this.stream = null;
    this.facing = 'environment';
    this.mode = 'idle';
    this.mirrored = false;
    this.busy = false;
  }

  setMode(mode) {
    this.mode = mode;
    this.stage.dataset.mode = mode;
    this.onMode(mode);
  }

  async start(facing = this.facing) {
    this.release();
    this.facing = facing;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.onStatus('nocamera', 'This browser cannot open a camera. Load a photo instead.');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.mirrored = facing === 'user';
      this.stage.classList.toggle('mirrored', this.mirrored);
      this.setMode('live');
      this.readout.textContent = 'Ready';
      this.onStatus('live', 'Aim at the product and tap Capture.');
      return true;
    } catch (err) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      this.onStatus(
        denied ? 'denied' : 'nocamera',
        denied
          ? 'Camera permission was refused. Allow it from the address bar, or load a photo.'
          : 'No camera available here. Load a photo instead.'
      );
      return false;
    }
  }

  release() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  stop() {
    this.release();
    this.setMode('idle');
    this.readout.textContent = 'Camera off';
  }

  async flip() {
    return this.start(this.facing === 'environment' ? 'user' : 'environment');
  }

  resume() {
    if (this.stream && this.video.readyState >= 2) {
      this.stage.classList.toggle('mirrored', this.mirrored);
      this.setMode('live');
      this.readout.textContent = 'Ready';
      this.onStatus('live', 'Aim at the product and tap Capture.');
      return true;
    }
    return this.start();
  }

  holdFrame(source, width, height) {
    this.frame.width = width;
    this.frame.height = height;
    this.frameCtx.setTransform(1, 0, 0, 1, 0, 0);
    if (this.mirrored && source === this.video) {
      this.frameCtx.translate(width, 0);
      this.frameCtx.scale(-1, 1);
    }
    this.frameCtx.drawImage(source, 0, 0, width, height);
    this.frameCtx.setTransform(1, 0, 0, 1, 0, 0);
    this.plate.style.setProperty('--ar', width + ' / ' + height);
    this.setMode('review');
    this.readout.textContent = 'Tap a point';
    this.onStatus('review', 'Tap anywhere on the photo to read that point. Tap again for another.');
  }

  async capture() {
    if (this.busy || this.mode !== 'live') return false;
    const w = this.video.videoWidth, h = this.video.videoHeight;
    if (!w || !h) return false;
    this.busy = true;
    this.stage.classList.add('scanning');
    this.readout.textContent = 'Capturing';
    this.readout.classList.add('working');
    this.stage.style.setProperty('--sweep-ms', SWEEP_MS + 'ms');
    await new Promise(r => setTimeout(r, SWEEP_MS));
    this.stage.classList.remove('scanning');
    this.readout.classList.remove('working');
    this.holdFrame(this.video, w, h);
    this.busy = false;
    return true;
  }

  useImage(img) {
    const max = 1800;
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    this.mirrored = false;
    this.stage.classList.remove('mirrored');
    this.holdFrame(img, Math.round(img.naturalWidth * scale), Math.round(img.naturalHeight * scale));
  }

  sampleRadius() {
    return Math.max(9, Math.round(Math.min(this.frame.width, this.frame.height) * 0.022));
  }

  sampleAt(rx, ry) {
    if (this.mode !== 'review') return null;
    if (rx < 0 || rx > 1 || ry < 0 || ry > 1) return null;
    const radius = this.sampleRadius();
    const size = radius * 2;
    const patch = document.createElement('canvas');
    patch.width = size;
    patch.height = size;
    const ctx = patch.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(radius, radius, radius, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(
      this.frame,
      rx * this.frame.width - radius,
      ry * this.frame.height - radius,
      size, size,
      0, 0, size, size
    );
    ctx.restore();
    const data = ctx.getImageData(0, 0, size, size);
    const reading = extractShade(data.data, size, size);
    if (!reading) return null;
    return { reading, patch, x: rx, y: ry };
  }
}
