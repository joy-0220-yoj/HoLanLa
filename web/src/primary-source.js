import { discoverHeic, discoverImageItems, removeItems, parseIloc, extractItemData, parseIpcoIpma, setItemPropertyAssociations } from "./heif.js?v=0.7.0";
import { topBox, metaChildren, findChild, boxes, u, concat, be, bytesEqual } from "./box.js?v=0.7.0";

/** Expose one auxiliary (and its grid tiles) as a standalone primary for libheif.
 * Compressed samples, color descriptions and transforms are preserved unchanged. */
export function isolateImageItem(data, iid, source = discoverImageItems(data)) {
  const keep = new Set(), active = new Set();
  const visit = id => {
    if (active.has(id)) throw Error("Cyclic image grid");
    if (keep.has(id)) return;
    const type = source.infos.get(id)?.type;
    if (!["hvc1", "hev1", "grid"].includes(type)) throw Error(`Unsupported image item ${id}: ${type}`);
    active.add(id); keep.add(id);
    if (type === "grid") for (const ref of source.refs.filter(r => r.type === "dimg" && r.from === id))
      for (const tile of ref.to) visit(tile);
    active.delete(id);
  };
  visit(iid);
  const {off, size} = source.meta;
  let meta = removeItems(data.slice(off, off + size), [...source.infos.keys()].filter(id => !keep.has(id)));
  let m = topBox(meta, "meta"), pitm = findChild(metaChildren(meta, m), "pitm");
  const idSize = meta[pitm.off + pitm.hdr] === 0 ? 2 : 4;
  if (iid >= 2 ** (8 * idSize)) throw Error("Image item exceeds pitm capacity");
  meta.set(be(iid, idSize), pitm.off + pitm.hdr + 4);
  const props = parseIpcoIpma(meta, m);
  // An auxiliary must no longer be marked as hidden or auxiliary when made primary.
  for (const id of keep) {
    const associations = (props.associations.get(id) || [])
      .filter(a => props.properties[a.index - 1]?.type !== "auxC")
      .map(a => [a.index, a.essential]);
    meta = setItemPropertyAssociations(meta, id, associations);
  }
  const growth = meta.length - size, iloc = parseIloc(meta, topBox(meta, "meta"));
  for (const item of iloc.items.values()) if (item.constructionMethod === 0) {
    if (item.baseOffset >= off + size && iloc.baseOffsetSize && item.extents.length) {
      const base = item.baseOffset + growth;
      if (base < 0 || base >= 2 ** (8 * iloc.baseOffsetSize)) throw Error("Image base offset exceeds capacity");
      const basePos = item.extents[0].offsetPos - iloc.indexSize - 2 - iloc.baseOffsetSize;
      meta.set(be(base, iloc.baseOffsetSize), basePos);
      continue;
    }
    for (const extent of item.extents) {
      if (item.baseOffset + extent.offset < off + size) throw Error("Image payload overlaps metadata");
      const offset = extent.offset + growth;
      if (!iloc.offsetSize || offset < 0 || offset >= 2 ** (8 * iloc.offsetSize)) throw Error("Image offset exceeds capacity");
      meta.set(be(offset, iloc.offsetSize), extent.offsetPos);
    }
  }
  // infe's item_hidden flag can prevent a promoted auxiliary becoming a top-level image.
  m = topBox(meta, "meta");
  const iinf = findChild(metaChildren(meta, m), "iinf");
  const countSize = meta[iinf.off + iinf.hdr] === 0 ? 2 : 4;
  for (const entry of boxes(meta, iinf.off + iinf.hdr + 4 + countSize, iinf.off + iinf.size))
    if (entry.type === "infe" && u(meta, entry.off + entry.hdr + 4, meta[entry.off + entry.hdr] === 3 ? 4 : 2) === iid)
      meta[entry.off + entry.hdr + 3] &= 0xfe;
  const result = concat([data.subarray(0, off), meta, data.subarray(off + size)]);
  const check = discoverImageItems(result);
  if (check.primary !== iid) throw Error("Image isolation chose the wrong primary");
  for (const id of keep) if (!bytesEqual(extractItemData(data, source, id), extractItemData(result, check, id)))
    throw Error(`Image isolation changed payload ${id}`);
  return result;
}

/** Decode the preserved SDR primary, without asking the browser to apply HDR/styles. */
export function isolatePrimaryImage(data) {
  const source = discoverHeic(data), keep = new Set([source.primary, ...source.primaryTiles]);
  const removed = [...source.infos.keys()].filter(id => !keep.has(id));
  const { off, size } = source.meta;
  const meta = removeItems(data.slice(off, off + size), removed);
  const growth = meta.length - size, iloc = parseIloc(meta, topBox(meta, "meta"));
  for (const item of iloc.items.values()) if (item.constructionMethod === 0) for (const extent of item.extents) {
    if (item.baseOffset + extent.offset < off + size) throw new Error("Primary decode payload overlaps metadata");
    const offset = extent.offset + growth;
    if (!iloc.offsetSize || offset < 0 || offset >= 2 ** (iloc.offsetSize * 8)) throw new Error("Primary decode offset exceeds capacity");
    meta.set(be(offset, iloc.offsetSize), extent.offsetPos);
  }
  const result = concat([data.subarray(0, off), meta, data.subarray(off + size)]), check = discoverHeic(result);
  if (check.hdrGrid !== null || check.deltaGrid !== null || check.stylesItem !== null || check.linearThumb !== null)
    throw new Error("Primary decode isolation failed");
  for (const id of keep) if (!bytesEqual(extractItemData(data, source, id), extractItemData(result, check, id)))
    throw new Error(`Primary decode payload changed: ${id}`);
  return result;
}
