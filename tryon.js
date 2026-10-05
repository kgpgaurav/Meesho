const VISION_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const WASM_URL = VISION_URL + '/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const LIP_OUTER = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 375, 321, 405, 314, 17, 84, 181, 91, 146];
const LIP_INNER = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95];
const RIGHT_LID = [33, 246, 161, 160, 159, 158, 157, 173, 133];
const RIGHT_BROW = [55, 65, 52, 53, 46];
const LEFT_LID = [263, 466, 388, 387, 386, 385, 384, 398, 362];
const LEFT_BROW = [285, 295, 282, 283, 276];
const GLOSS_POINTS = [14, 17, 84, 314];

export class TryOn {
  constructor(options) {
    this.video = options.video;
    this.canvas = options.canvas;
    this.stage = options.stage;
    this.onStatus = options.onStatus || (() => {});
    this.ctx = this.canvas.getContext('2d');
    this.layer = document.createElement('canvas');
    this.layerCtx = this.layer.getContext('2d');
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.lastTime = -1;
    this.settings = {
      lips: { on: true, hex: '#7A4A3E', finish: 'Matte', intensity: 0.68 },
      eyes: { on: false, hex: '#8A7466', finish: 'Matte', intensity: 0.5 }
    };
  }

  async load() {
    if (this.landmarker) return true;
    this.onStatus('loading', 'Loading the face model');
    try {
      const vision = await import(VISION_URL);
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
      this.landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numFaces: 1
      });
      return true;
    } catch (err) {
      this.onStatus('failed', 'The face model could not load. Check the connection and reload.');
      return false;
    }
  }

  async start() {
    const ready = await this.load();
    if (!ready) return false;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this.onStatus('nocamera', 'This browser cannot open a camera.');
      return false;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 720 } },
        audio: false
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      this.canvas.width = this.video.videoWidth;
      this.canvas.height = this.video.videoHeight;
      this.layer.width = this.canvas.width;
      this.layer.height = this.canvas.height;
      this.running = true;
      this.onStatus('live', 'Face your light source for the truest colour.');
      requestAnimationFrame(() => this.loop());
      return true;
    } catch (err) {
      this.onStatus('denied', 'Camera permission was refused.');
      return false;
    }
  }

  stop() {
    this.running = false;
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  set(region, patch) {
    Object.assign(this.settings[region], patch);
  }

  loop() {
    if (!this.running) return;
    const now = performance.now();
    if (this.video.readyState >= 2 && this.video.currentTime !== this.lastTime) {
      this.lastTime = this.video.currentTime;
      let result = null;
      try {
        result = this.landmarker.detectForVideo(this.video, now);
      } catch (err) {
        result = null;
      }
      this.draw(result);
    }
    requestAnimationFrame(() => this.loop());
  }

  draw(result) {
    const w = this.canvas.width, h = this.canvas.height;
    this.ctx.clearRect(0, 0, w, h);
    if (!result || !result.faceLandmarks || !result.faceLandmarks.length) {
      this.stage.classList.add('searching');
      return;
    }
    this.stage.classList.remove('searching');
    const lm = result.faceLandmarks[0];

    if (this.settings.eyes.on) this.paintEyes(lm, w, h);
    if (this.settings.lips.on) this.paintLips(lm, w, h);
  }

  pathFrom(ctx, indices, lm, w, h, close) {
    ctx.beginPath();
    indices.forEach((idx, i) => {
      const p = lm[idx];
      const x = p.x * w, y = p.y * h;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (close !== false) ctx.closePath();
  }

  smoothPath(ctx, points, close) {
    ctx.beginPath();
    if (!points.length) return;
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 0; i < points.length; i++) {
      const cur = points[i];
      const next = points[(i + 1) % points.length];
      ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
    }
    if (close !== false) ctx.closePath();
  }

  paintLips(lm, w, h) {
    const cfg = this.settings.lips;
    const lc = this.layerCtx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, w, h);
    lc.globalCompositeOperation = 'source-over';
    lc.filter = 'blur(2.5px)';
    lc.fillStyle = cfg.hex;
    const outer = LIP_OUTER.map(i => ({ x: lm[i].x * w, y: lm[i].y * h }));
    this.smoothPath(lc, outer);
    lc.fill();
    lc.globalCompositeOperation = 'destination-out';
    lc.filter = 'blur(1.5px)';
    const inner = LIP_INNER.map(i => ({ x: lm[i].x * w, y: lm[i].y * h }));
    this.smoothPath(lc, inner);
    lc.fill();
    lc.filter = 'none';
    lc.globalCompositeOperation = 'source-over';

    const base = cfg.finish === 'Sheer' ? 0.62 : cfg.finish === 'Glossy' ? 0.82 : 1;
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'multiply';
    this.ctx.globalAlpha = Math.min(1, cfg.intensity * base);
    this.ctx.drawImage(this.layer, 0, 0);
    if (cfg.finish !== 'Sheer') {
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = Math.min(1, cfg.intensity * 0.3);
      this.ctx.drawImage(this.layer, 0, 0);
    }
    this.ctx.restore();

    if (cfg.finish === 'Glossy') this.paintGloss(lm, w, h, cfg.intensity);
  }

  paintGloss(lm, w, h, intensity) {
    const pts = GLOSS_POINTS.map(i => ({ x: lm[i].x * w, y: lm[i].y * h }));
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const span = Math.hypot(lm[61].x * w - lm[291].x * w, lm[61].y * h - lm[291].y * h);
    const rx = span * 0.16, ry = span * 0.055;
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'screen';
    this.ctx.globalAlpha = Math.min(0.55, intensity * 0.5);
    this.ctx.filter = 'blur(3px)';
    this.ctx.fillStyle = '#ffffff';
    this.ctx.beginPath();
    this.ctx.ellipse(cx, cy + ry * 0.4, rx, ry, 0, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  }

  lidPolygon(lm, lid, brow, w, h, lift) {
    const lidPts = lid.map(i => ({ x: lm[i].x * w, y: lm[i].y * h }));
    const inner = lidPts[0], outer = lidPts[lidPts.length - 1];
    const browPts = brow.map(i => {
      const b = lm[i];
      const bx = b.x * w, by = b.y * h;
      const ref = Math.abs(bx - inner.x) < Math.abs(bx - outer.x) ? inner : outer;
      return { x: bx + (ref.x - bx) * (1 - lift), y: by + (ref.y - by) * (1 - lift) };
    });
    return lidPts.concat(browPts);
  }

  paintEyes(lm, w, h) {
    const cfg = this.settings.eyes;
    const lc = this.layerCtx;
    lc.setTransform(1, 0, 0, 1, 0, 0);
    lc.clearRect(0, 0, w, h);
    lc.globalCompositeOperation = 'source-over';
    const eyeSpan = Math.hypot(lm[33].x * w - lm[263].x * w, lm[33].y * h - lm[263].y * h);
    lc.filter = 'blur(' + Math.max(4, eyeSpan * 0.035).toFixed(1) + 'px)';
    lc.fillStyle = cfg.hex;
    [[RIGHT_LID, RIGHT_BROW], [LEFT_LID, LEFT_BROW]].forEach(([lid, brow]) => {
      const poly = this.lidPolygon(lm, lid, brow, w, h, 0.55);
      this.smoothPath(lc, poly);
      lc.fill();
    });
    lc.filter = 'none';

    this.ctx.save();
    this.ctx.globalCompositeOperation = 'multiply';
    this.ctx.globalAlpha = Math.min(1, cfg.intensity);
    this.ctx.drawImage(this.layer, 0, 0);
    if (cfg.finish === 'Shimmer') {
      this.ctx.globalCompositeOperation = 'screen';
      this.ctx.globalAlpha = Math.min(0.4, cfg.intensity * 0.35);
      this.ctx.drawImage(this.layer, 0, 0);
    }
    this.ctx.restore();
  }
}
