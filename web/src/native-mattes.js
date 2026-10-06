// Decode the semantic mattes already embedded in an iPhone 18 HEIC.
//
// These are ordinary single-frame HEVC image items.  Decoding their item payloads directly
// through the selected decoder lets diagnostics show Apple's stored masks without
// modifying the photo or running vision inference again.

import { extractItem, auxUriForItem, dimensionsForItem, propertyBoxBytes,
  itemOrientation, storedPointToDisplay,
  transformNormalizedRect, DEPTH_URI } from "./heif.js?v=0.8.0";
import { parseBplist } from "./bplist.js?v=0.8.0";
import { decodeToDisplayCanvas, decodeImageItem } from "./decode.js?v=0.8.0";
import { MATTE_2026_URIS } from "./texture.js?v=0.8.0";

const URI_TEXTURE_STYLES = "tag:apple.com,2026:photo:metadata:texture_styles";

const WANTED = MATTE_2026_URIS.map((uri) => uri.split(":").pop());
const LEGACY_WANTED = [
  "portraiteffectsmatte", "semanticskinmatte", "semantichairmatte",
  "semanticteethmatte", "semanticglassesmatte", "semanticskymatte",
];
const STYLE_STAT_NAMES = [
  "ToneMappedImagePersonSegmentBased", "LinearImagePersonSegmentBased",
  "ToneMappedImageSkinBased", "LinearImageSkinBased",
  "ToneMappedImageRedChannelSkinBased", "ToneMappedImageGreenChannelSkinBased",
  "ToneMappedImageBlueChannelSkinBased",
];
const STAT_FIELDS = [
  "blackPoint", "whitePoint", "highKey", "p02", "p10", "p25", "p50", "p75", "p98",
];
export const INSPECTION_NAMES = [
  "HDR gain map", "style delta map", "tmap", "styles", "texture_styles",
  "TextureStylePostProcessedPeopleData",
  "portrait depth map", ...LEGACY_WANTED, ...WANTED, "semanticpersoninstances",
  "PersonMasksValidHint", "PeopleRatio", "SkinRatio", ...STYLE_STAT_NAMES,
];

function canvas(width, height) {
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  return out;
}

function pngBlob(source) {
  return new Promise((resolve, reject) => source.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error("Could not create native-matte PNG")),
    "image/png"));
}

export function readNativePeopleData(bytes, discovery) {
  const iid = [...discovery.infos].find(([, info]) =>
    info.type === "uri " && info.uri === URI_TEXTURE_STYLES)?.[0];
  if (iid === undefined) return [];
  const plist = parseBplist(extractItem(bytes, discovery.iloc, iid));
  const people = plist.get("TextureStylePostProcessedPeopleData");
  return Array.isArray(people) ? people : [];
}

function mapValue(map, key, fallback = 0) {
  const value = map instanceof Map ? map.get(key) : undefined;
  return Number.isFinite(value) ? value : fallback;
}

export function displayPoint(x, y, angle, mirror = null) {
  return storedPointToDisplay(x, y, angle, mirror);
}

function displayRect(roi, angle, mirror) {
  if (!(roi instanceof Map)) return null;
  const x = mapValue(roi, "x"), y = mapValue(roi, "y");
  const w = mapValue(roi, "width"), h = mapValue(roi, "height");
  return transformNormalizedRect({ x, y, width: w, height: h },
    (px, py) => displayPoint(px, py, angle, mirror));
}

function drawNormalizedRect(ctx, roi, width, height, color, label, angle, mirror,
  dashed = false) {
  if (!(roi instanceof Map)) return;
  const shown = displayRect(roi, angle, mirror);
  const x = shown.x * width, y = shown.y * height;
  const w = shown.width * width, h = shown.height * height;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, width / 450);
  ctx.setLineDash(dashed ? [ctx.lineWidth * 3, ctx.lineWidth * 2] : []);
  ctx.strokeRect(x, y, w, h);
  ctx.setLineDash([]);
  ctx.font = `600 ${Math.max(13, Math.round(width / 65))}px system-ui`;
  const textWidth = ctx.measureText(label).width;
  const textY = Math.max(0, y - Math.max(18, width / 50));
  ctx.fillStyle = "rgba(0,0,0,.72)";
  ctx.fillRect(x, textY, textWidth + 10, Math.max(18, width / 50));
  ctx.fillStyle = color;
  ctx.fillText(label, x + 5, textY + Math.max(14, width / 65));
  ctx.restore();
}

export function renderPeopleGeometry(display, people, angle, mirror) {
  const maxSide = 1800;
  const scale = Math.min(1, maxSide / Math.max(display.width, display.height));
  const out = canvas(Math.max(1, Math.round(display.width * scale)),
    Math.max(1, Math.round(display.height * scale)));
  const ctx = out.getContext("2d");
  ctx.drawImage(display, 0, 0, out.width, out.height);
  const radius = Math.max(2, out.width / 300);

  people.forEach((person, index) => {
    const n = index + 1;
    drawNormalizedRect(ctx, person.get("instanceROI"), out.width, out.height,
      "#23a8ff", `#${n} instanceROI`, angle, mirror, true);
    drawNormalizedRect(ctx, person.get("faceSkinROI"), out.width, out.height,
      "#ff3b30", `#${n} faceSkinROI`, angle, mirror);
    drawNormalizedRect(ctx, person.get("faceROI"), out.width, out.height,
      "#ffd60a", `#${n} faceROI`, angle, mirror);

    ctx.fillStyle = "#42ff74";
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.lineWidth = Math.max(1, radius / 2);
    (person.get("faceLandmarks") || []).forEach((landmark, landmarkIndex) => {
      const point = landmark instanceof Map ? landmark.get("point") : null;
      if (!(point instanceof Map)) return;
      const error = mapValue(landmark, "error");
      const r = radius * Math.min(2.2, 1 + error * 25);
      const shown = displayPoint(mapValue(point, "x"), mapValue(point, "y"), angle, mirror);
      const x = shown.x * out.width, y = shown.y * out.height;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.font = `700 ${Math.max(8, Math.round(out.width / 150))}px ui-monospace, monospace`;
      ctx.lineWidth = Math.max(2, out.width / 800);
      ctx.strokeStyle = "rgba(0,0,0,.95)";
      ctx.fillStyle = "#fff";
      const label = String(landmarkIndex);
      ctx.strokeText(label, x + r + 1, y - r - 1);
      ctx.fillText(label, x + r + 1, y - r - 1);
      ctx.fillStyle = "#42ff74";
      ctx.strokeStyle = "rgba(0,0,0,.85)";
    });

    const roi = person.get("faceSkinROI");
    if (roi instanceof Map) {
      const shown = displayRect(roi, angle, mirror);
      const x = shown.x * out.width;
      const y = (shown.y + shown.height) * out.height;
      const pose = `yaw ${mapValue(person, "faceYaw").toFixed(2)} · pitch ${
        mapValue(person, "facePitch").toFixed(2)} · roll ${mapValue(person, "faceRoll").toFixed(2)}`;
      ctx.font = `600 ${Math.max(13, Math.round(out.width / 65))}px system-ui`;
      const tw = ctx.measureText(pose).width;
      ctx.fillStyle = "rgba(0,0,0,.72)";
      ctx.fillRect(x, y, tw + 10, Math.max(18, out.width / 50));
      ctx.fillStyle = "#fff";
      ctx.fillText(pose, x + 5, y + Math.max(14, out.width / 65));
    }
  });

  const legend = "red: faceSkinROI · yellow: faceROI · blue: instanceROI · green: landmarks 0–75";
  ctx.font = `600 ${Math.max(13, Math.round(out.width / 65))}px system-ui`;
  const lw = ctx.measureText(legend).width;
  ctx.fillStyle = "rgba(0,0,0,.72)";
  ctx.fillRect(0, 0, Math.min(out.width, lw + 16), Math.max(22, out.width / 45));
  ctx.fillStyle = "white";
  ctx.fillText(legend, 8, Math.max(16, out.width / 60));
  return out;
}

async function decodePrimary(bytes, options) {
  return decodeToDisplayCanvas(bytes, options);
}

export function findNativeMatteItems(discovery) {
  const byName = new Map();
  for (const iid of discovery.infos.keys()) {
    const uri = auxUriForItem(discovery.props, iid);
    if (uri) byName.set(uri.split(":").pop(), iid);
  }
  return new Map(WANTED.flatMap((name) =>
    byName.has(name) ? [[name, { iid: byName.get(name), name }]] : []));
}

export function hasNativeFaceMattes(discovery) {
  const items = findNativeMatteItems(discovery);
  return items.has("semanticskinmattev2") || items.has("semanticfaceskinmatte")
    || items.has("semanticpersonmatte");
}

export {codecStringFromHvcc, decoderCodecCandidates, displayRotationRadians, readImageGrid} from "./webcodecs-decode.js?v=0.8.0";
export {decodeImageItem} from "./decode.js?v=0.8.0";

function scalar(value) {
  if (typeof value === "number" || typeof value === "string" || typeof value === "boolean")
    return value;
  return value ?? null;
}

function statisticsValue(value) {
  if (!(value instanceof Map)) return null;
  return Object.fromEntries(STAT_FIELDS.filter((key) => value.has(key))
    .map((key) => [key, scalar(value.get(key))]));
}

function peopleSummary(people) {
  return people.map((person, index) => ({
    person: index + 1,
    faceYaw: scalar(person.get("faceYaw")),
    facePitch: scalar(person.get("facePitch")),
    faceRoll: scalar(person.get("faceRoll")),
    faceLandmarks: Array.isArray(person.get("faceLandmarks"))
      ? person.get("faceLandmarks").length : 0,
    instanceMaskReferenceKey: scalar(person.get("instanceMaskReferenceKey")),
    hasFaceROI: person.get("faceROI") instanceof Map,
    hasFaceSkinROI: person.get("faceSkinROI") instanceof Map,
    hasInstanceROI: person.get("instanceROI") instanceof Map,
  }));
}

/** Build one canonical inventory. Missing rows are added by the comparison UI, so the same
 * names and ordering are used before and after processing. */
export async function buildHeicInspection(bytes, discovery, options = {}) {
  const entries = new Map();
  const set = (name, value) => entries.set(name, { name, present: true, ...value });
  const tmapGainIds = discovery.refs.filter((ref) => ref.type === "dimg" &&
    discovery.infos.get(ref.from)?.type === "tmap" && ref.to.length === 2 && ref.to[0] === discovery.primary)
    .map((ref) => ref.to[1]);
  const gainId = discovery.hdrGrid ?? (new Set(tmapGainIds).size === 1 ? tmapGainIds[0] : null);
  if (gainId != null) {
    const iid = gainId;
    const previews = [], errors = [];
    try {
      const source = await decodeImageItem(bytes, discovery, iid, {...options,auxiliaryData:true});
      try { previews.push({ itemId: iid, blob: await pngBlob(source) }); }
      finally { source.width = source.height = 0; }
    } catch (error) { errors.push({ itemId: iid, error: error?.message || String(error) }); }
    set("HDR gain map", {
      kind: "image", itemIds: [iid], previews, errors,
      value: { item: iid, tiles: discovery.refs.filter((ref) => ref.type === "dimg" && ref.from === iid)
          .reduce((count, ref) => count + ref.to.length, 0),
        dimensions: dimensionsForItem(discovery.props, iid) },
    });
  }
  if (discovery.deltaGrid !== null) set("style delta map", {
    kind: "structure", itemIds: [discovery.deltaGrid],
    value: { item: discovery.deltaGrid, tiles: discovery.deltaTiles.length,
      dimensions: dimensionsForItem(discovery.props, discovery.deltaGrid) },
  });
  const tmaps = [...discovery.infos].filter(([, info]) => info.type === "tmap").map(([iid]) => iid);
  if (tmaps.length) set("tmap", { kind: "structure", itemIds: tmaps,
    value: tmaps.map((iid) => ({ item: iid, dimensions: dimensionsForItem(discovery.props, iid) })) });

  let styles = null;
  if (discovery.stylesItem !== null) {
    try { styles = parseBplist(extractItem(bytes, discovery.iloc, discovery.stylesItem)); }
    catch { styles = null; }
    set("styles", { kind: "metadata", itemIds: [discovery.stylesItem],
      value: { item: discovery.stylesItem, schemaVersion: scalar(styles?.get("0")) } });
  }
  const textureItem = [...discovery.infos].find(([, info]) =>
    info.type === "uri " && info.uri === URI_TEXTURE_STYLES)?.[0];
  let people = [];
  if (textureItem !== undefined) {
    let texture = null;
    try { texture = parseBplist(extractItem(bytes, discovery.iloc, textureItem)); }
    catch { texture = null; }
    people = Array.isArray(texture?.get("TextureStylePostProcessedPeopleData"))
      ? texture.get("TextureStylePostProcessedPeopleData") : [];
    set("texture_styles", { kind: "metadata", itemIds: [textureItem], value: {
      item: textureItem, preset: scalar(texture?.get("Preset")),
      hardwareModel: scalar(texture?.get("HardwareModel")), people: people.length,
    } });
    if (texture?.has("TextureStylePostProcessedPeopleData"))
      set("TextureStylePostProcessedPeopleData", {
        kind: "metadata", itemIds: [textureItem], value: peopleSummary(people),
      });
  }

  const seven = styles?.get("7");
  for (const name of ["PersonMasksValidHint", "PeopleRatio", "SkinRatio"])
    if (seven instanceof Map && seven.has(name)) set(name, { kind: "value", value: scalar(seven.get(name)) });
  const six = styles?.get("6");
  for (const name of STYLE_STAT_NAMES)
    if (six instanceof Map && six.has(name))
      set(name, { kind: "statistics", value: statisticsValue(six.get(name)) });

  const auxByName = new Map();
  for (const iid of discovery.infos.keys()) {
    const uri = auxUriForItem(discovery.props, iid);
    if (!uri) continue;
    const name = uri === DEPTH_URI ? "portrait depth map" : uri.split(":").pop();
    if (!auxByName.has(name)) auxByName.set(name, []);
    auxByName.get(name).push(iid);
  }
  for (const name of ["portrait depth map", ...LEGACY_WANTED, ...WANTED, "semanticpersoninstances"]) {
    const ids = auxByName.get(name) || [];
    if (!ids.length) continue;
    const previews = [];
    const errors = [];
    for (const iid of ids) {
      try {
        const source = await decodeImageItem(bytes, discovery, iid, {...options,auxiliaryData:true});
        try { previews.push({ itemId: iid, blob: await pngBlob(source), coverage: maskCoverage(source) }); }
        finally { source.width = source.height = 0; }
      } catch (error) { errors.push({ itemId: iid, error: error?.message || String(error) }); }
    }
    set(name, { kind: "image", itemIds: ids, previews, errors });
  }
  if (people.length) {
    try {
      const {angle,mirror} = itemOrientation(bytes, discovery.props, discovery.primary);
      const geometry = await pngBlob(renderPeopleGeometry(await decodePrimary(bytes, options), people,
        angle,mirror));
      const entry = entries.get("TextureStylePostProcessedPeopleData");
      if (entry) entry.previews = [{ itemId: textureItem, blob: geometry }];
    } catch { /* metadata remains visible even if the primary decoder is unavailable */ }
  }
  return { entries };
}

function maskCoverage(source) {
  const data = source.getContext("2d", { willReadFrequently: true })
    .getImageData(0, 0, source.width, source.height).data;
  let sum = 0;
  for (let p = 0; p < data.length; p += 4)
    sum += (data[p] + data[p + 1] + data[p + 2]) / (3 * 255);
  return sum / (source.width * source.height);
}

export async function extractNativeMatteArtifacts(bytes, discovery, options = {}) {
  const items = findNativeMatteItems(discovery);
  if (!items.size) throw new Error("No iPhone 18 semantic mattes are present");
  const decoded = new Map();
  for (const [key, spec] of items)
    decoded.set(key, await decodeImageItem(bytes, discovery, spec.iid, {...options,auxiliaryData:true}));
  const people = readNativePeopleData(bytes, discovery);
  const artifacts = { native: true, faces: people.length };
  if (people.length) {
    const {angle,mirror} = itemOrientation(bytes, discovery.props, discovery.primary);
    artifacts.geometry = await pngBlob(renderPeopleGeometry(await decodePrimary(bytes, options),people,angle,mirror));
  }
  for (const [key, source] of decoded) artifacts[key] = await pngBlob(source);
  artifacts.skinRatio = decoded.has("semanticskinmattev2")
    ? maskCoverage(decoded.get("semanticskinmattev2")) : 0;
  artifacts.peopleRatio = decoded.has("semanticpersonmatte")
    ? maskCoverage(decoded.get("semanticpersonmatte")) : 0;
  artifacts.itemIds = Object.fromEntries([...items].map(([key, spec]) => [key, spec.iid]));
  artifacts.labels = Object.fromEntries([...items.keys()].map((name) => [name, name]));
  artifacts.coverage = Object.fromEntries(
    [...decoded].map(([name, source]) => [name, maskCoverage(source)]));
  artifacts.matteCount = items.size;
  artifacts.missingMattes = WANTED.filter((name) => !items.has(name));
  return artifacts;
}
