// Pinned public encoder runtime. Photo/profile bytes are never downloaded here.
export const FFMPEG_VERSION = '0.12.10';
const base = `https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@${FFMPEG_VERSION}/dist/umd`;
export const FFMPEG_ASSETS = Object.freeze([
  {url: `${base}/ffmpeg-core.js`, sha256: '62f5f5f468a37861da12c4581c321bb5ca8ba2f7b776377e08dd2ab72de293f9'},
  {url: `${base}/ffmpeg-core.wasm`, sha256: 'be2c97605366b78f3f13e21b52e81a55a79e1f29c133b03a68ec187b1a2ec41a'},
  {url: `${base}/ffmpeg-core.worker.js`, sha256: '97322a227c5f3d5ccfd0d0825890a6deeba137106a09b633ca75cadf49ddd2cb'},
]);
