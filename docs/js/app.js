/* Bizzle X-Ray v4.20 — UI controller */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var AI = window.XAI, S = window.XScan, BR = window.XBrain;
  var THEMES = [['neon', 'Neon Green', '#39ff14'], ['violet', 'Ultraviolet', '#b388ff'], ['ice', 'Ice Blue', '#4fc3f7'], ['ember', 'Ember', '#ff7a3d'], ['matrix', 'Matrix', '#00ff41'], ['rose', 'Rose', '#ff4fa3'], ['daylight', 'Daylight', '#0a9b2c']];
  var LS_VAULT = 'bx.vault', LS_BZ_MEM = 'bx.bizzy.memory', LS_BZ_HIST = 'bx.bizzy.history', LS_OPTS = 'bx.opts';
  var current = null;   // current teardown
  var cancelFlag = { v: false };

  /* ---------- utils ---------- */
  function toast(msg, ms) { var t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('on'); }, ms || 2600); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function opts() { var d = { maxScripts: 6 }; try { var o = JSON.parse(localStorage.getItem(LS_OPTS) || '{}'); for (var k in o) d[k] = o[k]; } catch (e) {} return d; }
  function copyText(text) {
    var done = function () { toast('Copied ✓'); };
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed'); } ta.remove(); }
  }
  function addCopy(el, getText) {
    var b = document.createElement('button'); b.className = 'copy'; b.type = 'button'; b.textContent = '📋 Copy'; b.setAttribute('aria-label', 'Copy reply');
    b.onclick = function (e) { e.stopPropagation(); copyText(typeof getText === 'function' ? getText() : getText); b.textContent = '✓ Copied'; setTimeout(function () { b.textContent = '📋 Copy'; }, 1500); };
    el.classList.add('hascopy'); el.appendChild(b); return b;
  }
  function isNative() { return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()); }
  function download(name, text, mime) {
    if (isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.Filesystem) {
      var P = window.Capacitor.Plugins;
      return P.Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' }).then(function (r) {
        if (P.Share) return P.Share.share({ title: name, files: [r.uri], dialogTitle: 'Save or share ' + name }).catch(function () {});
        toast('Saved to app cache: ' + name);
      }).catch(function (e) { copyText(text); toast('Could not save file; copied instead'); });
    }
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' })); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500); toast('Downloading ' + name);
  }
  function slug(s) { return String(s || 'teardown').toLowerCase().replace(/^https?:\/\//, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'teardown'; }
  function fileToImage(file, maxDim) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          var m = maxDim || 1600, w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, m / Math.max(w, h));
          var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var url = c.toDataURL('image/jpeg', 0.85);
          res({ mime: 'image/jpeg', base64: url.split(',')[1], dataUrl: url, w: w, h: h, img: img, name: file.name || 'image' });
        };
        img.onerror = function () { rej(new Error('Not an image')); };
        img.src = fr.result;
      };
      fr.onerror = function () { rej(fr.error); };
      fr.readAsDataURL(file);
    });
  }

  /* ---------- vault ---------- */
  function vault() { try { return JSON.parse(localStorage.getItem(LS_VAULT) || '[]'); } catch (e) { return []; } }
  function saveVault(v) {
    for (var tries = 0; tries < 30; tries++) {
      try { localStorage.setItem(LS_VAULT, JSON.stringify(v)); return true; } catch (e) { if (v.length <= 1) break; v.pop(); }
    }
    toast('Vault is full; oldest teardowns were trimmed'); return false;
  }
  function slimEvidence(ev) {
    var e = JSON.parse(JSON.stringify(ev, function (k, v) { if (k === 'inlineScripts' || k === 'inlineCss' || k === 'styleAttrs' || k === 'img') return undefined; return v; }));
    if (e.tree && e.tree.length > 200) e.tree = e.tree.slice(0, 200);
    return e;
  }
  function saveTeardown(t) {
    var v = vault().filter(function (x) { return x.id !== t.id; });
    var copy = Object.assign({}, t, { evidence: slimEvidence(t.evidence || {}), images: (t.images || []).map(function (i) { return { dataUrl: i.thumb || '', w: i.w, h: i.h }; }) });
    v.unshift(copy); saveVault(v.slice(0, 60));
  }
  function getTeardown(id) { if (current && current.id === id) return current; return vault().filter(function (x) { return x.id === id; })[0] || null; }

  /* ---------- AI ---------- */
  function hasKey() { var s = AI.getSettings(); return !!AI.getKeys()[s.provider]; }
  function callAI(system, text, images, o) {
    o = o || {};
    var s = AI.getSettings();
    var sys = system + (s.systemPrompt ? '\n\nUser preference: ' + s.systemPrompt : '');
    var msgs = o.messages || [{ role: 'user', text: text, images: images || [] }];
    return AI.chat({ provider: s.provider, model: s.model || '', effort: s.effort || 'Pro', messages: msgs, system: sys,
      temperature: o.temperature != null ? o.temperature : s.temperature, maxTokens: Math.max(+s.maxTokens || 2048, o.minTokens || 0), timeoutMs: o.timeoutMs });
  }

  /* ---------- router ---------- */
  var hist = [];
  function route() {
    var h = location.hash.replace(/^#\/?/, ''), parts = h.split('/'), view = parts[0] || 'home', id = parts[1];
    if (!document.querySelector('[data-view="' + view + '"]')) view = 'home';
    $$('.view').forEach(function (v) { v.classList.toggle('on', v.getAttribute('data-view') === view); });
    if (hist[hist.length - 1] !== location.hash) hist.push(location.hash);
    window.scrollTo(0, 0);
    if (id && ['report', 'plan', 'build', 'prompts'].indexOf(view) >= 0) { var t = getTeardown(id); if (t) current = t; else { toast('Teardown not found'); location.hash = '#/vault'; return; } }
    ({ home: renderRecent, report: renderReport, plan: renderPlan, build: renderBuild, prompts: renderPrompts, vault: renderVault, settings: renderSettings, about: function () { $('#buildId').textContent = window.XRAY_BUILD; } }[view] || function () {})();
  }
  function goBack() {
    if ($('#winOverlay') && !$('#winOverlay').hidden) { closeWin(); return; }
    if (hist.length > 1) { hist.pop(); var prev = hist.pop(); location.hash = prev || '#/'; }
    else if (location.hash && location.hash !== '#/') location.hash = '#/';
    else toast('You are on the home screen');
  }
  document.addEventListener('click', function (e) { var b = e.target.closest('[data-back]'); if (b) { e.preventDefault(); goBack(); } });
  window.addEventListener('hashchange', route);

  /* ---------- themes ---------- */
  function applyTheme(t) { document.documentElement.setAttribute('data-theme', t); var m = document.querySelector('meta[name=theme-color]'); if (m) m.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#050806'; }
  function setTheme(t) { var s = AI.getSettings(); s.theme = t; AI.setSettings(s); applyTheme(t); renderSwatches(); }
  $('#themeCycle').onclick = function () { var s = AI.getSettings(), i = THEMES.map(function (x) { return x[0]; }).indexOf(s.theme); var n = THEMES[(i + 1) % THEMES.length]; setTheme(n[0]); toast('Theme: ' + n[1]); };
  function renderSwatches() {
    var s = AI.getSettings(), box = $('#swatches'); box.innerHTML = '';
    THEMES.forEach(function (t) { var b = document.createElement('button'); b.type = 'button'; b.className = 'sw' + (s.theme === t[0] ? ' on' : ''); b.setAttribute('data-theme-pick', t[0]); b.innerHTML = '<i style="background:' + t[2] + '"></i>' + t[1]; b.onclick = function () { setTheme(t[0]); }; box.appendChild(b); });
  }

  /* ---------- home ---------- */
  $$('.tab').forEach(function (b) { b.onclick = function () { $$('.tab').forEach(function (x) { x.classList.toggle('on', x === b); }); $$('.tabpane').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-pane') === b.getAttribute('data-tab')); }); }; });
  $$('[data-try]').forEach(function (c) { c.onclick = function () { $('#urlIn').value = c.getAttribute('data-try'); $('#urlIn').focus(); }; });
  $('#scanUrl').onclick = function () { startWebsite($('#urlIn').value, $('#askIn').value); };
  $('#urlIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#scanUrl').click(); });
  function renderRecent() {
    var v = vault().slice(0, 6), box = $('#recent');
    box.innerHTML = v.length ? '' : '<p class="muted small">No teardowns yet. Try igloo.inc above.</p>';
    v.forEach(function (t) { box.appendChild(itemEl(t)); });
  }
  function itemEl(t, withDel) {
    var d = document.createElement('div'); d.className = 'item'; d.setAttribute('data-id', t.id);
    var img = t.screenshot || (t.images && t.images[0] && t.images[0].dataUrl) || '';
    d.innerHTML = (img ? '<img alt="" loading="lazy" src="' + esc(img) + '">' : '<img alt="">') + '<div class="it"><b>' + esc(t.title || t.target) + '</b><span>' + esc(t.kind) + ' · ' + new Date(t.createdAt).toLocaleString() + ' · ' + esc((t.verdict || '').slice(0, 120)) + '</span></div>' + (withDel ? '<button class="del" title="Delete">🗑️</button>' : '');
    d.onclick = function (e) { if (e.target.closest('.del')) { e.stopPropagation(); if (confirm('Delete this teardown?')) { saveVault(vault().filter(function (x) { return x.id !== t.id; })); renderVault(); } return; } location.hash = '#/report/' + t.id; };
    return d;
  }

  // screenshots
  var shotImgs = [];
  function addShots(files) {
    Array.prototype.forEach.call(files, function (f) { if (!/^image\//.test(f.type)) return; fileToImage(f).then(function (im) { im.thumb = thumbOf(im); shotImgs.push(im); drawThumbs($('#shotThumbs'), shotImgs); }).catch(function (e) { toast(e.message); }); });
  }
  function thumbOf(im) { var c = document.createElement('canvas'), k = 160 / Math.max(im.w, im.h); c.width = Math.max(1, Math.round(im.w * k)); c.height = Math.max(1, Math.round(im.h * k)); c.getContext('2d').drawImage(im.img, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', 0.7); }
  function drawThumbs(box, arr) {
    box.innerHTML = '';
    arr.forEach(function (im, i) { var d = document.createElement('div'); d.className = 'th'; d.innerHTML = '<img alt="attachment" src="' + im.dataUrl + '"><button aria-label="Remove">✕</button>'; d.querySelector('button').onclick = function () { arr.splice(i, 1); drawThumbs(box, arr); }; box.appendChild(d); });
  }
  function wireDrop(drop, input, onFiles) {
    drop.onclick = function () { input.click(); };
    drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') input.click(); });
    input.onchange = function () { onFiles(input.files); input.value = ''; };
    drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', function () { drop.classList.remove('over'); });
    drop.addEventListener('drop', function (e) { e.preventDefault(); drop.classList.remove('over'); onFiles(e.dataTransfer.files); });
  }
  wireDrop($('#shotDrop'), $('#shotFile'), addShots);
  document.addEventListener('paste', function (e) {
    var files = Array.prototype.filter.call((e.clipboardData && e.clipboardData.files) || [], function (f) { return /^image\//.test(f.type); });
    if (!files.length) return;
    if (!$('#bizzy').hidden && document.activeElement && document.activeElement.closest('#bizzy')) { bzAdd(files); }
    else { $$('.tab').filter(function (t) { return t.getAttribute('data-tab') === 'shot'; })[0].click(); addShots(files); location.hash = '#/'; }
  });
  $('#scanShot').onclick = function () { if (!shotImgs.length) { toast('Add at least one screenshot'); return; } startShot(shotImgs.slice(), $('#shotAsk').value); };

  var pkgFile = null;
  wireDrop($('#pkgDrop'), $('#pkgFile'), function (files) { pkgFile = files[0] || null; $('#pkgDrop').firstChild.textContent = pkgFile ? '📦 ' + pkgFile.name + ' (' + S.bytes(pkgFile.size) + ') ' : '📦 Drop or choose a file '; $('#scanPkg').disabled = !pkgFile; });
  $('#scanPkg').onclick = function () { if (pkgFile) startPackage(pkgFile, 'Reverse engineer ' + pkgFile.name); };
  $('#scanCode').onclick = function () {
    var code = $('#codeIn').value; if (!code.trim()) { toast('Paste some code first'); return; }
    var name = /<html|<body|<div/i.test(code) ? 'pasted.html' : (/[{;]\s*[a-z-]+\s*:\s*[^;]+;/.test(code) && !/function|=>|var |const /.test(code) ? 'pasted.css' : 'pasted.js');
    startPackage(new File([code], name, { type: 'text/plain' }), 'Reverse engineer this pasted code');
  };

  /* ---------- command bar + voice ---------- */
  function runCommand(raw) {
    var c = (raw || '').trim(); if (!c) return;
    var m = /^(?:hey\s+)?(?:bizzy[, ]+)?(?:please\s+)?(?:reverse[- ]engineer|tear\s*down|x-?ray|analy[sz]e|scan|break\s*down)\s+(?:the\s+)?(?:website\s+|site\s+)?(.+?)(?:\s+for me)?[.!?]?$/i.exec(c);
    if (m) { startWebsite(m[1].replace(/\s+dot\s+/gi, '.').replace(/\s+/g, ''), c); return; }
    if (/^(read|read it|read (it|the teardown) (to me|out loud))/i.test(c)) { if (current) { location.hash = '#/report/' + current.id; setTimeout(readAloud, 300); } else toast('No teardown open yet'); return; }
    if (/^(build|make|create)\b/i.test(c)) { if (current) { location.hash = '#/build/' + current.id; setTimeout(function () { $('#buildTweak').value = c; buildAI(c); }, 300); } else { openBizzy(); bzSend(c); } return; }
    if (/^(open\s+)?(the\s+)?vault/i.test(c)) { location.hash = '#/vault'; return; }
    if (/settings/i.test(c)) { location.hash = '#/settings'; return; }
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(c) || /^https?:\/\//i.test(c)) { startWebsite(c, ''); return; }
    openBizzy(); bzSend(c);
  }
  $('#cmdGo').onclick = function () { runCommand($('#cmd').value); };
  $('#cmd').addEventListener('keydown', function (e) { if (e.key === 'Enter') runCommand($('#cmd').value); });
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  $('#micBtn').onclick = function () {
    if (!SR) { toast('Voice input is not supported in this browser. Type instead.'); return; }
    var r = new SR(); r.lang = navigator.language || 'en-US'; r.interimResults = true; var btn = $('#micBtn'); btn.classList.add('live');
    r.onresult = function (e) { var t = Array.prototype.map.call(e.results, function (x) { return x[0].transcript; }).join(''); $('#cmd').value = t; if (e.results[e.results.length - 1].isFinal) runCommand(t); };
    r.onerror = function (e) { toast('Mic: ' + e.error); }; r.onend = function () { btn.classList.remove('live'); };
    try { r.start(); } catch (e) { btn.classList.remove('live'); }
  };
  function speak(text, onEnd) {
    if (!('speechSynthesis' in window)) { toast('Speech is not supported here'); return false; }
    speechSynthesis.cancel();
    var chunks = String(text).replace(/```[\s\S]*?```/g, ' code block. ').replace(/[#>*`_|]/g, '').replace(/\[E\d+\]/g, '').replace(/\n+/g, '. ').match(/[^.!?]{1,220}[.!?]?/g) || [];
    chunks.forEach(function (c, i) { var u = new SpeechSynthesisUtterance(c.trim()); u.rate = 1.03; if (i === chunks.length - 1 && onEnd) u.onend = onEnd; speechSynthesis.speak(u); });
    return true;
  }

  /* ---------- scan flows ---------- */
  var STEP_SETS = {
    website: [['open', 'Opening the site in a clean reader'], ['load', 'Waiting for it to load (rendered snapshot + screenshot)'], ['read', 'Reading the code: DOM, styles and scripts'], ['list', 'Listing everything it loads'], ['stack', 'Identifying the stack'], ['evidence', 'Lining up the evidence'], ['write', 'Writing the teardown']],
    package: [['open', 'Opening the target'], ['read', 'Unpacking and reading'], ['stack', 'Inspecting manifests, binaries and code'], ['evidence', 'Lining up the evidence'], ['write', 'Writing the teardown']],
    screenshot: [['open', 'Loading the screenshots'], ['read', 'Measuring palette and dimensions'], ['write', 'AI vision teardown']]
  };
  function beginScan(kind, label) {
    cancelFlag = { v: false };
    $('#scanTarget').textContent = label; $('#scanLog').textContent = ''; $('#pfill').style.width = '3%';
    var ul = $('#steps'); ul.innerHTML = '';
    STEP_SETS[kind].forEach(function (s) { var li = document.createElement('li'); li.setAttribute('data-step', s[0]); li.textContent = s[1]; ul.appendChild(li); });
    location.hash = '#/scan';
    var keys = STEP_SETS[kind].map(function (s) { return s[0]; });
    var api = {
      step: function (id, text) {
        var idx = keys.indexOf(id);
        $$('#steps li').forEach(function (li, i) { if (i < idx) { li.classList.remove('run'); li.classList.add('done'); } else if (i === idx) { li.classList.add('run'); if (text) li.textContent = text; } });
        $('#pfill').style.width = Math.round(((idx + 0.5) / keys.length) * 100) + '%';
        api.log('» ' + (text || id));
      },
      log: function (t) { var l = $('#scanLog'); l.textContent += t + '\n'; l.scrollTop = l.scrollHeight; },
      done: function () { $$('#steps li').forEach(function (li) { li.classList.remove('run'); li.classList.add('done'); }); $('#pfill').style.width = '100%'; },
      fail: function (msg) { var r = $('#steps li.run'); if (r) { r.classList.remove('run'); r.classList.add('fail'); } api.log('✕ ' + msg); }
    };
    return api;
  }
  $('#cancelScan').onclick = function () { cancelFlag.v = true; toast('Cancelled'); location.hash = '#/'; };

  function finishTeardown(ev, ask, ui, extra) {
    if (cancelFlag.v) return Promise.resolve();
    var t = Object.assign({ id: uid(), kind: ev.kind, target: ev.target, host: ev.host, title: (ev.dom && ev.dom.title) || (ev.microlink && ev.microlink.title) || ev.host || ev.target, ask: ask || ('Reverse engineer ' + ev.target), createdAt: new Date().toISOString(), screenshot: ev.screenshot || '', evidence: ev }, extra || {});
    ui.step('write', hasKey() ? 'Writing the teardown with AI' : 'Writing the teardown (local, no key)');
    var local = BR.localReport(ev);
    var p = hasKey() && ev.kind !== 'screenshot'
      ? callAI(BR.REPORT_SYS, BR.reportPrompt(ev, t.ask), [], { minTokens: 6000 }).then(function (r) { t.report = r.text; t.reportBy = 'AI · ' + r.provider + ' ' + r.model; ui.log('AI teardown: ' + r.model); }, function (e) { t.report = local; t.reportBy = 'local (AI failed: ' + e.message.slice(0, 120) + ')'; ui.log('AI failed, using local teardown: ' + e.message); })
      : Promise.resolve().then(function () { t.report = local; t.reportBy = 'local evidence engine (add a free key in Advanced AI Settings for an AI-written teardown)'; });
    return p.then(function () {
      if (cancelFlag.v) return;
      t.verdict = ((t.report.split('\n').filter(function (l) { return /^>/.test(l); })[0]) || '').replace(/^>\s*/, '');
      current = t; saveTeardown(t); ui.done();
      if (AI.getSettings().voice && t.verdict) speak('Teardown complete. ' + t.verdict);
      setTimeout(function () { location.hash = '#/report/' + t.id; }, 350);
    });
  }

  function startWebsite(input, ask) {
    var url = S.normUrl(input);
    if (!url) { toast('Enter a website URL'); return; }
    var ui = beginScan('website', new URL(url).host);
    S.scanWebsite(url, { onStep: ui.step, onLog: ui.log, maxScripts: +opts().maxScripts }).then(function (ev) { return finishTeardown(ev, ask, ui); }).catch(function (e) { ui.fail(e.message || String(e)); toast('Scan failed: ' + (e.message || e).slice(0, 120), 5000); });
  }
  function startPackage(file, ask) {
    var ui = beginScan('package', file.name);
    S.analyzePackage(file, { onStep: ui.step, onLog: ui.log }).then(function (ev) { return finishTeardown(ev, ask, ui); }).catch(function (e) { ui.fail(e.message || String(e)); toast('Could not read package: ' + (e.message || e), 5000); });
  }
  function startShot(imgs, ask) {
    var ui = beginScan('screenshot', imgs.length + ' screenshot' + (imgs.length > 1 ? 's' : ''));
    ui.step('open');
    var notes = imgs.map(function (im, i) { return { image: i + 1, size: im.w + '×' + im.h, aspect: (im.w / im.h).toFixed(2), likely: im.w < im.h ? 'mobile / portrait' : 'desktop / landscape', palette: S.imagePalette(im.img, 8) }; });
    ui.step('read'); notes.forEach(function (n) { ui.log('Image ' + n.image + ': ' + n.size + ' palette ' + n.palette.join(' ')); });
    var ev = { kind: 'screenshot', target: 'Screenshot teardown', host: 'screenshot', imageNotes: notes, stack: [], design: { palette: notes[0].palette, colors: [] }, evidence: notes.map(function (n, i) { return { id: 'E' + (i + 1), claim: 'Image ' + n.image + ' ' + n.size + ', measured palette ' + n.palette.join(' '), source: 'canvas pixel sampling', detail: '' }; }), cantSee: ['Code, network traffic and real data: only pixels were analysed.', 'Exact fonts and spacing are estimates from the image.'], errors: [] };
    ui.step('write', hasKey() ? 'AI vision teardown' : 'Local summary (add a key for AI vision)');
    var t = { id: uid(), kind: 'screenshot', target: 'Screenshot', host: 'screenshot', title: 'Screenshot teardown · ' + new Date().toLocaleDateString(), ask: ask || 'What is this and how would I rebuild it?', createdAt: new Date().toISOString(), screenshot: '', evidence: ev, images: imgs };
    var p = hasKey() ? callAI(BR.SHOT_SYS, (ask || 'Tear this down.') + '\n\nMeasured data: ' + JSON.stringify(notes), imgs.map(function (i) { return { mime: i.mime, base64: i.base64 }; }), { minTokens: 6000 }).then(function (r) { t.report = r.text; t.reportBy = 'AI vision · ' + r.provider + ' ' + r.model; })
      : Promise.resolve().then(function () { t.report = '> Screenshot measured locally. Add a free Gemini key in Advanced AI Settings for the full AI vision teardown.\n\n## Design system\n\n' + notes.map(function (n) { return '- Image ' + n.image + ' (' + n.size + ', ' + n.likely + '): ' + n.palette.map(function (c) { return '`' + c + '`'; }).join(' '); }).join('\n') + "\n\n## What the evidence can't show\n\n- Everything beyond pixels and colors without an AI key."; t.reportBy = 'local'; });
    p.then(function () { t.verdict = ((t.report.split('\n').filter(function (l) { return /^>/.test(l); })[0]) || '').replace(/^>\s*/, ''); t.screenshot = imgs[0].thumb || ''; current = t; saveTeardown(t); ui.done(); setTimeout(function () { location.hash = '#/report/' + t.id; }, 300); })
      .catch(function (e) { ui.fail(e.message); toast(e.message, 5000); });
  }

  /* ---------- report ---------- */
  function renderReport() {
    var t = current; if (!t) { location.hash = '#/'; return; }
    $('#rTitle').textContent = t.title || t.target;
    var ev = t.evidence || {};
    $('#rMeta').innerHTML = (t.kind === 'website' ? 'Site: <a href="' + esc(t.target) + '" target="_blank" rel="noopener">' + esc(t.target) + '</a>' : 'Target: ' + esc(t.target) + (ev.format ? ' · ' + esc(ev.format) : '')) +
      ' · captured ' + esc(new Date(t.createdAt).toLocaleString()) + ' with <span class="neon">Bizzle X-Ray v4.20</span> · ' + esc(t.reportBy || '') + '<br>Asked: ' + esc(t.ask || '');
    var shot = $('#rShot');
    var src = t.screenshot || (t.images && t.images[0] && (t.images[0].dataUrl || t.images[0].thumb)) || '';
    if (src) { shot.hidden = false; shot.src = src; shot.onerror = function () { if (t.kind === 'website' && shot.src.indexOf('thum.io') < 0) shot.src = S.screenshotUrl(t.target); else shot.hidden = true; }; } else shot.hidden = true;
    var body = $('#rBody');
    var stackChips = (ev.stack || []).length ? '<div class="stackgrid">' + ev.stack.map(function (s) { return '<span title="' + esc(s.category) + '">' + esc(s.name + (s.version ? ' ' + s.version : '')) + '</span>'; }).join('') + '</div>' : '';
    var pal = ((ev.design && ev.design.palette) || []).concat(((ev.design && ev.design.colors) || []).map(function (c) { return c[0]; })).filter(function (c) { return /^#[0-9a-f]{3,8}$/i.test(c); }).slice(0, 14);
    var palHtml = pal.length ? '<div class="small muted">Palette: ' + pal.map(function (c) { return '<span class="swatch" title="' + c + '" style="background:' + c + '"></span>'; }).join('') + '</div>' : '';
    var full = (t.report || '') + '\n\n' + BR.evidenceMd(ev);
    body.innerHTML = stackChips + palHtml + BR.md(full).replace(/<li><strong>(E\d+)<\/strong>/g, '<li id="ev-$1"><strong>$1</strong>');
    addCopy(body, function () { return full; });
    $('#rRaw').textContent = JSON.stringify(slimEvidence(ev), null, 1).slice(0, 200000);
    var raw = $('#rRaw').parentNode; if (!raw.querySelector('.copy')) addCopy(raw, function () { return $('#rRaw').textContent; });
  }
  function readAloud() {
    if (!current) return;
    if (speechSynthesis && speechSynthesis.speaking) { speechSynthesis.cancel(); $('#readAloud').textContent = '🔊 Read it to me'; return; }
    if (speak(current.report, function () { $('#readAloud').textContent = '🔊 Read it to me'; })) $('#readAloud').textContent = '⏹ Stop reading';
  }
  $('#readAloud').onclick = readAloud;
  $('#goPlan').onclick = function () { location.hash = '#/plan/' + current.id; };
  $('#goBuild').onclick = function () { location.hash = '#/build/' + current.id; };
  $('#goPrompts').onclick = function () { location.hash = '#/prompts/' + current.id; };
  $('#dlMd').onclick = function () { download(slug(current.title) + '-teardown.md', mdDoc(current), 'text/markdown'); };
  $('#obsidian').onclick = function () {
    var doc = mdDoc(current);
    if (doc.length > 6000) { download(slug(current.title) + '-teardown.md', doc, 'text/markdown'); toast('Long teardown: downloaded .md. Drop it in your Obsidian vault.', 4000); return; }
    location.href = 'obsidian://new?name=' + encodeURIComponent('Teardown ' + slug(current.title)) + '&content=' + encodeURIComponent(doc);
  };
  function mdDoc(t) { return '---\ntarget: ' + t.target + '\ncaptured: ' + t.createdAt + '\ntool: Bizzle X-Ray v4.20\nwriter: ' + (t.reportBy || '') + '\n---\n# Teardown: ' + (t.title || t.target) + '\n\nAsked: ' + (t.ask || '') + '\n\n' + (t.report || '') + '\n\n' + BR.evidenceMd(t.evidence || {}) + '\n'; }
  $('#aiRewrite').onclick = function () {
    if (!hasKey()) { toast('Add a free key in Advanced AI Settings first'); location.hash = '#/settings'; return; }
    var b = $('#aiRewrite'); b.disabled = true; b.textContent = '✨ Writing…';
    var t = current, p = t.kind === 'screenshot' ? callAI(BR.SHOT_SYS, t.ask + '\n\nMeasured: ' + JSON.stringify(t.evidence.imageNotes), (t.images || []).filter(function (i) { return i.base64; }).map(function (i) { return { mime: i.mime, base64: i.base64 }; }), { minTokens: 6000 })
      : callAI(BR.REPORT_SYS, BR.reportPrompt(t.evidence, t.ask), [], { minTokens: 6000 });
    p.then(function (r) { t.report = r.text; t.reportBy = 'AI · ' + r.provider + ' ' + r.model; t.verdict = ((t.report.split('\n').filter(function (l) { return /^>/.test(l); })[0]) || '').replace(/^>\s*/, ''); saveTeardown(t); renderReport(); toast('Teardown rewritten ✓'); })
      .catch(function (e) { toast(e.message, 6000); }).then(function () { b.disabled = false; b.textContent = '✨ Write with AI'; });
  };

  /* ---------- plan ---------- */
  function localPlan(t) {
    var ev = t.evidence || {}, d = ev.design || {};
    var cols = (d.palette || []).concat((d.colors || []).map(function (c) { return c[0]; })).slice(0, 6);
    return '## Goal\n\nAn original app inspired by **' + (t.title || t.target) + '**, with your own name, copy and assets.\n\n## Stack (free)\n\n- ' + BR.rebuildSteps(ev)[0].replace('Scaffold a free stack: ', '') + '\n- Git + GitHub Pages / Netlify free tier\n\n## Steps\n\n' + BR.rebuildSteps(ev).map(function (s, i) { return (i + 1) + '. ' + s + ' **Check:** works at 360 px and 1440 px.'; }).join('\n') +
      '\n\n## Design tokens\n\n```css\n:root {\n' + cols.map(function (c, i) { return '  --color-' + (i + 1) + ': ' + c + ';'; }).join('\n') + '\n  --font-body: ' + ((d.fonts && d.fonts[0] && d.fonts[0][0]) || 'system-ui') + ', sans-serif;\n' + ((d.spacing || []).slice(0, 5).map(function (s, i) { return '  --space-' + (i + 1) + ': ' + s[0] + ';'; }).join('\n')) + '\n  --radius: ' + ((d.radii && d.radii[0] && d.radii[0][0]) || '12px') + ';\n}\n```\n\n## Risks & unknowns\n\n' + (ev.cantSee || []).map(function (s) { return '- ' + s; }).join('\n');
  }
  function renderPlan() {
    var t = current; $('#pTitle').textContent = t.title || t.target;
    var body = $('#planBody'); var txt = t.plan || localPlan(t);
    body.innerHTML = (t.plan ? '' : '<p class="muted small">Local plan from the evidence. Tap “Generate with AI” for a deeper one.</p>') + BR.md(txt);
    addCopy(body, function () { return txt; });
  }
  $('#planAi').onclick = function () {
    if (!hasKey()) { toast('Add a free key in Advanced AI Settings first'); location.hash = '#/settings'; return; }
    var b = $('#planAi'); b.disabled = true; b.textContent = '✨ Planning…';
    callAI(BR.PLAN_SYS, 'TEARDOWN of ' + current.target + ':\n\n' + (current.report || '').slice(0, 12000), [], { minTokens: 6000 })
      .then(function (r) { current.plan = r.text; saveTeardown(current); renderPlan(); toast('Plan ready ✓'); }, function (e) { toast(e.message, 6000); })
      .then(function () { b.disabled = false; b.textContent = '✨ Generate with AI'; });
  };
  $('#planToBuild').onclick = function () { location.hash = '#/build/' + current.id; };

  /* ---------- build ---------- */
  function setStage(st, cls) { var el = $('.stages [data-st="' + st + '"]'); if (el) { el.className = cls || ''; } }
  function resetStages() { ['scaffold', 'code', 'test', 'launch'].forEach(function (s) { setStage(s, ''); }); }
  function blog(who, msg) { var l = $('#bLog'); l.innerHTML += '<b>' + esc(who) + '</b> · ' + esc(msg) + '\n'; l.scrollTop = l.scrollHeight; }
  function renderBuild() {
    var t = current; $('#bTitle').textContent = t.title || t.target; $('#bLog').innerHTML = ''; resetStages();
    blog('BIZZY', 'blueprint: Teardown · ' + (t.title || t.target));
    if (t.code) { showCode(t.code); ['scaffold', 'code', 'test', 'launch'].forEach(function (s) { setStage(s, 'done'); }); blog('BUILDER', 'loaded the last build from the vault'); }
    else { showCode(''); blog('BUILDER', hasKey() ? 'ready. Tap “Build with AI”, or get an instant starter.' : 'no AI key: use “Instant starter”, or add a free key for a full AI build.'); }
  }
  /* Sandboxed previews have no allow-same-origin, so storage throws. Shim it in-memory (downloads keep the original code). */
  var SHIM = '<script>(function(){try{window.localStorage.length}catch(e){var mk=function(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},get length(){return Object.keys(d).length}}};try{Object.defineProperty(window,"localStorage",{value:mk(),configurable:true});Object.defineProperty(window,"sessionStorage",{value:mk(),configurable:true})}catch(_){}}})();<\/script>';
  function withShim(code) { code = code || ''; if (/<head[^>]*>/i.test(code)) return code.replace(/<head[^>]*>/i, function (m) { return m + SHIM; }); return SHIM + code; }
  window.XRAY_SHIM = SHIM;
  function harness(code) {
    var probe = '<script>(function(){var P=function(m){try{parent.postMessage(Object.assign({bxTest:1},m),"*")}catch(e){}};window.addEventListener("error",function(e){P({type:"error",msg:String(e.message||e)+(e.lineno?" @"+e.lineno:"")})});window.addEventListener("unhandledrejection",function(e){P({type:"error",msg:"Unhandled promise: "+String(e.reason)})});var ce=console.error;console.error=function(){P({type:"error",msg:Array.prototype.join.call(arguments," ")});ce.apply(console,arguments)};window.addEventListener("load",function(){setTimeout(function(){var b=document.body;P({type:"done",elements:b?b.querySelectorAll("*").length:0,text:b?(b.innerText||"").trim().length:0,buttons:document.querySelectorAll("button,a,[onclick],input").length,title:document.title})},1200)})})();<\/script>';
    probe = SHIM + probe;
    if (/<head[^>]*>/i.test(code)) return code.replace(/<head[^>]*>/i, function (m) { return m + probe; });
    return probe + code;
  }
  function testCode(code) {
    return new Promise(function (res) {
      var f = document.createElement('iframe'); f.setAttribute('sandbox', 'allow-scripts allow-forms'); f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1024px;height:768px;visibility:hidden';
      var errors = [], finished = false;
      function onMsg(e) { if (e.source !== f.contentWindow || !e.data || !e.data.bxTest) return; if (e.data.type === 'error') errors.push(e.data.msg); if (e.data.type === 'done') end(e.data); }
      function end(info) { if (finished) return; finished = true; window.removeEventListener('message', onMsg); f.remove(); var ok = !!info && info.elements > 3 && errors.length === 0; res({ ok: ok, errors: errors, info: info || { elements: 0 } }); }
      window.addEventListener('message', onMsg);
      document.body.appendChild(f); f.srcdoc = harness(code);
      setTimeout(function () { end(null); }, 9000);
    });
  }
  function showCode(code) {
    $('#srcView').textContent = code || '(no build yet)';
    var pre = $('#srcView').parentNode; if (!pre.querySelector('.copy')) addCopy(pre, function () { return current && current.code || ''; });
    $('#preview').srcdoc = code ? withShim(code) : '<body style="font:16px system-ui;display:grid;place-items:center;height:90vh;color:#555">Your build will appear here.</body>';
    ['openWin', 'dlHtml', 'cpHtml'].forEach(function (id) { $('#' + id).disabled = !code; });
  }
  function runPipeline(getCode, label) {
    resetStages(); setStage('scaffold', 'run'); blog('BUILDER', 'deploying… online — sandboxed'); blog('BUILDER', 'SCAFFOLD · ' + label);
    $('#testResult').textContent = '';
    var btns = ['#buildAi', '#buildLocal', '#buildIterate']; btns.forEach(function (b) { $(b).disabled = true; });
    setStage('scaffold', 'done'); setStage('code', 'run'); blog('BUILDER', 'CODE · writing the app');
    var t = current, attempt = 0;
    function cycle(code) {
      setStage('code', 'done'); setStage('test', 'run'); blog('BUILDER', 'TEST · loading it in a hidden browser (' + Math.round(code.length / 1024) + ' KB)');
      return testCode(code).then(function (r) {
        if (r.ok) { setStage('test', 'done'); blog('TESTER', 'passed: ' + r.info.elements + ' elements, ' + r.info.buttons + ' interactive, no errors'); return code; }
        blog('TESTER', 'found ' + (r.errors.length ? r.errors.length + ' error(s): ' + r.errors.slice(0, 3).join(' | ') : 'an empty or slow page'));
        if (attempt++ < 1 && hasKey() && label.indexOf('starter') < 0) {
          setStage('test', 'fail'); setStage('code', 'run'); blog('BUILDER', 'CODE · fixing and retrying once');
          return callAI(BR.CLONE_SYS, 'This HTML app failed its test with: ' + (r.errors.join('\n') || 'empty page / no load event') + '\nFix it and return the full corrected HTML.\n\n```html\n' + code.slice(0, 60000) + '\n```', [], { minTokens: 16000, temperature: 0.3, timeoutMs: 200000 }).then(function (x) { return cycle(BR.extractCode(x.text)); });
        }
        setStage('test', 'fail'); $('#testResult').textContent = 'Test warnings: ' + (r.errors.join(' | ') || 'page looked empty') + '. You can still open it or ask for a change.'; return code;
      });
    }
    return getCode().then(cycle).then(function (code) {
      t.code = code; saveTeardown(t); showCode(code);
      setStage('launch', 'done'); blog('BIZZY', 'LAUNCH · ready. Open it as its own window, download it, or ask for a change.');
      if (!$('#testResult').textContent) $('#testResult').textContent = 'Passed the hidden-browser test ✓';
    }).catch(function (e) { ['code', 'test'].forEach(function (s) { var el = $('.stages [data-st="' + s + '"]'); if (el && el.className === 'run') el.className = 'fail'; }); blog('BUILDER', 'failed: ' + e.message); toast(e.message, 6000); })
      .then(function () { btns.forEach(function (b) { $(b).disabled = false; }); });
  }
  function buildAI(extra) {
    if (!hasKey()) { toast('Add a free key in Advanced AI Settings (or use Instant starter)'); return; }
    var t = current;
    runPipeline(function () {
      return callAI(BR.CLONE_SYS, (extra ? 'Request: ' + extra + '\n\n' : '') + 'Build an original app inspired by this teardown of ' + t.target + '.\n\n' + (t.report || '').slice(0, 14000) + (t.plan ? '\n\nREBUILD PLAN:\n' + t.plan.slice(0, 5000) : ''), (t.images || []).filter(function (i) { return i.base64; }).slice(0, 2).map(function (i) { return { mime: i.mime, base64: i.base64 }; }), { minTokens: 16000, temperature: 0.5, timeoutMs: 200000 })
        .then(function (r) { blog('BUILDER', 'code from ' + r.model + ' (' + (r.completionTokens || '?') + ' tokens)'); return BR.extractCode(r.text); });
    }, 'AI build');
  }
  $('#buildAi').onclick = function () { buildAI(''); };
  $('#buildLocal').onclick = function () { runPipeline(function () { return Promise.resolve(BR.localClone(current.evidence || {})); }, 'instant starter from evidence'); };
  $('#buildIterate').onclick = function () {
    var req = $('#buildTweak').value.trim(); if (!req) { toast('Describe the change first'); return; }
    if (!current.code) { buildAI(req); return; }
    if (!hasKey()) { toast('Changes need a free AI key'); return; }
    runPipeline(function () { return callAI(BR.CLONE_SYS, 'Apply this change to the app and return the full updated HTML: ' + req + '\n\n```html\n' + current.code.slice(0, 60000) + '\n```', [], { minTokens: 16000, temperature: 0.4, timeoutMs: 200000 }).then(function (r) { return BR.extractCode(r.text); }); }, 'change: ' + req);
  };
  $$('.ptab').forEach(function (b) { b.onclick = function () { $$('.ptab').forEach(function (x) { x.classList.toggle('on', x === b); }); $$('.pp').forEach(function (p) { p.classList.toggle('on', p.getAttribute('data-pp') === b.getAttribute('data-p')); }); }; });
  $$('.vwb').forEach(function (b) { b.onclick = function () { $$('.vwb').forEach(function (x) { x.classList.toggle('on', x === b); }); var w = b.getAttribute('data-w'); $('#preview').style.width = w === '100%' ? '100%' : w + 'px'; }; });
  $('#openWin').onclick = function () {
    if (!current || !current.code) return;
    if (!isNative()) {
      try { localStorage.setItem('bx.launch', JSON.stringify({ title: current.title, code: current.code })); } catch (e) {}
      var w = window.open('launch.html', '_blank', 'width=1200,height=800');
      if (w) return;
    }
    $('#winTitle').textContent = (current.title || 'App') + ' · your build'; $('#winFrame').srcdoc = withShim(current.code); $('#winOverlay').hidden = false;
  };
  function closeWin() { $('#winOverlay').hidden = true; $('#winFrame').srcdoc = ''; }
  $('#winBack').onclick = closeWin;
  $('#dlHtml').onclick = function () { download(slug(current.title) + '-rebuild.html', current.code, 'text/html'); };
  $('#cpHtml').onclick = function () { copyText(current.code); };

  /* ---------- prompts ---------- */
  function renderPrompts() {
    var t = current; $('#prTitle').textContent = t.title || t.target;
    var box = $('#promptList'); box.innerHTML = '';
    BR.promptPack(t).forEach(function (p) { var d = document.createElement('div'); d.className = 'prompt reply'; d.innerHTML = '<h3>' + esc(p.title) + '</h3><pre>' + esc(p.text) + '</pre>'; addCopy(d, p.text); box.appendChild(d); });
  }

  /* ---------- vault ---------- */
  function renderVault() {
    var q = ($('#vSearch').value || '').toLowerCase(), box = $('#vaultList'); box.innerHTML = '';
    var v = vault().filter(function (t) { return !q || (t.title + ' ' + t.target + ' ' + (t.report || '')).toLowerCase().indexOf(q) >= 0; });
    if (!v.length) box.innerHTML = '<p class="muted">Nothing here yet. Every teardown is saved automatically, like a second brain.</p>';
    v.forEach(function (t) { box.appendChild(itemEl(t, true)); });
  }
  $('#vSearch').oninput = renderVault;
  $('#vExport').onclick = function () { download('bizzle-xray-vault.json', JSON.stringify(vault(), null, 1), 'application/json'); };
  $('#vImport').onchange = function () {
    var f = this.files[0]; if (!f) return;
    f.text().then(function (txt) { var arr = JSON.parse(txt); if (!Array.isArray(arr)) throw new Error('Not a vault export'); var v = vault(), ids = v.map(function (x) { return x.id; }); arr.forEach(function (t) { if (t && t.id && ids.indexOf(t.id) < 0) v.push(t); }); saveVault(v); renderVault(); toast('Imported ' + arr.length); }).catch(function (e) { toast('Import failed: ' + e.message); });
    this.value = '';
  };

  /* ---------- settings ---------- */
  function renderSettings() {
    var s = AI.getSettings(), k = AI.getKeys();
    $('#sProvider').value = s.provider; $('#sEffort').value = s.effort || 'Pro'; $('#tierInfo').textContent = AI.TIER_INFO[s.effort || 'Pro'];
    $('#sTemp').value = s.temperature; $('#sTempV').textContent = s.temperature; $('#sMax').value = s.maxTokens; $('#sSys').value = s.systemPrompt || ''; $('#sVoice').checked = !!s.voice; $('#sScripts').value = opts().maxScripts;
    var rows = $('#keyRows'); rows.innerHTML = '';
    Object.keys(AI.PROVIDERS).forEach(function (p) {
      var P = AI.PROVIDERS[p];
      var wrap = document.createElement('div');
      wrap.innerHTML = '<label for="key-' + p + '">' + esc(P.label) + ' API key ' + (k[p] ? '<span class="neon small">● saved</span>' : '') + ' · <a href="' + P.keyUrl + '" target="_blank" rel="noopener">get a free key</a></label><div class="keyrow"><input type="password" id="key-' + p + '" autocomplete="off" spellcheck="false" placeholder="' + (k[p] ? '•••••••• (saved on this device)' : 'paste key') + '"><button class="btn ghost" type="button" data-show="' + p + '">👁️</button><button class="btn ghost" type="button" data-clear="' + p + '">✕</button></div>';
      rows.appendChild(wrap);
    });
    $$('[data-show]').forEach(function (b) { b.onclick = function () { var i = $('#key-' + b.getAttribute('data-show')); i.type = i.type === 'password' ? 'text' : 'password'; }; });
    $$('[data-clear]').forEach(function (b) { b.onclick = function () { var kk = AI.getKeys(); delete kk[b.getAttribute('data-clear')]; AI.setKeys(kk); renderSettings(); toast('Key removed'); }; });
    fillModels(s.provider, null); renderSwatches();
  }
  function fillModels(provider, list) {
    var sel = $('#sModel'), s = AI.getSettings(), cur = s.model || '';
    var ids = list ? list.map(function (m) { return m.id; }) : AI.PROVIDERS[provider].models;
    sel.innerHTML = '<option value="">Auto (by tier)</option>' + ids.map(function (id) { return '<option' + (id === cur ? ' selected' : '') + '>' + esc(id) + '</option>'; }).join('');
    if (cur && ids.indexOf(cur) < 0) sel.innerHTML += '<option selected>' + esc(cur) + '</option>';
  }
  $('#sProvider').onchange = function () { fillModels(this.value); };
  $('#sEffort').onchange = function () { $('#tierInfo').textContent = AI.TIER_INFO[this.value]; };
  $('#sTemp').oninput = function () { $('#sTempV').textContent = this.value; };
  $('#loadModels').onclick = function () { var p = $('#sProvider').value; AI.listModels(p).then(function (l) { fillModels(p, l); toast(l.length + ' models'); }, function (e) { toast('Could not list models: ' + e.message); }); };
  function collectSettings() {
    var s = AI.getSettings(), prevProvider = s.provider;
    s.provider = $('#sProvider').value; s.effort = $('#sEffort').value; s.model = $('#sModel').value; if (s.provider !== prevProvider && s.model && AI.PROVIDERS[s.provider].models.indexOf(s.model) < 0) s.model = '';
    s.temperature = +$('#sTemp').value; s.maxTokens = Math.max(256, +$('#sMax').value || 8192); s.systemPrompt = $('#sSys').value.trim(); s.voice = $('#sVoice').checked;
    AI.setSettings(s);
    var k = AI.getKeys(); Object.keys(AI.PROVIDERS).forEach(function (p) { var v = ($('#key-' + p) || {}).value; if (v && v.trim()) k[p] = v.trim(); }); AI.setKeys(k);
    var o = opts(); o.maxScripts = Math.max(0, Math.min(15, +$('#sScripts').value || 0)); localStorage.setItem(LS_OPTS, JSON.stringify(o));
  }
  $('#saveSet').onclick = function () { collectSettings(); renderSettings(); $('#setMsg').textContent = 'Saved on this device ✓'; toast('Settings saved ✓'); };
  $('#testKey').onclick = function () {
    collectSettings(); renderSettings(); $('#setMsg').textContent = 'Testing…';
    callAI('Reply with exactly: X-RAY ONLINE', 'ping', [], { temperature: 0 }).then(function (r) { $('#setMsg').textContent = '✓ ' + r.provider + ' · ' + r.model + ' replied: ' + r.text.slice(0, 60); }, function (e) { $('#setMsg').textContent = '✕ ' + e.message; });
  };
  $('#wipe').onclick = function () { if (!confirm('Delete all teardowns, keys, settings and Bizzy memory from this device?')) return; Object.keys(localStorage).filter(function (k) { return k.indexOf('bx.') === 0; }).forEach(function (k) { localStorage.removeItem(k); }); applyTheme('neon'); renderSettings(); bzRender(); toast('All local data cleared'); };

  /* ---------- Bizzy Bot ---------- */
  var bzImgs = [];
  function bzMem() { try { return JSON.parse(localStorage.getItem(LS_BZ_MEM) || '[]'); } catch (e) { return []; } }
  function bzSetMem(m) { localStorage.setItem(LS_BZ_MEM, JSON.stringify(m.slice(-50))); }
  function bzHist() { try { return JSON.parse(localStorage.getItem(LS_BZ_HIST) || '[]'); } catch (e) { return []; } }
  function bzSetHist(h) { try { localStorage.setItem(LS_BZ_HIST, JSON.stringify(h.slice(-40))); } catch (e) {} }
  function openBizzy() { $('#bizzy').hidden = false; bzRender(); setTimeout(function () { $('#bzText').focus(); }, 50); }
  function closeBizzy() { $('#bizzy').hidden = true; }
  $('#bizzyBtn').onclick = function () { $('#bizzy').hidden ? openBizzy() : closeBizzy(); };
  $('#bzClose').onclick = closeBizzy;
  $('#bzBack').onclick = function () { if (!$('#bzMemPane').hidden) { $('#bzMemPane').hidden = true; } else closeBizzy(); };
  $('#bzMem').onclick = function () { $('#bzMemPane').hidden = !$('#bzMemPane').hidden; bzRenderMem(); };
  function bzRenderMem() {
    var ul = $('#bzMemList'); ul.innerHTML = '';
    var m = bzMem(); if (!m.length) ul.innerHTML = '<li class="muted small">No memories yet.</li>';
    m.forEach(function (x, i) { var li = document.createElement('li'); li.textContent = x; var b = document.createElement('button'); b.textContent = '✕'; b.title = 'Forget'; b.onclick = function () { var mm = bzMem(); mm.splice(i, 1); bzSetMem(mm); bzRenderMem(); }; li.appendChild(b); ul.appendChild(li); });
  }
  $('#bzMemAdd').onclick = function () { var v = $('#bzMemIn').value.trim(); if (!v) return; var m = bzMem(); m.push(v); bzSetMem(m); $('#bzMemIn').value = ''; bzRenderMem(); };
  $('#bzMemClear').onclick = function () { if (confirm('Clear Bizzy memory?')) { bzSetMem([]); bzSetHist([]); bzRenderMem(); bzRender(); } };
  function bzMsgEl(m) {
    var d = document.createElement('div'); d.className = 'msg ' + (m.role === 'user' ? 'user' : 'bot reply');
    if (m.role === 'user') { d.textContent = m.text; (m.thumbs || []).forEach(function (u) { var i = document.createElement('img'); i.src = u; i.alt = 'attachment'; d.appendChild(i); }); }
    else { d.innerHTML = BR.md(m.text); addCopy(d, m.text); }
    return d;
  }
  function bzRender() {
    var box = $('#bzMsgs'); box.innerHTML = '';
    var h = bzHist();
    if (!h.length) box.appendChild(bzMsgEl({ role: 'assistant', text: 'Hi, I’m **Bizzy** 🤖. Ask me about any teardown, paste a screenshot for help, or say “reverse engineer stripe.com”. Say “remember …” and I’ll keep it in memory.' }));
    h.forEach(function (m) { box.appendChild(bzMsgEl(m)); });
    box.scrollTop = box.scrollHeight;
  }
  function bzAdd(files) { Array.prototype.forEach.call(files, function (f) { if (!/^image\//.test(f.type)) return; fileToImage(f, 1400).then(function (im) { im.thumb = thumbOf(im); bzImgs.push(im); drawThumbs($('#bzThumbs'), bzImgs); }); }); }
  $('#bzFile').onchange = function () { bzAdd(this.files); this.value = ''; };
  $('#bzText').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); bzSend(); } });
  $('#bzText').addEventListener('input', function () { this.style.height = 'auto'; this.style.height = Math.min(120, this.scrollHeight) + 'px'; });
  $('#bzSend').onclick = function () { bzSend(); };
  function bzSend(preset) {
    var text = (preset || $('#bzText').value).trim(); if (!text && !bzImgs.length) return;
    $('#bzText').value = ''; $('#bzText').style.height = 'auto';
    var imgs = bzImgs.slice(); bzImgs = []; drawThumbs($('#bzThumbs'), bzImgs);
    var h = bzHist(); h.push({ role: 'user', text: text || '(screenshot)', thumbs: imgs.map(function (i) { return i.thumb; }) }); bzSetHist(h); bzRender();
    var rem = /^(?:please\s+)?remember(?: that)?[:\s]+(.+)/i.exec(text);
    if (rem) { var m = bzMem(); m.push(rem[1].trim()); bzSetMem(m); return bzReply('Got it, I’ll remember: “' + rem[1].trim() + '” 🧠'); }
    if (/^(what do you remember|show memory|memories)\??$/i.test(text)) { var mm = bzMem(); return bzReply(mm.length ? 'Here’s what I remember:\n\n' + mm.map(function (x) { return '- ' + x; }).join('\n') : 'Nothing yet. Say “remember …”.'); }
    if (/^(forget everything|clear memory)$/i.test(text)) { bzSetMem([]); return bzReply('Memory cleared.'); }
    var cmd = /^(?:reverse[- ]engineer|tear\s*down|x-?ray|scan)\s+(\S+)/i.exec(text);
    if (cmd && !imgs.length) { bzReply('On it: tearing down **' + cmd[1] + '**. I’ll open the report when it’s ready.'); startWebsite(cmd[1], text); return; }
    if (!hasKey()) return bzReply('I need a free AI key to chat. Open **⚙️ Advanced AI Settings** and paste a Gemini key (free at aistudio.google.com). I can still scan sites without one: say “reverse engineer example.com”.');
    var ctx = current ? '\n\nCURRENT TEARDOWN (' + current.target + '):\n' + (current.report || '').slice(0, 5000) : '';
    var sys = 'You are Bizzy Bot, the friendly helper inside Bizzle X-Ray v4.20 (a free reverse-engineering teardown PWA). Be concise and practical; use Markdown. ' + BR.ETHICS +
      ' App features: Website/Screenshot/App package/Paste code teardowns, Rebuild plan, Build my version (sandboxed preview, test, open as window, download), Prompts, Vault, Advanced AI Settings, themes, read aloud, voice commands.' +
      '\n\nLONG-TERM MEMORY about the user (use it naturally):\n' + (bzMem().map(function (x) { return '- ' + x; }).join('\n') || '(none)') + ctx;
    var msgs = bzHist().slice(-12).map(function (m) { return { role: m.role === 'user' ? 'user' : 'assistant', text: m.text }; });
    msgs[msgs.length - 1].images = imgs.map(function (i) { return { mime: i.mime, base64: i.base64 }; });
    var typing = document.createElement('div'); typing.className = 'msg bot'; typing.textContent = 'Bizzy is thinking…'; $('#bzMsgs').appendChild(typing);
    callAI(sys, '', null, { messages: msgs, minTokens: 2048 }).then(function (r) { bzReply(r.text); }, function (e) { bzReply('⚠️ ' + e.message); });
  }
  function bzReply(text) { var h = bzHist(); h.push({ role: 'assistant', text: text }); bzSetHist(h); bzRender(); }

  /* ---------- PWA + native ---------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !isNative()) {
    navigator.serviceWorker.register('sw.js?v=' + window.XRAY_BUILD).then(function (reg) {
      reg.addEventListener('updatefound', function () { var nw = reg.installing; if (!nw) return; nw.addEventListener('statechange', function () { if (nw.state === 'installed' && navigator.serviceWorker.controller) { toast('Updating to the newest build…'); nw.postMessage('skipWaiting'); } }); });
      setInterval(function () { reg.update().catch(function () {}); }, 30 * 60 * 1000);
    }).catch(function () {});
    var reloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () { if (reloaded) return; reloaded = true; location.reload(); });
  }
  if (isNative() && window.Capacitor.Plugins && window.Capacitor.Plugins.App) {
    window.Capacitor.Plugins.App.addListener('backButton', function () {
      if (!$('#bizzy').hidden) { closeBizzy(); return; }
      if (!$('#winOverlay').hidden) { closeWin(); return; }
      if (location.hash && location.hash !== '#/' && location.hash !== '#') goBack(); else window.Capacitor.Plugins.App.exitApp();
    });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!$('#winOverlay').hidden) closeWin(); else if (!$('#bizzy').hidden) closeBizzy(); } });

  /* ---------- boot ---------- */
  applyTheme(AI.getSettings().theme || 'neon');
  window.XApp = { runCommand: runCommand, startWebsite: startWebsite, getCurrent: function () { return current; }, testCode: testCode, goBack: goBack };
  route();
})();
