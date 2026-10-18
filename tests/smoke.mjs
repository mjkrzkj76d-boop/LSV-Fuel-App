// Headless browser smoke test (Playwright + system Chrome).
// node tests/smoke.mjs   (env: LSV_VESSEL_JSON, CHROME_PATH)
import { chromium } from 'playwright-core';
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '..');
const VPATH = process.env.LSV_VESSEL_JSON || '/workspace/lsv-private/lsv6-vessel-data.json';
const FX = JSON.parse(fs.readFileSync(process.env.LSV_EXPECTED || '/workspace/lsv-private/lsv6-sample-day.expected.json', 'utf8')), D = FX.expect.display, O = FX.expect.outOfRange;
const SHOTS = path.join(root, 'screenshots'); fs.mkdirSync(SHOTS, { recursive: true });
const server = require('./serve.js'); await new Promise(r => server.listening ? r() : server.on('listening', r));
const URL0 = 'http://localhost:8765/';
const results = []; const ok = (name, cond, extra = '') => { results.push([cond ? 'PASS' : 'FAIL', name, extra]); if (!cond) process.exitCode = 1; };

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
const page = await ctx.newPage();
const external = [], consoleErrors = [];
page.on('request', r => { const u = new URL(r.url()); if (!['localhost', '127.0.0.1'].includes(u.hostname) && !u.protocol.startsWith('blob') && !u.protocol.startsWith('data')) external.push(r.url()); });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', e => consoleErrors.push(String(e)));
page.on('dialog', d => d.accept());
const shot = async (n, full = true) => { await page.screenshot({ path: path.join(SHOTS, n), fullPage: full }); };
const txt = async sel => (await page.locator(sel).innerText()).replace(/\s+/g, ' ');

// 1. empty state
await page.goto(URL0); await page.waitForSelector('#emptyState:not(.hidden)');
ok('empty state shown on first run', await page.isVisible('#emptyState'));
ok('tabs hidden with no data', !(await page.isVisible('#tabs')));
await shot('01-empty-state.png');

// 2. bad import rejected (paste)
await page.click('#pasteBoxEmpty summary');
await page.fill('#pasteEmpty', '{"schema":"lsv-fuel-vessel/1","vessel":{"name":""},"tanks":[]}');
await page.click('#btnPasteEmpty');
ok('invalid JSON rejected with errors', /rejected/.test(await txt('#importMsgEmpty')));
await shot('02-import-rejected.png');

// 3. import via file picker
const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnImportEmpty')]);
await fc.setFiles(VPATH);
await page.waitForSelector('#tabs:not(.hidden)');
ok('vessel imported, header shows name', /LSV/.test(await txt('#hdrName')));
ok('distribution marking shown in header', /DISTRIBUTION C/.test(await txt('#hdrMarking')));
ok('CHECK SOUNDINGS before entries', /CHECK SOUNDINGS/.test(await txt('#summaryCard')));
await shot('03-imported-check-soundings.png', false);

// 4. sample day
const S = FX.readings;
for (const [id, [ft, inch]] of Object.entries(S)) {
  await page.fill(`input[data-tank="${id}"][data-field="ft"]`, String(ft));
  await page.fill(`input[data-tank="${id}"][data-field="in"]`, String(inch));
}
for (const [k, v] of Object.entries(FX.drafts)) await page.fill(`[data-draft="${k}"]`, String(v));
await page.fill('#roundDate', '2024-04-17T08:00');
const sum = await txt('#summaryCard');
ok('total ' + D.total + ' gal', sum.includes(D.total), sum.slice(0, 160));
ok('usable ' + D.usable, sum.includes(D.usable));
ok('needed for limit ' + D.needed, sum.includes(D.needed));
ok('trim ' + D.trim + '"', (await txt('#trimVal')).startsWith(D.trim));
ok('H/O ' + D.ho, (await txt('#gal-HO')).includes(D.ho));
await shot('04-soundings-sample-day.png');
await page.click('#tabs button[data-tab="needed"]');
ok('needed-to-fill sum ' + D.neededSum, (await txt('#neededSummary')).includes(D.neededSum));
await shot('05-needed-to-fill.png');

// 5. out of range
await page.click('#tabs button[data-tab="soundings"]');
await page.fill(`input[data-tank="${O.tank}"][data-field="ft"]`, String(O.ft)); await page.fill(`input[data-tank="${O.tank}"][data-field="in"]`, String(O['in']));
ok(O.tank + ' shows OUT OF RANGE', (await txt('#gal-' + O.tank)) === 'OUT OF RANGE');
ok('summary shows CHECK SOUNDINGS', /CHECK SOUNDINGS/.test(await txt('#summaryCard')));
await page.locator('#tank-' + O.tank).scrollIntoViewIfNeeded();
await shot('06-out-of-range.png', false);
await page.evaluate(() => window.scrollTo(0, 0)); await shot('06b-check-soundings-summary.png', false);
await page.fill(`input[data-tank="${O.tank}"][data-field="ft"]`, String(S[O.tank][0])); await page.fill(`input[data-tank="${O.tank}"][data-field="in"]`, String(S[O.tank][1]));

// 6. burn log: two rounds
await page.click('#tabs button[data-tab="log"]');
await page.fill('#logHours', '1000'); await page.click('#btnSaveRound');
await page.click('#tabs button[data-tab="soundings"]');
await page.fill('#roundDate', '2024-04-17T20:00');
const R2 = FX.expect.secondRound; await page.fill(`input[data-tank="${R2.tank}"][data-field="ft"]`, String(R2.ft)); await page.fill(`input[data-tank="${R2.tank}"][data-field="in"]`, String(R2['in']));
await page.click('#tabs button[data-tab="log"]');
await page.fill('#logHours', '1012'); await page.fill('#speedKn', '10'); await page.click('#btnSaveRound');
const burn = await txt('#burnSummary');
ok('burn summary labeled "from ship logs, not TM data"', /not TM data/i.test(burn));
ok('burn rate computed', new RegExp('Avg burn \\(gal\\/h\\) ' + D.burn.replace('.', '\\.'), 'i').test(burn), burn.slice(0, 200));
await shot('07-burn-log.png');
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnLogCSV')]);
const csvPath = path.join(SHOTS, '..', 'tests', 'last-burn-log.csv'); await dl.saveAs(csvPath);
ok('CSV export', /not TM data/.test(fs.readFileSync(csvPath, 'utf8')));
fs.unlinkSync(csvPath);

// 7. converter
await page.click('#tabs button[data-tab="convert"]');
await page.fill('#convVal', '1000');
ok('converter 1000 gal = 3,785.3000 L', (await txt('#convOut')).includes('3,785.3000'));
await shot('08-converter.png');

// 8. data tab
await page.click('#tabs button[data-tab="data"]');
ok('data tab lists tanks', /Tanks \d+ \(\d+ fuel\)/i.test(await txt('#dataInfo')));
await shot('09-data-tab.png');

// 9. offline reload
await page.evaluate(async () => { await navigator.serviceWorker.ready; });
await page.reload(); await page.evaluate(async () => { await navigator.serviceWorker.ready; });
ok('service worker controls page', await page.evaluate(() => !!navigator.serviceWorker.controller));
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.click('#tabs button[data-tab="soundings"]');
const off = await txt('#summaryCard');
ok('offline reload works and keeps data', /LSV/.test(await txt('#hdrName')) && /fuel oil on board/i.test(off), off.slice(0, 120));
await shot('10-offline-reload.png', false);
await ctx.setOffline(false);

// 10. delete data -> empty state
await page.click('#tabs button[data-tab="data"]'); await page.click('#btnDelete');
ok('delete returns to empty state', await page.isVisible('#emptyState'));
ok('vessel removed from storage', await page.evaluate(() => localStorage.getItem('lsvfuel.vessel.v1') === null));

ok('no external network requests', external.length === 0, external.join(' '));
ok('no console errors', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close(); server.close();
for (const r of results) console.log(r[0], '-', r[1], r[2] && r[0] === 'FAIL' ? '(' + r[2] + ')' : '');
console.log(results.filter(r => r[0] === 'PASS').length + '/' + results.length + ' passed');
