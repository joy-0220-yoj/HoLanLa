// Decode HEVC image items without loading a software decoder.
import {extractItemData, dimensionsForItem, propertyBoxBytes, itemOrientation, auxUriForItem} from "./heif.js?v=0.8.0";
import {metaChildren, findChild, concat, u} from "./box.js?v=0.8.0";
import {recognizeIccColorSpace} from "./icc-color.js?v=0.8.0";
import {completeDecoderColorSpace,applyDecodedColorSpace,readGrayscaleData} from "./webcodecs-color.js?v=0.8.0";
function canvas(width, height) {
  const out = document.createElement("canvas"); out.width = width; out.height = height; return out;
}

/** Standard ICC matrix/TRC profiles can be described by VideoColorSpace.
 * Complex profiles still fall back rather than silently changing their colors. */
function itemColorSpace(bytes, discovery, iid, auxiliaryData = false, colorOnly = false) {
  if (!colorOnly && discovery.refs.some(ref => ref.type === "auxl" && ref.to.includes(iid)
    && /auxid:1$|auxiliary:alpha$/.test(auxUriForItem(discovery.props, ref.from) || "")))
    throw Error("HEIF alpha composition requires libheif");
  let color, icc;
  for (const association of discovery.props.associations.get(iid) || []) {
    const property = discovery.props.properties[association.index - 1];
    if (!colorOnly && property?.type === "pasp" && u(bytes, property.box.off + property.box.hdr, 4) !== u(bytes, property.box.off + property.box.hdr + 4, 4))
      throw Error("HEIF pixel-aspect correction requires libheif");
    if (!colorOnly && property?.type === "clap") throw Error("HEIF clean-aperture cropping requires libheif");
    if (property?.type !== "colr") continue;
    const record = bytes.subarray(property.box.off + property.box.hdr, property.box.off + property.box.size);
    const type = String.fromCharCode(...record.subarray(0, 4));
    if (["prof", "rICC"].includes(type)) {
      let next;
      try { next = recognizeIccColorSpace(record.subarray(4), {allowGrayscale: auxiliaryData}); }
      catch (error) {
        if (colorOnly) throw Error(`HEIC source ICC color management unavailable: ${error.message.replace(/^HEIF ICC color profile requires libheif: /, "")}`);
        throw error;
      }
      if (icc && icc.name !== next.name) throw Error("Conflicting HEIF ICC color profiles");
      icc = next; continue;
    }
    if (type !== "nclx" || record.length < 11) throw Error("Unsupported HEIF color description");
    const mappings = {primaries: {1:"bt709", 9:"bt2020", 12:"smpte432"},
      transfer: {1:"bt709", 6:"smpte170m", 8:"linear", 13:"iec61966-2-1", 16:"pq", 18:"hlg"},
      matrix: {0:"rgb", 1:"bt709", 5:"bt470bg", 6:"smpte170m", 9:"bt2020-ncl"}};
    const next = {fullRange: Boolean(record[10] & 128)};
    for (const [index, field] of ["primaries", "transfer", "matrix"].entries()) {
      const code = u(record, 4 + index * 2, 2);
      if (code === 2) continue; // Unspecified: defer to the bitstream.
      if (!mappings[field][code]) throw Error(`Unsupported HEIF ${field}: ${code}`);
      next[field] = mappings[field][code];
    }
    if (color && JSON.stringify(color) !== JSON.stringify(next)) throw Error("Conflicting HEIF color descriptions");
    color = next;
  }
  if (icc?.grayscale) {
    // Scalar ICC is not an RGB space or a YUV transport description.
    color ||= {}; // Obtain native range from SPS when nclx is absent.
  } else if (icc) {
    for (const field of ["primaries","transfer"])
      if (color?.[field] != null && color[field] !== icc[field]) throw Error(`HEIF ICC and nclx ${field} disagree`);
    color = {...color, primaries: icc.primaries, transfer: icc.transfer};
  }
  return {colorSpace: color, iccProfile: icc?.name, grayscale: Boolean(icc?.grayscale)};
}

function mergeColor(local, inherited) {
  if (inherited?.iccProfile && local.iccProfile && inherited.iccProfile !== local.iccProfile)
    throw Error("Grid and tile HEIF ICC profiles disagree");
  if (inherited?.colorSpace && local.colorSpace) for (const [field,value] of Object.entries(local.colorSpace))
    if (inherited.colorSpace[field] != null && inherited.colorSpace[field] !== value) throw Error("Grid and tile HEIF color descriptions disagree");
  return {colorSpace: inherited?.colorSpace ? {...local.colorSpace,...inherited.colorSpace} : local.colorSpace,
    iccProfile: inherited?.iccProfile || local.iccProfile, grayscale: Boolean(inherited?.grayscale || local.grayscale)};
}

/** Color of libheif's RGBA samples, before Canvas color management. Geometry is
 * already handled by libheif. Do not guess an unknown ICC or HDR transfer. */
export function imageRgbColorSpace(bytes, discovery, iid, inherited, visiting = new Set()) {
  if (visiting.has(iid)) throw Error("Cyclic HEIF image references");
  visiting.add(iid);
  try {
    const color = mergeColor(itemColorSpace(bytes, discovery, iid, false, true), inherited);
    if (discovery.infos.get(iid)?.type === "grid") {
      const tiles = discovery.refs.filter(ref => ref.type === "dimg" && ref.from === iid).flatMap(ref => ref.to);
      if (!tiles.length) throw Error("HEIF grid has no color source");
      const resolved = tiles.map(tile => imageRgbColorSpace(bytes, discovery, tile, color, visiting));
      if (resolved.some(next => next.primaries !== resolved[0].primaries || next.transfer !== resolved[0].transfer))
        throw Error("HEIF grid RGB color spaces disagree");
      return {...resolved[0], colorProfile: color.iccProfile || resolved[0].colorProfile};
    }
    const hvcc = propertyBoxBytes(bytes, discovery.props, iid, "hvcC");
    const resolved = completeDecoderColorSpace(hvcc?.subarray(8), color.colorSpace || {});
    if (!["bt709", "smpte432"].includes(resolved?.primaries)
      || !["iec61966-2-1", "linear", "bt709", "smpte170m"].includes(resolved?.transfer))
      throw Error("HEIC source RGB color space is unsupported");
    return {...resolved, colorProfile: color.iccProfile};
  } finally { visiting.delete(iid); }
}
/** RFC 6381 codec string derived from an HEVCDecoderConfigurationRecord. */
export function codecStringFromHvcc(record, sampleEntry = "hvc1") {
  if (!record || record.length < 13 || record[0] !== 1)
    throw new Error("Invalid hvcC decoder configuration");
  const profileSpace = record[1] >> 6;
  const tier = (record[1] & 0x20) ? "H" : "L";
  const profile = record[1] & 0x1f;
  // ISO 14496-15: compatibility flags are represented in reverse bit order.
  let reversed = 0;
  for (let bit = 0; bit < 32; bit++)
    if (record[2 + (bit >> 3)] & (0x80 >> (bit & 7))) reversed += 2 ** bit;
  const compat = reversed.toString(16).toUpperCase();
  const constraints = [...record.slice(6, 12)];
  while (constraints.length && constraints.at(-1) === 0) constraints.pop();
  const space = ["", "A", "B", "C"][profileSpace];
  const tail = constraints.map((v) => v.toString(16).toUpperCase().padStart(2, "0")).join(".");
  return `${sampleEntry}.${space}${profile}.${compat}.${tier}${record[12]}${tail ? `.${tail}` : ""}`;
}

export function decoderCodecCandidates(record, sampleEntry = 'hvc1') {
  const candidates = [codecStringFromHvcc(record, sampleEntry)];
  // The description and compressed payload stay untouched. Only advertise a
  // compatible decoding profile explicitly declared by the source hvcC.
  if ((record[1] & 31) === 3 && (record[1] >> 6) === 0) {
    for (const profile of [1, 2]) if (record[2] & (0x80 >> profile)) {
      const compatible = record.slice();compatible[1] = (compatible[1] & 0xe0) | profile;
      candidates.push(codecStringFromHvcc(compatible, sampleEntry));
    }
  }
  return candidates;
}

function displayCanvas(frame, angle, mirror, maxSide = Infinity, outputColorSpace = "srgb") {
  const sw = frame.displayWidth || frame.codedWidth || frame.width;
  const sh = frame.displayHeight || frame.codedHeight || frame.height;
  const swap = angle === 90 || angle === 270;
  const scale=Math.min(1,maxSide/Math.max(sw,sh)),w=sw*scale,h=sh*scale;
  const out = canvas(Math.max(1,Math.round(swap ? h : w)),Math.max(1,Math.round(swap ? w : h)));
  const ctx = out.getContext("2d", { willReadFrequently: true, colorSpace: outputColorSpace });
  if (!ctx || (outputColorSpace !== "srgb" && ctx.getContextAttributes?.().colorSpace !== outputColorSpace))
    throw Error(`HEIC source requires a ${outputColorSpace} canvas`);
  ctx.translate(out.width / 2, out.height / 2);
  // HEIF irot is counter-clockwise. Canvas uses the opposite visual direction because its
  // y-axis points down, so applying +angle here turns a native irot=270 mask by 180 degrees
  // from its intended display orientation.
  ctx.rotate(displayRotationRadians(angle));
  // HEIF imir describes the direction being reversed: 0 reverses vertical
  // coordinates, 1 horizontal. Match libheif's displayed pixel orientation.
  if (mirror === 0) ctx.scale(1, -1);
  else if (mirror === 1) ctx.scale(-1, 1);
  ctx.drawImage(frame, -w / 2, -h / 2, w, h);
  return out;
}

export function displayRotationRadians(angle) {
  return -angle * Math.PI / 180;
}

async function decodeItem(bytes, discovery, iid, applyTransform = true, maxSide = Infinity, diagnostics = null, renderFrame = null, onProgress, inheritedColorSpace, auxiliaryData = false, outputColorSpace = "srgb") {
  if (!globalThis.VideoDecoder || !globalThis.EncodedVideoChunk)
    throw new Error("HEVC WebCodecs decoder unavailable");
  const hvccBox = propertyBoxBytes(bytes, discovery.props, iid, "hvcC");
  if (!hvccBox || hvccBox.length <= 8) throw new Error(`Matte item ${iid} has no hvcC`);
  const description = hvccBox.slice(8);
  const itemType = discovery.infos.get(iid)?.type === "hev1" ? "hev1" : "hvc1";
  const [width, height] = dimensionsForItem(discovery.props, iid);
  const color = mergeColor(itemColorSpace(bytes, discovery, iid, auxiliaryData),inheritedColorSpace);
  const {iccProfile} = color;
  const dataPreview = color.grayscale && auxiliaryData;
  if (dataPreview && renderFrame) throw Error("Custom rendering cannot override grayscale auxiliary data preview");
  const colorSpace = completeDecoderColorSpace(description,color.colorSpace);
  const config = {
    codec: codecStringFromHvcc(description, itemType),
    codedWidth: width, codedHeight: height,
    description,
    hardwareAcceleration: "prefer-hardware",
    ...(colorSpace ? {colorSpace} : {}),
  };
  let support;
  const candidates = decoderCodecCandidates(description, itemType);
  for (const codec of candidates) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference']) {
      try { const probe = await VideoDecoder.isConfigSupported({...config, codec, hardwareAcceleration});
        if (probe.supported) { support = probe; break; }
      } catch { /* Try the remaining declared-compatible configurations. */ }
    }
    if (support) break;
  }
  if (!support) throw new Error(`HEVC decoder does not support ${candidates.join(' / ')}`);
  onProgress?.({stage: "codec", operation: "decode", source: "WebCodecs VideoDecoder", colorProfile: iccProfile});

  let frame, corrected, failure, count = 0;
  const decoder = new VideoDecoder({output(value) {
    count++;
    if (frame) value.close(); else frame = value;
  }, error(error) {failure = error;}});
  try {
    decoder.configure(support.config || config);
    decoder.decode(new EncodedVideoChunk({
      type: "key", timestamp: 0, duration: 1_000_000,
      data: extractItemData(bytes, discovery, iid),
    }));
    await decoder.flush();
    if (failure) throw failure;
    if (!frame || count !== 1) throw Error(`HEVC decoder returned ${count} frames, expected one`);
    corrected = dataPreview ? frame : await applyDecodedColorSpace(frame,colorSpace,iccProfile);
    const colorCorrection = corrected !== frame;
    if (colorCorrection) onProgress?.({stage:"codec",operation:"decode",source:"WebCodecs VideoDecoder",colorProfile:iccProfile,colorCorrection});
    if (diagnostics) diagnostics.push({itemId:iid, codec:(support.config || config).codec, format:corrected.format, colorSpace:corrected.colorSpace?.toJSON?.() ?? {primaries:corrected.colorSpace?.primaries,transfer:corrected.colorSpace?.transfer,matrix:corrected.colorSpace?.matrix,fullRange:corrected.colorSpace?.fullRange}, outerICCProvided:Boolean(iccProfile), iccProfile,colorCorrection,decoderColorSpace:frame.colorSpace?.toJSON?.()});
    let rendered;
    if (dataPreview) {
      const {width,height,rgba} = await readGrayscaleData(frame,colorSpace);
      rendered = canvas(width,height);
      const ctx = rendered.getContext("2d"), image = ctx.createImageData(width,height);
      image.data.set(rgba); ctx.putImageData(image,0,0);
      onProgress?.({stage:"codec",operation:"decode",source:"WebCodecs VideoDecoder",colorProfile:iccProfile,dataPreview:true});
    } else rendered=renderFrame ? await renderFrame(corrected) : corrected;
    const {angle,mirror} = applyTransform ? itemOrientation(bytes, discovery.props, iid) : {angle:0,mirror:null};
    try { return displayCanvas(rendered,angle,mirror,maxSide,outputColorSpace); }
    finally {if(renderFrame || dataPreview) rendered.width=rendered.height=0;}
  } finally {
    if (corrected && corrected !== frame) corrected.close();
    if (frame) frame.close();
    if(decoder.state !== 'closed') decoder.close();
  }
}

/** Grid descriptors may live in meta/idat rather than the file's mdat. */
export function readImageGrid(bytes, discovery, iid) {
  const item = discovery.iloc.items.get(iid);
  if (!item) throw new Error(`No iloc entry for grid ${iid}`);
  let descriptor;
  if (item.constructionMethod === 0) descriptor = extractItemData(bytes, discovery, iid);
  else if (item.constructionMethod === 1) {
    const idat = findChild(metaChildren(bytes, discovery.meta), "idat");
    if (!idat) throw new Error(`Grid ${iid} has no idat`);
    descriptor = concat(item.extents.map((extent) => {
      const start = idat.off + idat.hdr + item.baseOffset + extent.offset;
      const end = start + extent.length;
      if (start < idat.off + idat.hdr || end > idat.off + idat.size)
        throw new Error(`Grid ${iid} descriptor exceeds idat`);
      return bytes.slice(start, end);
    }));
  } else throw new Error(`Unsupported grid construction method ${item.constructionMethod}`);
  if (descriptor.length < 8 || descriptor[0] !== 0 || (descriptor[1] & ~1))
    throw new Error(`Invalid grid descriptor for item ${iid}`);
  const size = descriptor[1] & 1 ? 4 : 2;
  if (descriptor.length < 4 + size * 2) throw new Error(`Truncated grid descriptor ${iid}`);
  const grid = { rows: descriptor[2] + 1, columns: descriptor[3] + 1,
    width: u(descriptor, 4, size), height: u(descriptor, 4 + size, size) };
  if (!grid.width || !grid.height) throw new Error(`Invalid grid dimensions for item ${iid}`);
  const [width, height] = dimensionsForItem(discovery.props, iid);
  if (width !== grid.width || height !== grid.height)
    throw new Error(`Grid ${iid} descriptor and ispe dimensions disagree`);
  return grid;
}

export async function decodeWebCodecsImageItem(bytes, discovery, iid, {maxSide=Infinity,diagnostics=null,renderFrame=null,onProgress,auxiliaryData=false,outputColorSpace="srgb"} = {}) {
  if (!["grid", "hvc1", "hev1"].includes(discovery.infos.get(iid)?.type)) throw Error(`Unsupported HEVC image item ${iid}`);
  if (!(maxSide > 0)) throw Error("Invalid decoded image size");
  if (discovery.infos.get(iid)?.type !== "grid") return decodeItem(bytes, discovery, iid,true,maxSide,diagnostics,renderFrame,onProgress,undefined,auxiliaryData,outputColorSpace);
  const colorSpace = itemColorSpace(bytes, discovery, iid, auxiliaryData);
  const grid = readImageGrid(bytes, discovery, iid);
  const tiles = discovery.refs.filter((ref) => ref.type === "dimg" && ref.from === iid)
    .flatMap((ref) => ref.to);
  if (tiles.length !== grid.rows * grid.columns)
    throw new Error(`Grid ${iid} has an incorrect tile count`);
  const [tileWidth, tileHeight] = dimensionsForItem(discovery.props, tiles[0]);
  if (tileWidth <= 0 || tileHeight <= 0 ||
      grid.width <= (grid.columns - 1) * tileWidth || grid.width > grid.columns * tileWidth ||
      grid.height <= (grid.rows - 1) * tileHeight || grid.height > grid.rows * tileHeight)
    throw new Error(`Grid ${iid} has invalid tile geometry`);
  const scale=Math.min(1,maxSide/Math.max(grid.width,grid.height));
  const stitched = canvas(Math.max(1,Math.round(grid.width*scale)),Math.max(1,Math.round(grid.height*scale)));
  const scaleX=stitched.width/grid.width,scaleY=stitched.height/grid.height;
  const ctx = stitched.getContext("2d", {colorSpace: outputColorSpace});
  if (!ctx || (outputColorSpace !== "srgb" && ctx.getContextAttributes?.().colorSpace !== outputColorSpace))
    throw Error(`HEIC source requires a ${outputColorSpace} canvas`);
  try {
    for (let index = 0; index < tiles.length; index++) {
      const [width, height] = dimensionsForItem(discovery.props, tiles[index]);
      if (width !== tileWidth || height !== tileHeight)
        throw new Error(`Grid ${iid} has inconsistent tile dimensions`);
      const tile = await decodeItem(bytes, discovery, tiles[index], false,Infinity,diagnostics,renderFrame,onProgress,colorSpace,auxiliaryData,outputColorSpace);
      try {
        if (tile.width !== tileWidth || tile.height !== tileHeight)
          throw new Error(`Grid ${iid} decoded tile dimensions disagree with ispe`);
        // Canvas clips padded edge tiles to the grid's actual output dimensions.
        if(scale===1) ctx.drawImage(tile,(index%grid.columns)*tileWidth,Math.floor(index/grid.columns)*tileHeight);
        else ctx.drawImage(tile, (index % grid.columns) * tileWidth*scaleX,
          Math.floor(index / grid.columns) * tileHeight*scaleY,tileWidth*scaleX,tileHeight*scaleY);
      } finally { tile.width = tile.height = 0; }
    }
    const {angle,mirror} = itemOrientation(bytes, discovery.props, iid);
    return displayCanvas(stitched,angle,mirror,Infinity,outputColorSpace);
  } finally { stitched.width = stitched.height = 0; }
}

