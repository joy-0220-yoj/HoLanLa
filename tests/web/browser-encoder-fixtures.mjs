import fs from 'node:fs';
import path from 'node:path';

export async function routeBrowserEncoder(context) {
  await context.route('https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/umd/*', route => {
    if (!process.env.FFMPEG_CORE_DIR) return route.continue();
    const name = route.request().url().split('/').pop(), direct = path.join(process.env.FFMPEG_CORE_DIR, name), prefixed = path.join(process.env.FFMPEG_CORE_DIR, 'mt-' + name);
    return route.fulfill({path: fs.existsSync(prefixed) ? prefixed : direct,
      headers: {'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'}});
  });
}
