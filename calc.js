/* LSV Fuel Soundings - calculation engine and vessel-data validator.
 * Pure functions, no DOM. Works in the browser (window.LSVCalc) and in Node (require).
 * Formulas mirror "My Fuel Calculator (Plus) - corrected.xlsx".
 */
(function (root) {
  'use strict';
  var SCHEMA_ID = 'lsv-fuel-vessel/1';
  var TYPES = ['fuel', 'waste', 'lube', 'hydraulic'];
  var EPS = 1e-9;

  function isNum(x) { return typeof x === 'number' && isFinite(x); }
  function blank(x) { return x === null || x === undefined || x === ''; }
  function toNum(x) { if (blank(x)) return null; var n = Number(x); return isFinite(n) ? n : NaN; }

  /* ---------------- validation ---------------- */
  function validateVesselData(d) {
    var errors = [], warnings = [];
    function err(m) { errors.push(m); }
    if (!d || typeof d !== 'object' || Array.isArray(d)) { return { ok: false, errors: ['Top level must be a JSON object.'], warnings: [] }; }
    if (d.schema !== SCHEMA_ID) err('"schema" must be "' + SCHEMA_ID + '" (got ' + JSON.stringify(d.schema) + ').');
    if (!d.vessel || typeof d.vessel.name !== 'string' || !d.vessel.name.trim()) err('"vessel.name" is required (non-empty string).');
    if (typeof d.distributionMarking !== 'string') err('"distributionMarking" is required (string; may be empty if the data is public).');
    var c = d.constants;
    if (!c || typeof c !== 'object') { err('"constants" object is required.'); c = {}; }
    ['densityLbPerGal', 'litersPerGal', 'trimVesselLengthFt', 'trimTankLengthFt', 'trimDivisor', 'fuelTotalFillLimitPct'].forEach(function (k) {
      if (!isNum(c[k]) || c[k] <= 0) err('constants.' + k + ' must be a positive number.');
    });
    ['waterLbPerGal', 'cubicMetersPerGal', 'galPerCubicFoot', 'galPerBarrel', 'lbPerShortTon', 'lbPerLongTon', 'lbPerMetricTon'].forEach(function (k) {
      if (c[k] !== undefined && (!isNum(c[k]) || c[k] <= 0)) err('constants.' + k + ' must be a positive number if given.');
    });
    if (c.trimSign !== undefined && c.trimSign !== 'stern-minus-bow' && c.trimSign !== 'bow-minus-stern') err('constants.trimSign must be "stern-minus-bow" or "bow-minus-stern".');
    if (c.lookup !== undefined && c.lookup !== 'floor' && c.lookup !== 'interpolate') err('constants.lookup must be "floor" or "interpolate".');
    if (isNum(c.fuelTotalFillLimitPct) && c.fuelTotalFillLimitPct > 100) err('constants.fuelTotalFillLimitPct must be <= 100.');
    if (!Array.isArray(d.tanks) || !d.tanks.length) { err('"tanks" must be a non-empty array.'); return { ok: false, errors: errors, warnings: warnings }; }
    if (d.tanks.length > 100) err('Too many tanks (max 100).');
    var ids = {}, nFuel = 0;
    d.tanks.forEach(function (t, i) {
      var p = 'tanks[' + i + ']' + (t && t.id ? ' (' + t.id + ')' : '');
      if (!t || typeof t !== 'object') { err(p + ' must be an object.'); return; }
      if (typeof t.id !== 'string' || !/^[A-Za-z0-9_-]{1,24}$/.test(t.id)) err(p + ': id must be 1-24 chars [A-Za-z0-9_-].');
      else if (ids[t.id]) err(p + ': duplicate id.'); else ids[t.id] = 1;
      if (typeof t.name !== 'string' || !t.name.trim()) err(p + ': name is required.');
      if (TYPES.indexOf(t.type) < 0) err(p + ': type must be one of ' + TYPES.join(', ') + '.');
      if (t.type === 'fuel') nFuel++;
      if (t.capacityGal !== null && (!isNum(t.capacityGal) || t.capacityGal <= 0)) err(p + ': capacityGal must be a positive number or null.');
      if (t.fillLimitPct !== null && (!isNum(t.fillLimitPct) || t.fillLimitPct <= 0 || t.fillLimitPct > 100)) err(p + ': fillLimitPct must be 0-100 or null.');
      if (t.fillLimitPct !== null && t.capacityGal === null) err(p + ': fillLimitPct needs a capacityGal.');
      if (!isNum(t.unpumpableGal) || t.unpumpableGal < 0) err(p + ': unpumpableGal must be a number >= 0.');
      if (typeof t.trimCorrected !== 'boolean') err(p + ': trimCorrected must be true or false.');
      if (t.stepIn !== 0.25) err(p + ': stepIn must be 0.25.');
      if (!isNum(t.maxIn) || t.maxIn <= 0) err(p + ': maxIn must be a positive number.');
      if (!Array.isArray(t.gallons) || t.gallons.length < 2) { err(p + ': gallons must be an array of at least 2 numbers.'); return; }
      if (t.gallons.length > 4000) err(p + ': gallons table too long (max 4000 rows).');
      if (isNum(t.maxIn) && Math.abs((t.gallons.length - 1) * 0.25 - t.maxIn) > EPS) err(p + ': gallons has ' + t.gallons.length + ' rows; expected maxIn/0.25+1 = ' + (t.maxIn / 0.25 + 1) + '.');
      for (var j = 0; j < t.gallons.length; j++) {
        if (!isNum(t.gallons[j]) || t.gallons[j] < 0) { err(p + ': gallons[' + j + '] must be a number >= 0.'); break; }
        if (j && t.gallons[j] < t.gallons[j - 1] - EPS) { err(p + ': gallons must not decrease (row ' + j + ', ' + (j * 0.25) + ' in).'); break; }
      }
      if (isNum(t.capacityGal) && Array.isArray(t.gallons) && t.gallons[t.gallons.length - 1] > t.capacityGal * 1.01)
        warnings.push(p + ': table maximum ' + t.gallons[t.gallons.length - 1] + ' exceeds capacityGal ' + t.capacityGal + ' by >1%.');
    });
    if (!nFuel) err('At least one tank must have type "fuel".');
    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  /* ---------------- core math ---------------- */
  function constants(d) {
    var c = d.constants, o = {};
    o.density = c.densityLbPerGal; o.water = c.waterLbPerGal || 8.345; o.lpg = c.litersPerGal;
    o.m3 = c.cubicMetersPerGal || 0.003785; o.ft3 = c.galPerCubicFoot || 7.48051948; o.bbl = c.galPerBarrel || 42;
    o.st = c.lbPerShortTon || 2000; o.lt = c.lbPerLongTon || 2240; o.mt = c.lbPerMetricTon || 2204.62;
    o.fill = c.fuelTotalFillLimitPct / 100; o.lookup = c.lookup || 'floor';
    return o;
  }

  /** Trim correction (inches) added to trim-corrected tanks. Mirrors Soundings!K29.
   *  Returns 0 unless all four draft fields are filled. */
  function trimCorrection(d, drafts) {
    if (!drafts) return 0;
    var bf = toNum(drafts.bowFt), bi = toNum(drafts.bowIn), sf = toNum(drafts.sternFt), si = toNum(drafts.sternIn);
    if ([bf, bi, sf, si].some(function (x) { return x === null || isNaN(x); })) return 0;
    var c = d.constants, bow = bf + bi / 12, stern = sf + si / 12;
    var diff = (c.trimSign === 'bow-minus-stern') ? bow - stern : stern - bow;
    return (diff * (c.trimTankLengthFt / c.trimVesselLengthFt) * 12) / c.trimDivisor;
  }

  /** Gallons for a sounding in inches. Returns {status:'ok'|'out', gal}. */
  function lookup(tank, inches, mode) {
    if (inches < -EPS || inches > tank.maxIn + EPS) return { status: 'out', gal: null };
    var x = Math.max(0, Math.min(inches, tank.maxIn)) / tank.stepIn;
    var i = Math.floor(x + EPS);
    if (mode === 'interpolate' && i < tank.gallons.length - 1) {
      var f = x - i; return { status: 'ok', gal: tank.gallons[i] + f * (tank.gallons[i + 1] - tank.gallons[i]) };
    }
    return { status: 'ok', gal: tank.gallons[Math.min(i, tank.gallons.length - 1)] };
  }

  /** Full computation. readings = {tankId: {ft, in}}, drafts = {bowFt,bowIn,sternFt,sternIn} */
  function compute(d, readings, drafts) {
    var k = constants(d), trim = trimCorrection(d, drafts), rows = [];
    readings = readings || {};
    d.tanks.forEach(function (t) {
      var r = readings[t.id] || {}, ft = toNum(r.ft), inch = toNum(r.in), row = { tank: t, status: 'ok' };
      if (ft === null && inch === null) { row.status = 'blank'; }
      else if (isNaN(ft) || isNaN(inch)) { row.status = 'invalid'; }
      else {
        row.rawIn = (ft || 0) * 12 + (inch || 0);
        row.totalIn = row.rawIn + (t.trimCorrected ? trim : 0);
        var L = lookup(t, row.totalIn, k.lookup);
        row.status = L.status; row.gal = L.gal;
        if (L.status === 'ok') {
          if (t.capacityGal) row.pct = row.gal / t.capacityGal;
          if (t.capacityGal && t.fillLimitPct) {
            row.neededGal = t.capacityGal * t.fillLimitPct / 100 - row.gal;
            row.neededPct = row.neededGal / t.capacityGal;
          }
        }
      }
      rows.push(row);
    });
    var fuel = rows.filter(function (r) { return r.tank.type === 'fuel'; });
    var capacity = fuel.reduce(function (s, r) { return s + r.tank.gallons[r.tank.gallons.length - 1]; }, 0);
    var bad = fuel.filter(function (r) { return r.status !== 'ok'; });
    var s = { capacityGal: capacity, trimIn: trim, fillLimitPct: k.fill * 100, problems: bad.map(function (r) { return { id: r.tank.id, name: r.tank.name, status: r.status }; }) };
    if (bad.length) { s.status = 'CHECK SOUNDINGS'; }
    else {
      s.status = 'ok';
      s.totalGal = fuel.reduce(function (a, r) { return a + r.gal; }, 0);
      s.unpumpableGal = fuel.reduce(function (a, r) { return a + r.tank.unpumpableGal; }, 0);
      s.usableGal = s.totalGal - s.unpumpableGal;
      s.neededToLimitGal = capacity * k.fill - s.totalGal;              // Soundings!L6
      s.neededSumOfTanksGal = fuel.reduce(function (a, r) { return a + (r.neededGal || 0); }, 0); // Needed To Fill!K6
      s.pct = s.totalGal / capacity;
      s.neededPct = s.neededToLimitGal / capacity;
      s.total = units(s.totalGal, k); s.needed = units(s.neededToLimitGal, k); s.neededSum = units(s.neededSumOfTanksGal, k);
    }
    var waste = rows.filter(function (r) { return r.tank.sumGroup === 'sludgeRequest'; });
    var wbad = waste.filter(function (r) { return r.status !== 'ok'; });
    var w = waste.length ? (wbad.length ? { status: 'CHECK SOUNDINGS' } : { status: 'ok', totalGal: waste.reduce(function (a, r) { return a + r.gal; }, 0) }) : null;
    return { rows: rows, summary: s, sludge: w, trimIn: trim };
  }

  function units(gal, k) {
    return { gal: gal, liters: gal * k.lpg, shortTons: gal * k.density / k.st, longTons: gal * k.density / k.lt, metricTons: gal * k.density / k.mt };
  }

  /** Fuel Converter tab. from: gal|bbl|mt|st|lt|m3|l|ft3 ; sg optional */
  function convert(d, value, from, sg) {
    var k = constants(d), v = toNum(value), g = toNum(sg);
    var ppg = (g === null || isNaN(g) || g <= 0) ? k.density : g * k.water;
    if (v === null || isNaN(v)) return { ppg: ppg, gal: null };
    var gal = { gal: v, bbl: v * k.bbl, mt: v * k.mt / ppg, st: v * k.st / ppg, lt: v * k.lt / ppg, m3: v / k.m3, l: v / k.lpg, ft3: v * k.ft3 }[from];
    if (gal === undefined) throw new Error('unknown unit ' + from);
    return { ppg: ppg, gal: gal, bbl: gal / k.bbl, mt: gal * ppg / k.mt, st: gal * ppg / k.st, lt: gal * ppg / k.lt, m3: gal * k.m3, l: gal * k.lpg, ft3: gal / k.ft3 };
  }

  /* ---------------- burn-rate log ---------------- */
  /** rounds: [{ts (ISO), robGal, usableGal, engineHours|null, receivedGal, transferredOffGal}]
   *  received/transferredOff are amounts since the previous round. */
  function burnAnalysis(rounds, speedKn) {
    var rs = (rounds || []).slice().sort(function (a, b) { return new Date(a.ts) - new Date(b.ts); });
    var intervals = [], totC = 0, totH = 0;
    for (var i = 1; i < rs.length; i++) {
      var a = rs[i - 1], b = rs[i];
      var consumed = a.robGal - b.robGal + (Number(b.receivedGal) || 0) - (Number(b.transferredOffGal) || 0);
      var basis, hours;
      if (isNum(a.engineHours) && isNum(b.engineHours) && b.engineHours > a.engineHours) { hours = b.engineHours - a.engineHours; basis = 'engine hours'; }
      else { hours = (new Date(b.ts) - new Date(a.ts)) / 3600000; basis = 'clock hours'; }
      var iv = { from: a.ts, to: b.ts, consumedGal: consumed, hours: hours, basis: basis, rateGph: hours > 0 ? consumed / hours : null };
      if (hours > 0) { totC += consumed; totH += hours; }
      intervals.push(iv);
    }
    var res = { intervals: intervals, label: 'from ship logs, not TM data' };
    if (totH > 0) {
      res.avgRateGph = totC / totH; res.totalConsumedGal = totC; res.totalHours = totH;
      var last = rs[rs.length - 1];
      if (res.avgRateGph > 0 && isNum(last.usableGal)) {
        res.enduranceHours = last.usableGal / res.avgRateGph;
        var sp = toNum(speedKn);
        if (sp && sp > 0) res.rangeNm = res.enduranceHours * sp;
      }
    }
    return res;
  }

  function csvEscape(v) { if (v === null || v === undefined) return ''; var s = String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
  function logToCSV(rounds, speedKn) {
    var a = burnAnalysis(rounds, speedKn), rs = (rounds || []).slice().sort(function (x, y) { return new Date(x.ts) - new Date(y.ts); });
    var out = [['# Burn-rate log - from ship logs, not TM data'], ['timestamp', 'rob_gal', 'usable_gal', 'engine_hours', 'received_gal', 'transferred_off_gal', 'note', 'interval_consumed_gal', 'interval_hours', 'interval_basis', 'interval_rate_gph']];
    rs.forEach(function (r, i) {
      var iv = i ? a.intervals[i - 1] : null;
      out.push([r.ts, r.robGal, r.usableGal, r.engineHours, r.receivedGal, r.transferredOffGal, r.note, iv && iv.consumedGal, iv && iv.hours, iv && iv.basis, iv && iv.rateGph]);
    });
    out.push([]); out.push(['average_rate_gph', a.avgRateGph]); out.push(['endurance_hours', a.enduranceHours]); out.push(['speed_kn', speedKn]); out.push(['range_nm', a.rangeNm]);
    return out.map(function (r) { return r.map(csvEscape).join(','); }).join('\n') + '\n';
  }

  var api = { SCHEMA_ID: SCHEMA_ID, validateVesselData: validateVesselData, trimCorrection: trimCorrection, lookup: lookup, compute: compute, convert: convert, burnAnalysis: burnAnalysis, logToCSV: logToCSV, csvEscape: csvEscape };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LSVCalc = api;
})(typeof self !== 'undefined' ? self : this);
