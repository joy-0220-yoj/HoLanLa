// Container-only unit tests use our own browser-generated codec fixtures.
// Real encoder/round-trip/cache tests are in generated-profile-browser.mjs.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {generateSyntheticHevc} from '../../web/src/synthetic-hevc.js?v=0.8.0';
const fixture = JSON.parse(fs.readFileSync(new URL('./synthetic-hevc.fixture.json', import.meta.url)));
export const syntheticAssets = await generateSyntheticHevc(null, async (pixels, options) => {
  assert.ok(pixels.every(value => options.pixelFormat === 'gray' ? value === 0 : [504,512].includes(value)));
  const asset = options.pixelFormat !== 'gray' ? fixture.assets.delta
    : options.width === 768 ? fixture.assets.textureMask : fixture.assets.mask;
  assert.equal(asset.width, options.width); assert.equal(asset.height, options.height);
  if (options.pixelFormat !== 'gray') {
    assert.equal(options.primaries, 'smpte432'); assert.equal(options.transfer, 'linear');
    assert.equal(asset.sps.primaries, 12); assert.equal(asset.sps.transfer, 8);
  }
  return {...asset, hvcc: new Uint8Array(asset.hvcc), payload: new Uint8Array(asset.payload)};
});
