// Synthetic thumbnails verify progress layout and timers without private HEIC files.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(fileURLToPath(new URL("../../web/", import.meta.url)));
const source = fs.readFileSync(path.join(root, "app.js"), "utf8");
const rowSource = source.slice(source.indexOf("function row(name)"), source.indexOf("function updateLinearProgress"));
const server = http.createServer((req, res) => {
  const filename = path.resolve(root, "." + new URL(req.url, "http://localhost").pathname.replace(/^\/$/, "/index.html"));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) {res.writeHead(404); res.end(); return;}
  res.writeHead(200, {"Content-Type": path.extname(filename) === ".js" ? "text/javascript"
    : path.extname(filename) === ".html" ? "text/html" : "application/octet-stream"});
  res.end(fs.readFileSync(filename));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined});
  const context = await browser.newContext({serviceWorkers: "block", locale: "zh-TW"});
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(async source => {
    const {STRINGS} = await import('./src/i18n.js');
    const list = document.getElementById('list');
    const create = new Function('document', 'list', 'T', source + ';return row;')(document, list, key => STRINGS.zh[key]);
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 112;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#b7d9de'; ctx.fillRect(0,0,112,112);
    ctx.fillStyle = '#5c9280'; ctx.fillRect(0,70,112,42);
    const original = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const ui = create('thumbnail-layout.png');
    ui.thumbnail(original, 'original.png', true);
    ctx.fillStyle = '#dfba78'; ctx.fillRect(22,22,35,35);
    const processed = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    ui.link(processed, 'processed.png'); ui.thumbnail(processed, 'processed.png');
    await Promise.all([...ui.el.querySelectorAll('img')].map(img => img.decode()));
    globalThis.layoutFixture = ui;
  }, rowSource);
  for (const width of [1000, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    const layout = await page.evaluate(() => {
      const ui = globalThis.layoutFixture, photos = ui.el.querySelector('.thumbnails'), status = ui.el.querySelector('.status');
      const top = photos.getBoundingClientRect().top;
      for (let i = 0; i < 60; i++) ui.set('step ' + i);
      const after = photos.getBoundingClientRect().top;
      const result = {top, after, first: status.firstElementChild.querySelector('.status-label').textContent,
        last: status.lastElementChild.querySelector('.status-label').textContent,
        photoBottom: photos.getBoundingClientRect().bottom, statusTop: status.getBoundingClientRect().top,
        statusHeight: status.clientHeight, overflow: status.scrollHeight > status.clientHeight, scrollTop: status.scrollTop,
        fits: document.documentElement.scrollWidth <= innerWidth};
      // Preserve the older messages a user is reading when a new status is prepended.
      status.scrollTop = 80;
      const anchor = [...status.children].find(el => el.getBoundingClientRect().top >= status.getBoundingClientRect().top);
      const anchorTop = anchor.getBoundingClientRect().top;
      ui.set('new while reading');
      result.anchorDelta = Math.abs(anchor.getBoundingClientRect().top - anchorTop);
      ui.set('complete', 'ok');
      return result;
    });
    assert.equal(layout.after, layout.top, `${width}px: progress cannot move thumbnails down`);
    assert.equal(layout.first, "step 59");
    assert.ok(layout.photoBottom <= layout.statusTop);
    assert.ok(layout.statusHeight <= 256 && layout.overflow);
    assert.equal(layout.scrollTop, 0);
    assert.equal(layout.fits, true);
    assert.ok(layout.anchorDelta <= 1, "new messages preserve the older content being read");
    await page.evaluate(() => {document.querySelector('.status').scrollTop = 0;});
  }
  const timing = await page.evaluate(source => {
    let now = 5000, id = 0;
    const timers = new Map(), list = document.createElement('div');
    const create = new Function('performance', 'setInterval', 'clearInterval', 'document', 'list', 'T', source + ';return row;')(
      {now: () => now}, fn => {timers.set(++id, fn); return id;}, key => timers.delete(key), document, list, key => key);
    const ui = create('timing'); ui.set('queued'); now += 1200;
    [...timers.values()].forEach(fn => fn()); ui.set('reading');
    const reset = list.querySelector('.status-time').textContent;
    now += 250; ui.update('reading progress'); now += 650; ui.set('encoding'); now += 2000;
    ui.set('short mask'); now += 14; ui.set('submillisecond'); now += .4; ui.set('complete', 'ok'); now += 10000;
    const stamps = [...list.querySelectorAll('.status-time')].map(el => el.textContent);
    const total = list.querySelector('.status-total-value');
    const completed = total.textContent;
    ui.set('correction queued'); now += 120; ui.set('correction encoding'); now += 345; ui.set('failed', 'err');
    const failed = list.querySelector('.status-total-value').textContent;
    ui.set('long run queued'); now += 61234; ui.set('complete', 'ok');
    const long = list.querySelector('.status-total-value').textContent;
    const fast = create('fast'); fast.set('queued'); now += .4; fast.set('failed', 'err');
    now += 10000;
    return {reset, stamps, completed, failed, long, fast: fast.el.querySelector('.status-total-value').textContent,
      frozen: total.textContent, timers: timers.size};
  }, rowSource);
  assert.deepEqual(timing, {reset: "0ms", stamps: ["—", "<1ms", "14ms", "2.000s", "900ms", "1.200s"],
    completed: "4.114s", failed: "465ms", long: "1:01.234", fast: "<1ms", frozen: "4.114s", timers: 0});
  await page.evaluate(async source => {
    const {STRINGS} = await import('./src/i18n.js');
    const create = new Function('document', 'list', 'T', source + ';return row;')(
      document, document.getElementById('list'), key => STRINGS.zh[key]);
    for (const name of ['old-photo.HEIC', 'iphone-photo.jpg', 'iphone-photo.JPEG', 'latest-photo.png']) create(name);
  }, rowSource);
  assert.deepEqual(await page.locator('#list > .row .name').allTextContents(),
    ['latest-photo.png', 'iphone-photo.JPEG', 'iphone-photo.jpg', 'old-photo.HEIC', 'thumbnail-layout.png']);
  assert.equal(await page.locator('.jpeg-hint').count(), 2);
  for (const width of [390, 320]) {
    await page.setViewportSize({width, height: 844});
    const card = page.locator('#list > .row').filter({has: page.getByText('iphone-photo.JPEG', {exact: true})});
    const name = await card.locator('.name').boundingBox(), hint = await card.locator('.jpeg-hint').boundingBox();
    assert.ok(hint.y >= name.y + name.height, 'JPEG reminder is below the filename');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.match(await card.locator('.jpeg-hint').textContent(), /iPhone.*顯示所選照片.*自動.*目前/);
  }
  const totals = await page.locator('.status-total-value').allTextContents();
  assert.match(await page.locator('.status-total').first().textContent(), /總耗時：/);
  await page.locator('#lang').click();
  assert.match(await page.locator('.jpeg-hint').first().textContent(), /iPhone.*Automatic.*Current/);
  assert.match(await page.locator('.status-total').first().textContent(), /Total time:/);
  assert.deepEqual(await page.locator('.status-total-value').allTextContents(), totals);
  await page.locator('#lang').click();
  assert.match(await page.locator('.status-total').first().textContent(), /總耗時：/);
  const artifacts = path.resolve('tests/web/.cache/result-layout'); fs.mkdirSync(artifacts, {recursive: true});
  await page.setViewportSize({width: 390, height: 844});
  await page.locator('.row').filter({has: page.getByText('iphone-photo.JPEG', {exact: true})}).scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(artifacts, 'mobile.png'), fullPage: true});
  console.log('Result layout passed: stable thumbnails at 320/390/1000px, preserved step timers, frozen totals including queue waiting, independent correction/error totals, and translated total labels.');
} finally {
  if (browser) await browser.close();
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
}
