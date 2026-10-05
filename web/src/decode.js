// Shared HEIC analysis/inspection decoder. Only auto mode may fall back to asm.js.
import {discoverImageItems} from "./heif.js?v=0.7.0";
import {isolateImageItem} from "./primary-source.js?v=0.7.0";
import {decodeWebCodecsImageItem, imageRgbColorSpace} from "./webcodecs-decode.js?v=0.7.0";

export const DECODER_MODES = ["auto", "webcodecs", "libheif"];
// Production always defaults to automatic fallback. Explicit per-call modes are
// retained for codec regression tests; old localStorage choices are ignored.

const LIBHEIF_URL = "https://cdn.jsdelivr.net/npm/libheif-js@1.18.2/libheif/libheif.js";

let libheifPromise = null;

function injectScript() {
  return new Promise((resolve, reject) => {
    if (globalThis.libheif) return resolve();
    const s = document.createElement("script");
    s.src = LIBHEIF_URL;
    s.onload = () => (globalThis.libheif ? resolve()
      : reject(new Error("libheif loaded but did not register")));
    s.onerror = () => reject(new Error("could not load libheif"));
    document.head.appendChild(s);
  });
}

/**
 * Resolve to the libheif module itself.
 *
 * The bundle is UMD with no browser-global branch, so a plain <script> leaves
 * only its top-level `var libheif` on window — and that is a lazy FACTORY, not
 * the module. Calling it is what yields HeifDecoder; skipping the call is why
 * `libheif.HeifDecoder is not a constructor`.
 */
export async function loadLibheif() {
  if (libheifPromise) return libheifPromise;
  libheifPromise = (async () => {
    await injectScript();
    const raw = globalThis.libheif;
    const mod = typeof raw === "function" ? raw() : raw;
    // The wasm build resolves asynchronously; the asm.js build is ready at once.
    const resolved = mod && typeof mod.then === "function" ? await mod : mod;
    if (resolved && typeof resolved.ready?.then === "function") await resolved.ready;
    if (!resolved || typeof resolved.HeifDecoder !== "function")
      throw new Error("libheif loaded but exposes no HeifDecoder");
    return resolved;
  })().catch((e) => { libheifPromise = null; throw e; });
  return libheifPromise;
}

/** Undo the normalized mirror-then-rotate display transform. */
function orientationTransform(ctx, w, h, angle, mirror) {
  const swap = angle === 90 || angle === 270;
  const outW = swap ? h : w;
  const outH = swap ? w : h;
  ctx.translate(outW / 2, outH / 2);
  if (mirror === 0) ctx.scale(1, -1);
  else if (mirror === 1) ctx.scale(-1, 1);
  ctx.rotate(angle * Math.PI / 180);
  ctx.translate(-w / 2, -h / 2);
  return [outW, outH];
}

const cache = new WeakMap();

async function decodeAsm(bytes, discovery, iid, {onProgress, maxSide = Infinity, diagnostics, renderFrame, fallbackReason, outputColorSpace} = {}) {
  if (renderFrame) throw Error("Custom VideoFrame rendering requires WebCodecs");
  onProgress?.({stage: "codec", operation: "decode", source: "libheif-js (asm.js)", fallbackReason});
  const libheif = await loadLibheif();
  const decoder = new libheif.HeifDecoder();
  let images = [];
  try {
    images = decoder.decode(iid === discovery.primary ? bytes : isolateImageItem(bytes, iid, discovery));
    if (!images || !images.length) throw new Error("libheif decoded no image");
    // 1.18.2's is_primary() wrapper references an undefined global. Use its
    // exported C API instead, so top-level array order never selects a thumbnail.
    const isPrimary = item => libheif.heif_image_handle_is_primary_image && item.handle != null
      ? Boolean(libheif.heif_image_handle_is_primary_image(item.handle)) : Boolean(item.is_primary?.());
    const image = images.find(isPrimary) || (images.length === 1 ? images[0] : null);
    if (!image) throw Error("libheif could not identify the requested primary image");
    const w = image.get_width(), h = image.get_height();
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const rgbColor = outputColorSpace ? imageRgbColorSpace(bytes, discovery, iid) : null;
    const sampleColorSpace = rgbColor?.primaries === "smpte432" ? "display-p3" : "srgb";
    const ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: outputColorSpace || "srgb" });
    if (!ctx || (outputColorSpace && ctx.getContextAttributes?.().colorSpace !== outputColorSpace))
      throw Error(`HEIC source requires a ${outputColorSpace} canvas`);
    const imageData = ctx.createImageData(w, h);
    await new Promise((res, rej) => {
      image.display(imageData, (out) => (out ? res(out) : rej(new Error("libheif display failed"))));
    });
    if (rgbColor) {
      // libheif outputs source RGB values, not an ICC-managed sRGB image. Tag
      // their actual primaries and convert the transfer before drawing into P3.
      if (rgbColor.transfer !== "iec61966-2-1") for (let p = 0; p < imageData.data.length; p++) {
        if (p % 4 === 3) continue;
        const x = imageData.data[p] / 255;
        const linear = rgbColor.transfer === "linear" ? x : x < 0.081 ? x / 4.5 : ((x + 0.099) / 1.099) ** (1 / 0.45);
        imageData.data[p] = 255 * (linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055);
      }
      const tagged = new ImageData(imageData.data, w, h, {colorSpace: sampleColorSpace});
      const source = document.createElement("canvas"); source.width = w; source.height = h;
      try {
        const sourceContext = source.getContext("2d", {colorSpace: sampleColorSpace});
        if (!sourceContext || sourceContext.getContextAttributes?.().colorSpace !== sampleColorSpace)
          throw Error(`HEIC source requires a ${sampleColorSpace} canvas`);
        sourceContext.putImageData(tagged, 0, 0); ctx.drawImage(source, 0, 0);
      } finally {source.width = source.height = 0;}
      onProgress?.({stage: "codec", operation: "decode", source: "libheif-js (asm.js)", fallbackReason, colorProfile: rgbColor.colorProfile});
    } else ctx.putImageData(imageData, 0, 0);
    diagnostics?.push({itemId: iid, source: "libheif-js (asm.js)", fallbackReason});
    if (Number.isFinite(maxSide) && Math.max(w, h) > maxSide) {
      const small = document.createElement("canvas"), scale = maxSide / Math.max(w, h);
      small.width = Math.max(1, Math.round(w * scale)); small.height = Math.max(1, Math.round(h * scale));
      small.getContext("2d", {colorSpace: outputColorSpace || "srgb"}).drawImage(canvas, 0, 0, small.width, small.height);
      canvas.width = canvas.height = 0;
      return {canvas: small, source: "libheif-js (asm.js)", fallbackReason};
    }
    return {canvas, source: "libheif-js (asm.js)", fallbackReason};
  } finally {
    for (const image of images || []) image.free?.();
    if (decoder.decoder && libheif.heif_context_free) {
      libheif.heif_context_free(decoder.decoder); decoder.decoder = null;
    }
  }
}

async function decodeSelected(bytes, discovery, iid, options) {
  const {decoder = "auto"} = options;
  if (!DECODER_MODES.includes(decoder)) throw Error(`Unknown decoder mode: ${decoder}`);
  if (!(options.maxSide === undefined || options.maxSide > 0)) throw Error("Invalid decoded image size");
  if (options.outputColorSpace !== undefined && !["srgb", "display-p3"].includes(options.outputColorSpace))
    throw Error("Invalid decoded output color space");
  const reportFailure = (source, error, details = {}) => options.onProgress?.({
    stage: "codec", operation: "decode", source, ...details, decodeError: error.message || String(error),
  });
  if (decoder === "libheif") {
    try { return await decodeAsm(bytes, discovery, iid, options); }
    catch (error) { reportFailure("libheif-js (asm.js)", error); throw error; }
  }
  let colorProfile, colorCorrection = false;
  try {
    const onProgress = event => {colorProfile = event.colorProfile || colorProfile; colorCorrection ||= Boolean(event.colorCorrection); options.onProgress?.(event);};
    const canvas = await decodeWebCodecsImageItem(bytes, discovery, iid, {...options,onProgress});
    return {canvas, source: "WebCodecs VideoDecoder", colorProfile, colorCorrection};
  } catch (error) {
    reportFailure("WebCodecs VideoDecoder", error, {colorProfile, colorCorrection});
    if (decoder === "webcodecs") throw error;
    try { return await decodeAsm(bytes, discovery, iid, {...options, fallbackReason: error.message || String(error)}); }
    catch (fallbackError) {
      const failure = new Error(`${error.message || error}; libheif fallback failed: ${fallbackError.message || fallbackError}`, {cause: fallbackError});
      reportFailure("libheif-js (asm.js)", failure);
      throw failure;
    }
  }
}

/** Caller owns this item canvas; inspection can discard it without damaging analysis caches. */
export async function decodeImageItem(bytes, discovery, iid, options = {}) {
  const auxiliaryData = Boolean(options.auxiliaryData && iid !== discovery.primary);
  return (await decodeSelected(bytes, discovery, iid, {...options,auxiliaryData})).canvas;
}

async function decodeFull(bytes, options) {
  const decoder = options.decoder || "auto";
  const key = `${decoder}:${options.outputColorSpace || "analysis"}`;
  let modes = cache.get(bytes);
  if (!modes) { modes = new Map(); cache.set(bytes, modes); }
  if (!modes.has(key)) {
    const discovery = discoverImageItems(bytes);
    const pending = decodeSelected(bytes, discovery, discovery.primary, {...options, decoder});
    modes.set(key, pending);
    pending.catch(() => { if (modes.get(key) === pending) modes.delete(key); });
  }
  const result = await modes.get(key);
  options.onProgress?.({stage: "codec", operation: "decode", source: result.source, fallbackReason: result.fallbackReason, colorProfile: result.colorProfile, colorCorrection: result.colorCorrection});
  return {...result, w: result.canvas.width, h: result.canvas.height};
}

/**
 * Decode the primary image in the orientation a visitor sees.  The returned canvas is the
 * cached decoder surface and must be treated as read-only by callers.
 */
export async function decodeToDisplayCanvas(bytes, options = {}) {
  return (await decodeFull(bytes, options)).canvas;
}

/**
 * Decode and resample to width x height, optionally undoing the display rotation.
 * Returns packed RGB bytes.
 */
export async function decodeToRgb(bytes, { width, height, angle = 0, mirror = null, onProgress, decoder }) {
  const { canvas, w, h } = await decodeFull(bytes, {onProgress, decoder});
  const rotated = document.createElement("canvas");
  const swap = angle === 90 || angle === 270;
  rotated.width = swap ? h : w;
  rotated.height = swap ? w : h;
  const rctx = rotated.getContext("2d", { willReadFrequently: true });
  rctx.save();
  orientationTransform(rctx, w, h, angle, mirror);
  rctx.drawImage(canvas, 0, 0);
  rctx.restore();

  const small = document.createElement("canvas");
  small.width = width; small.height = height;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(rotated, 0, 0, width, height);
  const { data } = sctx.getImageData(0, 0, width, height);
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, p = 0; p < data.length; i += 3, p += 4) {
    rgb[i] = data[p]; rgb[i + 1] = data[p + 1]; rgb[i + 2] = data[p + 2];
  }
  return rgb;
}
