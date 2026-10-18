// Unit tests: node --test tests/unit.test.js
// Loads the PRIVATE vessel JSON from LSV_VESSEL_JSON (default /workspace/lsv-private/lsv6-vessel-data.json).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), path = require('path');
const C = require('../calc.js');
const VPATH = process.env.LSV_VESSEL_JSON || '/workspace/lsv-private/lsv6-vessel-data.json';
const HAVE = fs.existsSync(VPATH);
const V = HAVE ? JSON.parse(fs.readFileSync(VPATH, 'utf8')) : null;
const near = (a, b, tol = 0.005) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} (tol ${tol})`);

// LSV-specific expected values live in a RESTRICTED fixture outside the app (LSV_EXPECTED).
const EPATH = process.env.LSV_EXPECTED || '/workspace/lsv-private/lsv6-sample-day.expected.json';
const HAVE_E = HAVE && fs.existsSync(EPATH);
const FX = HAVE_E ? JSON.parse(fs.readFileSync(EPATH, 'utf8')) : null;
const E = FX && FX.expect;
const R = () => Object.fromEntries(Object.entries(FX.readings).map(([k, [ft, inch]]) => [k, { ft, in: inch }]));
const row = (res, id) => res.rows.find(r => r.tank.id === id);
const SKIP = !HAVE_E && 'private vessel JSON / expected fixture not available';

test('private vessel JSON validates', { skip: SKIP }, () => {
  const v = C.validateVesselData(V); assert.equal(v.ok, true, v.errors.join('\n'));
});

test('sample day reproduces corrected spreadsheet', { skip: SKIP }, () => {
  const res = C.compute(V, R(), FX.drafts), s = res.summary;
  assert.equal(s.status, 'ok');
  near(res.trimIn, E.trimIn, 1e-12);
  near(s.totalGal, E.totalGal); near(s.usableGal, E.usableGal);
  near(s.neededToLimitGal, E.neededToLimitGal, 0.01); near(s.neededSumOfTanksGal, E.neededSumOfTanksGal, 0.01);
  near(s.capacityGal, E.capacityGal, 0.001); near(s.total.liters, E.liters, 0.01);
  near(s.total.shortTons, E.shortTons, 0.001); near(s.total.longTons, E.longTons, 0.001); near(s.total.metricTons, E.metricTons, 0.001);
  near(s.pct, E.pct, 1e-6); near(s.neededSum.longTons, E.neededSumLongTons, 0.001);
  for (const [id, g] of Object.entries(E.tankGal)) near(row(res, id).gal, g, 1e-4);
  near(row(res, E.trimTankId).totalIn, E.trimTankTotalIn, 1e-12);
  near(res.sludge.totalGal, E.sludgeGal, 1e-4);
  near(row(res, 'EG').neededPct, E.egNeededPct, 1e-6); // tables stored to 6 dp
});

test('out-of-range sounding -> OUT OF RANGE + CHECK SOUNDINGS', { skip: SKIP }, () => {
  const o = E.outOfRange, r = R(); r[o.tank] = { ft: o.ft, in: o['in'] };
  const res = C.compute(V, r, FX.drafts);
  assert.equal(row(res, o.tank).status, 'out'); assert.equal(row(res, o.tank).gal, null);
  assert.equal(res.summary.status, 'CHECK SOUNDINGS'); assert.equal(res.summary.totalGal, undefined);
  assert.deepEqual(res.summary.problems.map(p => p.id), [o.tank]);
  const r2 = R(); r2[o.wasteTank] = { ft: o.wasteFt, in: o.wasteIn };
  const res2 = C.compute(V, r2, FX.drafts);
  assert.equal(row(res2, o.wasteTank).status, 'out'); assert.equal(res2.sludge.status, 'CHECK SOUNDINGS'); assert.equal(res2.summary.status, 'ok');
  const r3 = R(); r3[Object.keys(FX.readings)[0]] = { ft: -1, in: 0 };
  assert.equal(C.compute(V, r3, FX.drafts).summary.status, 'CHECK SOUNDINGS');
});

test('blank fuel tank -> CHECK SOUNDINGS; table edge is in range', { skip: SKIP }, () => {
  const o = E.outOfRange, r = R(); delete r.DT;
  assert.equal(C.compute(V, r, FX.drafts).summary.status, 'CHECK SOUNDINGS');
  const r2 = R(); r2[o.edgeTank] = { ft: o.edgeFt, in: o.edgeIn };
  const res = C.compute(V, r2, {});
  assert.equal(row(res, o.edgeTank).status, 'ok'); near(row(res, o.edgeTank).gal, o.edgeGal, 1e-6);
});

test('trim needs all four draft fields; sign follows constants', { skip: SKIP }, () => {
  assert.equal(C.trimCorrection(V, { bowFt: 10, bowIn: '', sternFt: 11, sternIn: 0 }), 0);
  const v2 = JSON.parse(JSON.stringify(V)); v2.constants.trimSign = 'bow-minus-stern';
  near(C.trimCorrection(v2, FX.drafts), -E.trimIn, 1e-12);
});

test('fuel converter matches spreadsheet formulas', { skip: !HAVE }, () => {
  let c = C.convert(V, 1000, 'gal', '');
  near(c.ppg, 7.175, 1e-12); near(c.bbl, 1000 / 42, 1e-9); near(c.mt, 1000 * 7.175 / 2204.62, 1e-9); near(c.l, 3785.3, 1e-9); near(c.m3, 3.785, 1e-9); near(c.ft3, 1000 / 7.48051948, 1e-9);
  c = C.convert(V, 10, 'lt', 0.85); near(c.ppg, 0.85 * 8.345, 1e-12); near(c.gal, 10 * 2240 / (0.85 * 8.345), 1e-9);
  c = C.convert(V, 100, 'bbl', ''); near(c.gal, 4200, 1e-9);
  c = C.convert(V, 3785.3, 'l', ''); near(c.gal, 1000, 1e-9);
});

test('burn-rate analysis (from ship logs)', () => {
  const rounds = [
    { ts: '2026-10-01T08:00:00Z', robGal: 100000, usableGal: 95384, engineHours: 1000, receivedGal: 0, transferredOffGal: 0 },
    { ts: '2026-10-02T08:00:00Z', robGal: 95000, usableGal: 90384, engineHours: 1020, receivedGal: 0, transferredOffGal: 0 },
    { ts: '2026-10-03T08:00:00Z', robGal: 100000, usableGal: 95384, engineHours: 1040, receivedGal: 10000, transferredOffGal: 0 }
  ];
  const a = C.burnAnalysis(rounds, 10);
  assert.equal(a.label, 'from ship logs, not TM data');
  near(a.intervals[0].rateGph, 250, 1e-9); near(a.intervals[1].consumedGal, 5000, 1e-9);
  near(a.avgRateGph, 250, 1e-9); near(a.enduranceHours, 95384 / 250, 1e-9); near(a.rangeNm, 95384 / 250 * 10, 1e-6);
  const b = C.burnAnalysis([{ ts: '2026-10-01T00:00:00Z', robGal: 1000, usableGal: 900, engineHours: null }, { ts: '2026-10-01T10:00:00Z', robGal: 900, usableGal: 800, engineHours: null }], '');
  assert.equal(b.intervals[0].basis, 'clock hours'); near(b.avgRateGph, 10, 1e-9); assert.equal(b.rangeNm, undefined);
  const csv = C.logToCSV(rounds, 10);
  assert.match(csv, /not TM data/); assert.match(csv, /average_rate_gph,250/);
});

test('validator rejects bad data and accepts fictional example', () => {
  const ex = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'example-vessel-FICTIONAL.json'), 'utf8'));
  assert.equal(C.validateVesselData(ex).ok, true);
  const bad = JSON.parse(JSON.stringify(ex));
  bad.schema = 'x'; bad.tanks[0].gallons[5] = -1; bad.tanks[1].id = 'F1'; bad.tanks[2].type = 'water'; bad.tanks[0].maxIn = 47;
  const v = C.validateVesselData(bad);
  assert.equal(v.ok, false); assert.ok(v.errors.length >= 5, v.errors.join('\n'));
  assert.equal(C.validateVesselData(null).ok, false);
  assert.equal(C.validateVesselData({ schema: 'lsv-fuel-vessel/1', vessel: { name: 'x' }, distributionMarking: '', constants: {}, tanks: [] }).ok, false);
  const dec = JSON.parse(JSON.stringify(ex)); dec.tanks[0].gallons[10] = 0;
  assert.match(C.validateVesselData(dec).errors.join(' '), /must not decrease/);
});

test('app bundle contains no vessel data', () => {
  const root = path.join(__dirname, '..'), bad = [];
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    if (['node_modules', 'screenshots'].includes(e.name)) return;
    const p = path.join(d, e.name); if (e.isDirectory()) return walk(p);
    if (!/\.(js|json|html|css|webmanifest|md)$/.test(e.name)) return;
    const t = fs.readFileSync(p, 'utf8');
    if (/57,?913|15,?716|31,?433|17,?583|16,?764|17,?742|173,?400|100,?894/.test(t)) bad.push(p);
  });
  walk(root);
  assert.deepEqual(bad, [], 'vessel capacities found in: ' + bad.join(', '));
});
