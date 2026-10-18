/* LSV Fuel Soundings PWA - UI layer. No network calls; all data in localStorage. */
(function () {
  'use strict';
  var APP_VERSION = '1.0.0';
  var K = { vessel: 'lsvfuel.vessel.v1', entries: 'lsvfuel.entries.v1', log: 'lsvfuel.log.v1', speed: 'lsvfuel.speed.v1' };
  var C = window.LSVCalc;
  var vessel = null, entries = { readings: {}, drafts: {}, date: '' }, log = [], lastResult = null;

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function fmt(n, d) { if (n === null || n === undefined || !isFinite(n)) return '—'; return Number(n).toLocaleString('en-US', { minimumFractionDigits: d === undefined ? 2 : d, maximumFractionDigits: d === undefined ? 2 : d }); }
  function pct(n) { return (n === null || n === undefined || !isFinite(n)) ? '—' : (n * 100).toFixed(1) + '%'; }
  function toast(m) { var t = $('toast'); t.textContent = m; t.classList.add('show'); setTimeout(function () { t.classList.remove('show'); }, 2200); }
  function load(k, dflt) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Storage error: ' + e.message); return false; } }
  function download(name, text, type) {
    var blob = new Blob([text], { type: type || 'application/json' }), url = URL.createObjectURL(blob), a = el('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  function stamp() { return new Date().toISOString().slice(0, 16).replace(/[:T]/g, ''); }
  function slug() { return (vessel ? vessel.vessel.name : 'vessel').replace(/[^A-Za-z0-9]+/g, '-'); }

  /* ---------- import ---------- */
  function showMsg(target, ok, title, list) {
    var box = $(target); box.innerHTML = '';
    var d = el('div', ok ? 'okmsg' : 'errors', title);
    if (list && list.length) { var ul = el('ul'); list.slice(0, 25).forEach(function (m) { ul.appendChild(el('li', '', m)); }); if (list.length > 25) ul.appendChild(el('li', '', '… ' + (list.length - 25) + ' more')); d.appendChild(ul); }
    box.appendChild(d);
  }
  function importText(text, msgTarget) {
    var obj;
    try { obj = JSON.parse(text); } catch (e) { showMsg(msgTarget, false, 'Not valid JSON: ' + e.message); return false; }
    var backup = null;
    if (obj && obj.schema === 'lsv-fuel-backup/1') { backup = obj; obj = obj.vessel; }
    var v = C.validateVesselData(obj);
    if (!v.ok) { showMsg(msgTarget, false, 'Vessel data rejected (' + v.errors.length + ' problem' + (v.errors.length > 1 ? 's' : '') + '):', v.errors); return false; }
    if (vessel && !confirm('Replace the vessel data currently on this device (' + vessel.vessel.name + ')?' + (backup ? ' The backup\'s log and entries will also replace the current ones.' : ''))) return false;
    if (!save(K.vessel, obj)) return false;
    vessel = obj;
    if (backup) {
      log = Array.isArray(backup.log) ? backup.log : []; save(K.log, log);
      if (backup.entries) { entries = backup.entries; save(K.entries, entries); }
    }
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {});
    boot();
    showMsg(msgTarget === 'importMsgEmpty' ? 'importMsg' : msgTarget, true, 'Loaded "' + obj.vessel.name + '" (' + obj.tanks.length + ' tanks).' + (v.warnings.length ? ' Warnings:' : ''), v.warnings);
    toast('Vessel data loaded');
    return true;
  }
  function pickFile(msgTarget) {
    var fi = $('fileInput'); fi.value = '';
    fi.onchange = function () {
      var f = fi.files && fi.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { showMsg(msgTarget, false, 'File too large (max 5 MB).'); return; }
      var r = new FileReader(); r.onload = function () { importText(String(r.result), msgTarget); }; r.onerror = function () { showMsg(msgTarget, false, 'Could not read file.'); };
      r.readAsText(f);
    };
    fi.click();
  }

  /* ---------- rendering ---------- */
  var GROUPS = [['fuel', 'Fuel oil'], ['waste', 'Oily waste, waste oil & bilge'], ['lube', 'Lube oil'], ['hydraulic', 'Hydraulic oil']];
  function tankMeta(t) {
    var parts = [];
    if (t.capacityGal) parts.push('cap ' + fmt(t.capacityGal, 0) + ' gal');
    parts.push('table 0–' + t.maxIn + ' in');
    if (t.fillLimitPct) parts.push('limit ' + t.fillLimitPct + '%');
    if (t.unpumpableGal) parts.push('unpumpable ' + fmt(t.unpumpableGal, 0));
    return parts.join(' · ');
  }
  function buildTankCards() {
    var host = $('tankCards'); host.innerHTML = '';
    GROUPS.forEach(function (g) {
      var ts = vessel.tanks.filter(function (t) { return t.type === g[0]; }); if (!ts.length) return;
      host.appendChild(el('h2', '', g[1]));
      ts.forEach(function (t) {
        var card = el('div', 'tank'); card.id = 'tank-' + t.id;
        var nm = el('div', 'tank-name', t.name); if (t.trimCorrected) nm.appendChild(el('span', 'badge', 'trim')); card.appendChild(nm);
        card.appendChild(el('div', 'tank-meta', tankMeta(t)));
        var row = el('div', 'row3');
        [['ft', 'Feet'], ['in', 'Inches']].forEach(function (f) {
          var w = el('div'); w.appendChild(el('label', '', f[1]));
          var inp = el('input'); inp.type = 'text'; inp.setAttribute('inputmode', 'decimal'); inp.autocomplete = 'off';
          inp.dataset.tank = t.id; inp.dataset.field = f[0];
          var r = entries.readings[t.id]; if (r && r[f[0]] !== undefined && r[f[0]] !== null) inp.value = r[f[0]];
          w.appendChild(inp); row.appendChild(w);
        });
        var o = el('div'); o.appendChild(el('label', '', 'Gallons')); var out = el('div', 'out'); out.id = 'gal-' + t.id; o.appendChild(out); row.appendChild(o);
        card.appendChild(row);
        var sub = el('div', 'muted'); sub.id = 'sub-' + t.id; card.appendChild(sub);
        host.appendChild(card);
      });
    });
  }
  function kv(grid, k, v, cls) { var d = el('div', 'kv'); d.appendChild(el('div', 'k', k)); d.appendChild(el('div', 'v' + (cls ? ' ' + cls : ''), v)); grid.appendChild(d); }
  function renderSummary(res) {
    var s = res.summary, card = $('summaryCard'); card.innerHTML = '';
    card.className = 'card summary' + (s.status === 'ok' ? '' : ' check');
    if (s.status !== 'ok') {
      card.appendChild(el('div', 'title', 'CHECK SOUNDINGS'));
      var ul = el('ul'); s.problems.forEach(function (p) { ul.appendChild(el('li', '', p.name + ': ' + (p.status === 'out' ? 'OUT OF RANGE' : p.status === 'blank' ? 'not entered' : 'invalid entry'))); });
      card.appendChild(ul); card.appendChild(el('div', 'muted', 'Totals are withheld until every fuel tank has a valid sounding within its table.'));
    } else {
      card.appendChild(el('h2', '', 'Fuel oil on board'));
      var g = el('div', 'grid');
      kv(g, 'Total gallons', fmt(s.totalGal)); kv(g, 'Liters', fmt(s.total.liters)); kv(g, '% of capacity', pct(s.pct));
      kv(g, 'Usable gallons', fmt(s.usableGal)); kv(g, 'Short tons', fmt(s.total.shortTons)); kv(g, 'Long tons', fmt(s.total.longTons));
      kv(g, 'Metric tons', fmt(s.total.metricTons)); kv(g, 'Needed for ' + s.fillLimitPct + '%', fmt(s.neededToLimitGal)); kv(g, 'Needed %', pct(s.neededPct));
      card.appendChild(g);
    }
    card.appendChild(el('div', 'muted', 'Total capacity (sum of fuel tank tables): ' + fmt(s.capacityGal) + ' gal · density ' + vessel.constants.densityLbPerGal + ' lb/gal'));
    if (res.sludge) card.appendChild(el('div', 'muted', 'Sludge request (waste tanks total): ' + (res.sludge.status === 'ok' ? fmt(res.sludge.totalGal) + ' gal' : 'CHECK SOUNDINGS')));
  }
  function renderNeeded(res) {
    var s = res.summary, card = $('neededSummary'); card.innerHTML = '';
    card.className = 'card summary' + (s.status === 'ok' ? '' : ' check');
    if (s.status !== 'ok') { card.appendChild(el('div', 'title', 'CHECK SOUNDINGS')); card.appendChild(el('div', 'muted', 'Fix the flagged tanks on the Soundings tab.')); }
    else {
      card.appendChild(el('h2', '', 'Fuel needed to fill limit'));
      var g = el('div', 'grid');
      kv(g, 'Gallons (sum of tanks)', fmt(s.neededSumOfTanksGal)); kv(g, 'Liters', fmt(s.neededSum.liters)); kv(g, '% of capacity', pct(s.neededSumOfTanksGal / s.capacityGal));
      kv(g, 'Short tons', fmt(s.neededSum.shortTons)); kv(g, 'Long tons', fmt(s.neededSum.longTons)); kv(g, 'Metric tons', fmt(s.neededSum.metricTons));
      card.appendChild(g);
      card.appendChild(el('div', 'muted', 'Total-capacity basis (' + s.fillLimitPct + '% × ' + fmt(s.capacityGal) + ' − on board): ' + fmt(s.neededToLimitGal) + ' gal'));
    }
    var host = $('neededCards'); host.innerHTML = '';
    res.rows.forEach(function (r) {
      var t = r.tank; if (!t.fillLimitPct) return;
      var c = el('div', 'tank' + (r.status === 'out' ? ' out-of-range' : ''));
      c.appendChild(el('div', 'tank-name', t.name + ' → ' + t.fillLimitPct + '%'));
      var txt = r.status === 'ok' ? fmt(r.neededGal) + ' gal (' + pct(r.neededPct) + ')' : r.status === 'out' ? 'OUT OF RANGE' : r.status === 'blank' ? 'not entered' : 'invalid entry';
      c.appendChild(el('div', 'out' + (r.status === 'out' ? ' bad' : (r.status === 'ok' && r.neededGal < 0 ? ' warn' : '')), txt));
      if (r.status === 'ok' && r.neededGal < 0) c.appendChild(el('div', 'muted', 'Above fill limit by ' + fmt(-r.neededGal) + ' gal'));
      host.appendChild(c);
    });
  }
  function recalc() {
    var res = C.compute(vessel, entries.readings, entries.drafts); lastResult = res;
    $('trimVal').textContent = res.trimIn.toFixed(4) + '"';
    res.rows.forEach(function (r) {
      var t = r.tank, card = $('tank-' + t.id), out = $('gal-' + t.id), sub = $('sub-' + t.id);
      card.classList.toggle('out-of-range', r.status === 'out' || r.status === 'invalid');
      card.classList.toggle('blank', r.status === 'blank');
      out.className = 'out';
      if (r.status === 'ok') { out.textContent = fmt(r.gal); sub.textContent = 'Total in ' + r.totalIn.toFixed(4) + (r.pct !== undefined ? ' · ' + pct(r.pct) + ' full' : '') + (r.neededGal !== undefined ? ' · to ' + t.fillLimitPct + '%: ' + fmt(r.neededGal) : ''); }
      else if (r.status === 'out') { out.textContent = 'OUT OF RANGE'; out.className = 'out bad'; sub.textContent = 'Total in ' + r.totalIn.toFixed(4) + ' is outside the table (0–' + t.maxIn + ' in).'; }
      else if (r.status === 'invalid') { out.textContent = 'INVALID'; out.className = 'out bad'; sub.textContent = 'Enter numbers only.'; }
      else { out.textContent = '—'; sub.textContent = 'Not entered'; }
    });
    renderSummary(res); renderNeeded(res); renderLog();
  }

  /* ---------- log ---------- */
  function renderLog() {
    var speed = $('speedKn').value, a = C.burnAnalysis(log, speed), bs = $('burnSummary'); bs.innerHTML = '';
    bs.appendChild(el('h2', '', 'Burn rate & endurance')); bs.appendChild(el('div', 'label-note', 'From ship logs, not TM data'));
    var g = el('div', 'grid');
    kv(g, 'Avg burn (gal/h)', fmt(a.avgRateGph)); kv(g, 'Endurance (h)', fmt(a.enduranceHours, 1)); kv(g, 'Endurance (days)', a.enduranceHours ? fmt(a.enduranceHours / 24, 1) : '—');
    kv(g, 'Range @ ' + (speed || '?') + ' kn (nm)', fmt(a.rangeNm, 0)); kv(g, 'Logged hours', fmt(a.totalHours, 1)); kv(g, 'Logged burn (gal)', fmt(a.totalConsumedGal, 0));
    bs.appendChild(g);
    bs.appendChild(el('div', 'muted', log.length < 2 ? 'Save at least two rounds to compute a burn rate.' : 'Endurance = latest usable fuel ÷ average burn. Range = endurance × planned speed.'));
    var tb = $('logTable'); tb.innerHTML = '';
    var rs = log.slice().sort(function (x, y) { return new Date(x.ts) - new Date(y.ts); });
    var hd = el('tr'); ['Time', 'ROB gal', 'Usable', 'Eng h', 'Recv', 'Off', 'Burn gal', 'h', 'gal/h', ''].forEach(function (h) { hd.appendChild(el('th', '', h)); }); tb.appendChild(hd);
    rs.forEach(function (r, i) {
      var iv = i ? a.intervals[i - 1] : null, tr = el('tr');
      [new Date(r.ts).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), fmt(r.robGal, 0), fmt(r.usableGal, 0), r.engineHours === null ? '—' : fmt(r.engineHours, 1), fmt(r.receivedGal || 0, 0), fmt(r.transferredOffGal || 0, 0),
        iv ? fmt(iv.consumedGal, 0) : '', iv ? fmt(iv.hours, 1) + (iv.basis === 'clock hours' ? '*' : '') : '', iv ? fmt(iv.rateGph, 1) : ''].forEach(function (c) { tr.appendChild(el('td', '', c)); });
      var td = el('td'), b = el('button', 'danger', '✕'); b.type = 'button'; b.title = 'Delete round'; b.dataset.del = r.id; td.appendChild(b); tr.appendChild(td);
      tb.appendChild(tr);
    });
    if (a.intervals.some(function (iv) { return iv.basis === 'clock hours'; })) { var tr2 = el('tr'), td2 = el('td', 'muted', '* clock hours used (no engine-hour change)'); td2.colSpan = 10; tr2.appendChild(td2); tb.appendChild(tr2); }
  }
  function numOrNull(v) { if (v === '' || v === null || v === undefined) return null; var n = Number(v); return isFinite(n) ? n : NaN; }
  function saveRound() {
    var res = lastResult;
    if (!res || res.summary.status !== 'ok') { showMsg('logMsg', false, 'CHECK SOUNDINGS: all fuel tanks need valid soundings before a round can be saved.'); return; }
    var hrs = numOrNull($('logHours').value), recv = numOrNull($('logRecv').value), xfer = numOrNull($('logXfer').value);
    if ([hrs, recv, xfer].some(function (x) { return x !== null && (isNaN(x) || x < 0); })) { showMsg('logMsg', false, 'Engine hours / received / transferred must be numbers ≥ 0.'); return; }
    var ts = entries.date ? new Date(entries.date).toISOString() : new Date().toISOString();
    if (log.some(function (r) { return r.ts === ts; })) { showMsg('logMsg', false, 'A round with this date/time already exists. Change the date/time on the Soundings tab.'); return; }
    log.push({ id: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ts: ts, robGal: res.summary.totalGal, usableGal: res.summary.usableGal,
      engineHours: hrs, receivedGal: recv || 0, transferredOffGal: xfer || 0, note: $('logNote').value || '', readings: JSON.parse(JSON.stringify(entries.readings)), drafts: JSON.parse(JSON.stringify(entries.drafts)) });
    entries.date = ''; save(K.entries, entries); $('roundDate').value = '';
    save(K.log, log); ['logRecv', 'logXfer', 'logNote'].forEach(function (id) { $(id).value = ''; });
    showMsg('logMsg', true, 'Round saved (' + new Date(ts).toLocaleString() + ', ROB ' + fmt(res.summary.totalGal) + ' gal).'); renderLog();
  }

  /* ---------- converter ---------- */
  var UNITS = [['gal', 'Gallons'], ['bbl', 'Barrels'], ['mt', 'Metric tons'], ['st', 'Short tons'], ['lt', 'Long tons'], ['m3', 'Cubic meters'], ['l', 'Liters'], ['ft3', 'Cubic feet']];
  function renderConvert() {
    var r = C.convert(vessel, $('convVal').value, $('convUnit').value, $('convSG').value), host = $('convOut'); host.innerHTML = '';
    $('convPPG').textContent = r.ppg.toFixed(4);
    UNITS.forEach(function (u) {
      var line = el('div', 'line' + (u[0] === $('convUnit').value ? ' active' : ''));
      line.appendChild(el('span', '', u[1])); line.appendChild(el('strong', '', r.gal === null ? '—' : fmt(r[u[0]], 4))); host.appendChild(line);
    });
  }

  /* ---------- data tab ---------- */
  function renderDataInfo() {
    var d = $('dataInfo'); d.innerHTML = ''; d.appendChild(el('h2', '', 'Loaded vessel data'));
    var l = el('div', 'kvlist'), c = vessel.constants;
    [['Vessel', vessel.vessel.name], ['Tanks', vessel.tanks.length + ' (' + vessel.tanks.filter(function (t) { return t.type === 'fuel'; }).length + ' fuel)'],
     ['Density', c.densityLbPerGal + ' lb/gal'], ['Liters/gal', c.litersPerGal], ['Trim', '(' + (c.trimSign === 'bow-minus-stern' ? 'bow − stern' : 'stern − bow') + ') × ' + c.trimTankLengthFt + '/' + c.trimVesselLengthFt + ' × 12 ÷ ' + c.trimDivisor],
     ['Fuel fill limit', c.fuelTotalFillLimitPct + '%'], ['Lookup', c.lookup || 'floor'], ['Source', vessel.source ? (vessel.source.workbook || '') + ' ' + (vessel.source.generated || '') : '—'],
     ['Marking', vessel.distributionMarking || '(none)'], ['Log rounds', String(log.length)]].forEach(function (p) { l.appendChild(el('div', 'k', p[0])); l.appendChild(el('div', '', String(p[1]))); });
    d.appendChild(l);
  }

  /* ---------- boot ---------- */
  function setTab(name) {
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('active', p.id === 'panel-' + name); });
    document.querySelectorAll('#tabs button').forEach(function (b) { b.classList.toggle('active', b.dataset.tab === name); });
    window.scrollTo(0, 0);
  }
  function boot() {
    vessel = load(K.vessel, null);
    if (vessel && !C.validateVesselData(vessel).ok) vessel = null;
    var has = !!vessel;
    $('emptyState').classList.toggle('hidden', has); $('tabs').classList.toggle('hidden', !has);
    document.querySelectorAll('.panel').forEach(function (p) { p.classList.toggle('hidden', !has); });
    var mk = $('hdrMarking');
    if (!has) { $('hdrName').textContent = 'LSV Fuel Soundings'; mk.classList.add('hidden'); return; }
    $('hdrName').textContent = vessel.vessel.name + ' · Fuel Soundings';
    mk.classList.remove('hidden'); mk.classList.toggle('none', !vessel.distributionMarking);
    mk.textContent = vessel.distributionMarking || 'No distribution marking in loaded data';
    var c = vessel.constants;
    $('trimFormula').textContent = 'Trim = ((' + (c.trimSign === 'bow-minus-stern' ? 'Bow − Stern' : 'Stern − Bow') + ') × (' + c.trimTankLengthFt + ' / ' + c.trimVesselLengthFt + ') × 12) ÷ ' + c.trimDivisor + '; needs all four draft fields.';
    document.querySelectorAll('[data-draft]').forEach(function (i) { var v = entries.drafts[i.dataset.draft]; i.value = (v === undefined || v === null) ? '' : v; });
    $('roundDate').value = entries.date || '';
    buildTankCards(); recalc(); renderConvert(); renderDataInfo();
    if (!document.querySelector('.panel.active')) setTab('soundings');
  }

  function init() {
    entries = load(K.entries, entries) || entries; entries.readings = entries.readings || {}; entries.drafts = entries.drafts || {};
    log = load(K.log, []) || []; $('speedKn').value = load(K.speed, '') || '';
    $('appVer').textContent = 'App version ' + APP_VERSION + ' · schema ' + C.SCHEMA_ID;
    document.addEventListener('input', function (e) {
      var t = e.target;
      if (t.dataset && t.dataset.tank) { var r = entries.readings[t.dataset.tank] || (entries.readings[t.dataset.tank] = {}); r[t.dataset.field] = t.value.trim(); if (r.ft === '' && r['in'] === '') delete entries.readings[t.dataset.tank]; save(K.entries, entries); recalc(); }
      else if (t.dataset && t.dataset.draft) { entries.drafts[t.dataset.draft] = t.value.trim(); save(K.entries, entries); recalc(); }
      else if (t.id === 'roundDate') { entries.date = t.value; save(K.entries, entries); }
      else if (t.id === 'speedKn') { save(K.speed, t.value); renderLog(); }
      else if (t.id === 'convVal' || t.id === 'convSG' || t.id === 'convUnit') { renderConvert(); }
    });
    $('convUnit').addEventListener('change', renderConvert);
    $('tabs').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setTab(b.dataset.tab); });
    $('btnImportEmpty').onclick = function () { pickFile('importMsgEmpty'); };
    $('btnImport').onclick = function () { pickFile('importMsg'); };
    $('btnPasteEmpty').onclick = function () { importText($('pasteEmpty').value, 'importMsgEmpty'); };
    $('btnPaste').onclick = function () { if (importText($('pasteData').value, 'importMsg')) $('pasteData').value = ''; };
    $('btnClear').onclick = function () { if (!confirm('Clear all soundings and drafts?')) return; entries = { readings: {}, drafts: {}, date: '' }; save(K.entries, entries); boot(); };
    $('btnSaveRound').onclick = saveRound;
    $('logTable').addEventListener('click', function (e) { var b = e.target.closest('button[data-del]'); if (!b || !confirm('Delete this round?')) return; log = log.filter(function (r) { return r.id !== b.dataset.del; }); save(K.log, log); renderLog(); });
    $('btnLogCSV').onclick = function () { if (!log.length) { toast('Log is empty'); return; } download(slug() + '-burn-log-' + stamp() + '.csv', C.logToCSV(log, $('speedKn').value), 'text/csv'); };
    $('btnLogClear').onclick = function () { if (log.length && confirm('Delete ALL ' + log.length + ' log rounds from this device?')) { log = []; save(K.log, log); renderLog(); renderDataInfo(); } };
    $('btnExportVessel').onclick = function () { download(slug() + '-vessel-data.json', JSON.stringify(vessel, null, 1)); };
    $('btnExportBackup').onclick = function () { download(slug() + '-backup-' + stamp() + '.json', JSON.stringify({ schema: 'lsv-fuel-backup/1', exported: new Date().toISOString(), appVersion: APP_VERSION, vessel: vessel, log: log, entries: entries }, null, 1)); };
    $('btnDelete').onclick = function () {
      if (!confirm('Delete the vessel data (' + vessel.vessel.name + ') from this device? Export a backup first if you need it.')) return;
      localStorage.removeItem(K.vessel);
      if (log.length && confirm('Also delete the ' + log.length + ' burn-log rounds and current soundings?')) { localStorage.removeItem(K.log); localStorage.removeItem(K.entries); log = []; entries = { readings: {}, drafts: {}, date: '' }; }
      vessel = null; boot(); toast('Vessel data deleted');
    };
    boot();
    if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(function (e) { console.warn('SW registration failed', e); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
