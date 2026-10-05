import { extractShade, averageShades } from './color.js';

const SAMPLE_FRAMES = 9;
const SWEEP_MS = 1300;

export class Scanner {
  constructor(options) {
    this.video = options.video;
    this.bar = options.bar;
    this.readout = options.readout;
    this.stage = options.stage;
    this.reticle = options.reticle;
    this.onResult = options.onResult || (() => {});
    this.onStatus = options.onStatus || (() => {});
    this.stream = null;
    this.facing = 'environment';
    this.busy = false;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.stillImage = null;
  }

  async start(facing = this.facing) {
    this.stop();
    this.facing = facing;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.onStatus('nocamera', 'This browser cannot open a camera. Use a photo instead.');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false
      });
      this.stillImage = null;
      this.video.srcObject = this.stream;
      this.video.style.display = '';
      await this.video.play();
      this.stage.classList.toggle('mirrored', facing === 'user');
      this.onStatus('live', 'Hold the product inside the frame and tap Scan.');
      return true;
    } catch (err) {
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      this.onStatus(
        denied ? 'denied' : 'nocamera',
        denied
          ? 'Camera permission was refused. Allow it in the address bar, or scan a photo instead.'
          : 'No camera available here. Scan a photo instead.'
      );
      return false;
    }
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  async flip() {
    return this.start(this.facing === 'environment' ? 'user' : 'environment');
  }

  useImage(img) {
    this.stop();
    this.stillImage = img;
    this.video.style.display = 'none';
    this.stage.classList.remove('mirrored');
    const holder = this.stage.querySelector('.still');
    holder.style.backgroundImage = 'url(' + img.src + ')';
    holder.hidden = false;
    this.onStatus('still', 'Move the frame over the product colour and tap Scan.');
  }

  sourceSize() {
    if (this.stillImage) return { w: this.stillImage.naturalWidth, h: this.stillImage.naturalHeight };
    return { w: this.video.videoWidth, h: this.video.videoHeight };
  }

  captureRegion() {
    const size = this.sourceSize();
    if (!size.w || !size.h) return null;

    const box = this.reticle.getBoundingClientRect();
    const frame = this.stage.getBoundingClientRect();
    const relX = (box.left - frame.left) / frame.width;
    const relY = (box.top - frame.top) / frame.height;
    const relW = box.width / frame.width;
    const relH = box.height / frame.height;

    const frameRatio = frame.width / frame.height;
    const sourceRatio = size.w / size.h;
    let visibleW = size.w, visibleH = size.h, offX = 0, offY = 0;
    if (sourceRatio > frameRatio) {
      visibleW = size.h * frameRatio;
      offX = (size.w - visibleW) / 2;
    } else {
      visibleH = size.w / frameRatio;
      offY = (size.h - visibleH) / 2;
    }

    const sx = offX + relX * visibleW;
    const sy = offY + relY * visibleH;
    const sw = relW * visibleW;
    const sh = relH * visibleH;

    const target = 180;
    this.canvas.width = target;
    this.canvas.height = Math.max(1, Math.round(target * (sh / sw)));
    const source = this.stillImage || this.video;
    this.ctx.drawImage(source, sx, sy, sw, sh, 0, 0, this.canvas.width, this.canvas.height);
    return this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
  }

  readOnce() {
    const data = this.captureRegion();
    if (!data) return null;
    return extractShade(data.data, data.width, data.height);
  }

  async scan() {
    if (this.busy) return;
    if (!this.stillImage && !this.stream) {
      this.onStatus('nocamera', 'Start the camera or load a photo first.');
      return;
    }
    this.busy = true;
    this.stage.classList.add('scanning');
    this.readout.textContent = 'Reading colour';
    this.readout.classList.add('working');
    this.bar.style.setProperty('--sweep-ms', SWEEP_MS + 'ms');

    const samples = [];
    const gap = Math.round(SWEEP_MS / SAMPLE_FRAMES);
    for (let i = 0; i < SAMPLE_FRAMES; i++) {
      await new Promise(r => setTimeout(r, gap));
      const reading = this.readOnce();
      if (reading) {
        samples.push(reading);
        this.readout.textContent = 'Reading colour ' + Math.round(((i + 1) / SAMPLE_FRAMES) * 100) + '%';
      }
    }

    this.stage.classList.remove('scanning');
    this.readout.classList.remove('working');
    this.busy = false;

    const result = averageShades(samples);
    if (!result) {
      this.readout.textContent = 'No colour found';
      this.onStatus('failed', 'Nothing readable in the frame. Fill more of the box with the product.');
      return;
    }
    this.readout.textContent = result.hex;
    this.onResult(result);
  }
}
