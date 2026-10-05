# ShadeScan

A working prototype for Meesho ShadeMatch. It reads the colour of a real product through the
camera, returns a standardised colour code, matches that code against a shade catalogue, and
paints the same colour onto a live face so the shade can be judged before buying.

Everything runs in the browser. There is no server, no build step and no API key.

## What it does

**Shade scan.** Point the camera at a lipstick, bullet, swatch or cap and tap Scan. A bar sweeps
through the frame while nine samples are taken, then the colour code appears in the readout box.
The result panel shows hex, RGB, HSL, CIE Lab and the nearest catalogue shade with its Shade ID,
finish, coverage and a ΔE distance. A photo can be scanned instead of a live camera.

**Live try on.** Face tracking places lip colour inside the lip outline and eye shadow on the lid
between lash line and brow. The colour is composited onto the actual skin and lips in the video,
not onto an illustration, so it moves and shades with the face. Matte, glossy and sheer finishes
change opacity and specular behaviour; shimmer adds a light pass on the lids. Any scanned colour
can be sent straight to try on.

## Running it

The app uses ES modules and `fetch`, so it must be served over HTTP rather than opened from the
file system.

```
cd shadescan
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

Cameras require a secure context. `localhost` counts as secure; a plain `http://` address on
another device does not. For phone testing, deploy first.

## Deploying

Push the folder to a repository, then in Settings → Pages choose the branch and the root folder.
The published `https://<user>.github.io/<repo>/` URL is served over TLS, so the camera works on
desktop and phone.

`build.py` is optional. It inlines the CSS, the catalogue and every module into
`dist/shadescan.html`, a single file that can be dropped anywhere.

```
python3 build.py
```

## How the colour is read

Averaging the pixels inside the frame does not work on real products: a lipstick photographed in
its tube contains a specular highlight, clear plastic, a metal band and background, and the mean
of all of that is a muddy grey.

`js/color.js` does the following instead.

1. Crop to the reticle, accounting for the `object-fit: cover` difference between the camera
   frame and the element on screen.
2. Subsample to roughly 4000 pixels and convert each to CIE Lab.
3. Discard the lightest and darkest 12% by `L`, which removes the highlight and the shadow.
4. Run k-means with k = 3 in Lab space.
5. Score each cluster by chroma and by how much of the crop it occupies, skipping near-white and
   near-black clusters, and take the winner's centroid.
6. Repeat across nine frames during the sweep and average the centroids.

Spread within the cluster and drift between frames produce the confidence label. A reading with
high spread usually means uneven light rather than a wrong colour.

Against synthetic product images containing a blown highlight, a transparent cap and a dark
background, recovered colours land within ΔE 1 of ground truth.

## Changing the output format

Colour extraction ends at one value: an sRGB triplet with its Lab coordinates. Everything printed
after that is a separate module, `js/formats.js`, holding a registry. Each output format is one
function, registered by name, and the result panel renders whatever is registered.

To add a format, call `registerFormat` with a key and a render function:

```js
import { registerFormat } from './formats.js';

registerFormat('shadeId', {
  label: 'Shade ID',
  order: 60,
  render: reading => toShadeId(reading.lab)
});
```

`reading` carries `hex`, `rgb`, `lab`, `confidence`, `spread` and `share`. Return a string, or
return `{ value, detail }` when a second line is useful. Return `null` to hide the row. `order`
controls position and `primary` marks the headline value. `unregisterFormat(key)` removes a
built-in one.

Nothing in the scanner needs to change to support a new format.

## Catalogue

`data/shades.json` holds the shades. Each entry needs `id`, `shade`, `hex`, `family`, `finish`,
`coverage`, `price` and `seller`. Entries whose `id` begins with `ES-` are treated as eye shades
and appear in the eye shadow row; everything else is treated as lip colour. Matching, swatch rows
and the nearest-shade format all read from this file, so extending the catalogue needs no code
change.

## Files

```
index.html          markup and controls
styles.css          styling
data/shades.json    shade catalogue
js/color.js         colour spaces, clustering, shade extraction
js/catalogue.js     catalogue loading, nearest-shade search
js/formats.js       output format registry
js/scanner.js       camera, reticle sampling, sweep timing
js/tryon.js         face landmarks and makeup compositing
js/app.js           wiring between the modules and the interface
build.py            optional single-file bundler
```

## Limits worth stating

A digital colour code narrows a search; it does not predict how a shade appears once applied.
Camera white balance, screen calibration and ambient light all shift the reading, which is why
the confidence label is shown rather than hidden, and why the catalogue match is presented with a
distance rather than as a verdict.

Face tracking loads MediaPipe Face Landmarker from a CDN on first use, so the first try on needs
a network connection. Subsequent loads are cached by the browser.
