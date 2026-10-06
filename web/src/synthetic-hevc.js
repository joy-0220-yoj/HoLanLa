import {encodeHevcPixels, onEncoderRelease} from './ffmpeg-hevc.js?v=0.8.0';
import {box, concat, be} from './box.js?v=0.8.0';

let assets, completed;
onEncoderRelease(() => { assets = null; completed = null; });
export function resetSyntheticHevc() { assets = null; completed = null; }
export function getSyntheticTextureMatte() {
  if (!completed) throw Error('Synthetic HEVC assets not initialized; await generateSyntheticHevc() first');
  return completed.textureMask;
}
export function generateSyntheticHevc(onProgress, encoder = encodeHevcPixels) {
  if (!assets) assets = (async () => {
    // HEVC planes are generated from numeric constants, never photo/ZIP inputs.
    const neutral = new Uint16Array(512 * 512 * 3 / 2).fill(512);
    neutral.fill(504, 0, 512 * 512);
    // StyleDeltaMap is P3-linear. Tagging these same Y=504 samples as BT.709
    // shifts the intended ~0.502 linear neutral after colour conversion (~0.192
    // in the independent FFmpeg/zscale reference test).
    const delta = await encoder(neutral, {width: 512, height: 512,
      primaries: 'smpte432', transfer: 'linear', matrix: 'bt709', fullRange: false}, onProgress);
    if (delta.sps && (delta.sps.primaries !== 12 || delta.sps.transfer !== 8
        || delta.sps.matrix !== 1 || delta.sps.fullRange))
      throw Error('Synthetic StyleDeltaMap must be Display P3 linear, limited-range BT.709 YUV');
    const deltaColr = box('colr', concat([new TextEncoder().encode('nclx'), be(12, 2), be(8, 2), be(1, 2), new Uint8Array([0])]));
    const mask = await encoder(new Uint8Array(2016 * 1512), {
      width: 2016, height: 1512, pixelFormat: 'gray', fullRange: true,
    }, onProgress);
    const textureMask = await encoder(new Uint8Array(768 * 576), {
      width: 768, height: 576, pixelFormat: 'gray', fullRange: true,
    }, onProgress);
    const monoPixi = box('pixi', new Uint8Array([0, 0, 0, 0, 1, 8]));
    const colr = box('colr', concat([new TextEncoder().encode('nclx'), be(1, 2), be(1, 2), be(1, 2), new Uint8Array([128])]));
    completed = {delta: {...delta, colr: deltaColr}, mask: {...mask, pixi: monoPixi, colr}, textureMask: {...textureMask, pixi: monoPixi, colr}};
    return completed;
  })().catch(error => { assets = null; throw error; });
  return assets;
}
