/* Bizzle X-Ray v4.20 — teardown writer, rebuild planner, clone builder, prompt pack, markdown.
   AI is optional: every step has a local (no-key) fallback built from the evidence alone. */
(function () {
  'use strict';
  var B = window.XScan.bytes, top = window.XScan.top;

  var ETHICS = 'Rules: analyse only what the evidence shows; mark guesses as "likely". Never reproduce copyrighted text, logos, brand names, trademarks or proprietary assets. Rebuilds are ORIGINAL work for learning and inspiration: new name, new copy, placeholder content, own styling inspired by (not copied from) the target.';

  function compactEvidence(ev) {
    var o = { kind: ev.kind, target: ev.target, format: ev.format, platform: ev.platform };
    if (ev.dom) o.dom = { title: ev.dom.title, lang: ev.dom.lang, meta: pick(ev.dom.meta, ['description', 'og:title', 'og:type', 'theme-color', 'generator', 'viewport']), counts: ev.dom.counts, headings: ev.dom.headings.slice(0, 20), landmarks: ev.dom.landmarks, navLinks: ev.dom.links.nav, links: { internal: ev.dom.links.internal, external: ev.dom.links.external }, forms: ev.dom.forms, buttons: ev.dom.buttons.slice(0, 15), jsonld: ev.dom.jsonld, wordCount: ev.dom.wordCount, scripts: ev.dom.scripts.length, inlineScripts: ev.dom.inlineScripts.length, topClasses: ev.dom.topClasses.slice(0, 15).map(function (x) { return x[0]; }), textSample: ev.dom.textSample.slice(0, 700) };
    if (ev.renderedDom) o.renderedDom = { counts: ev.renderedDom.counts, headings: ev.renderedDom.headings.slice(0, 15), buttons: ev.renderedDom.buttons.slice(0, 12), wordCount: ev.renderedDom.wordCount, textSample: ev.renderedDom.textSample.slice(0, 500) };
    if (ev.microlink) o.microlink = { title: ev.microlink.title, description: ev.microlink.description, palette: ev.microlink.palette, background: ev.microlink.background };
    o.stack = (ev.stack || []).map(function (s) { return { name: s.name, version: s.version, category: s.category, evidence: (s.evidence || []).slice(0, 2).map(function (e) { return e.file + ': ' + (e.context || e.match).slice(0, 120); }) }; });
    if (ev.design) o.design = ev.design;
    if (ev.code) o.code = { endpoints: ev.code.endpoints.slice(0, 25), routes: ev.code.routes.slice(0, 20), sourceMaps: ev.code.sourceMaps, prompts: ev.code.prompts.slice(0, 5), storageKeys: ev.code.storageKeys.slice(0, 15), workers: ev.code.workers, dynamicImports: ev.code.dynamicImports, assets: ev.code.assets.slice(0, 30) };
    if (ev.inventory) o.inventory = Object.keys(ev.inventory).reduce(function (a, k) { a[k] = { count: ev.inventory[k].length, sample: ev.inventory[k].slice(0, 6) }; return a; }, {});
    if (ev.loaded) o.loaded = ev.loaded.map(function (l) { return { type: l.type + (l.lazy ? ' (lazy chunk)' : ''), size: B(l.size), url: l.url }; });
    if (ev.chunkGraph) o.chunkGraph = ev.chunkGraph;
    if (ev.thirdParties) o.thirdParties = ev.thirdParties;
    if (ev.totals) o.totals = ev.totals;
    if (ev.manifest) o.manifest = ev.manifest;
    if (ev.extras) o.extras = ev.extras;
    if (ev.fileTypes) o.fileTypes = ev.fileTypes.map(function (f) { return f[0] + ': ' + f[1] + ' files, ' + B(f[2]); });
    if (ev.largest) o.largest = ev.largest.slice(0, 10).map(function (f) { return f.path + ' ' + B(f.size); });
    if (ev.tree) o.treeSample = ev.tree.slice(0, 80);
    if (ev.imageNotes) o.imageNotes = ev.imageNotes;
    o.errors = (ev.errors || []).slice(0, 8);
    o.cantSee = ev.cantSee;
    o.evidenceIds = (ev.evidence || []).slice(0, 60).map(function (e) { return e.id + ' ' + e.claim; });
    var s = JSON.stringify(o);
    if (s.length > 60000) { delete o.treeSample; delete o.dom && o.dom.textSample; s = JSON.stringify(o).slice(0, 60000); }
    return s;
  }
  function pick(obj, keys) { var o = {}; keys.forEach(function (k) { if (obj && obj[k]) o[k] = obj[k]; }); return o; }

  var REPORT_SYS = 'You are Bizzy, the analyst inside Bizzle X-Ray v4.20, a free reverse-engineering teardown tool. ' + ETHICS +
    ' Write a teardown in GitHub Markdown with EXACTLY these sections in order:\n' +
    'First line: a single-sentence verdict as a blockquote (> ...) that names the surprise.\n' +
    '## The answer (2-4 short paragraphs: what it really is, with numbers from the evidence)\n' +
    '## The stack (bullets: **Name version** — evidence type in parentheses, e.g. (fingerprint), (Wappalyzer), (strings `x`))\n' +
    '## Design system (colors with hex, fonts, type scale, spacing scale, radii, breakpoints, motion)\n' +
    '## Page structure (layout regions / screens / navigation)\n' +
    '## Features (bullets of user-facing features and how each likely works)\n' +
    '## APIs & data (endpoints, routes, storage, third parties, AI prompts if any)\n' +
    '## How it works (numbered steps of the runtime flow)\n' +
    '## What it loads (totals and biggest categories)\n' +
    '## Rebuild it (numbered, concrete, free/open-source stack, original design)\n' +
    '## What the evidence can\'t show\n' +
    'Cite evidence ids like [E3] where useful. Do not add an Evidence section; the app appends it. Be concrete, no filler.';

  function reportPrompt(ev, ask) {
    return 'Asked: ' + (ask || 'Reverse engineer ' + ev.target) + '\n\nEVIDENCE JSON:\n' + compactEvidence(ev);
  }

  /* ----- local no-key teardown ----- */
  function localReport(ev) {
    var L = [], st = ev.stack || [], d = ev.design || {}, c = ev.code || {};
    var cats = {}; st.forEach(function (s) { (cats[s.category] = cats[s.category] || []).push(s.name); });
    var mainUI = (cats['UI framework'] || cats['Meta-framework'] || cats['App framework'] || cats['Platform'] || ['plain HTML/JS'])[0];
    if (ev.kind === 'website') {
      var dc = ev.dom.counts, rc = ev.renderedDom && ev.renderedDom.counts;
      var webgl = st.some(function (s) { return /WebGL|Three|Babylon|Pixi/.test(s.name); });
      L.push('> ' + (ev.dom.title || ev.host) + ' is ' + (webgl ? 'a WebGL-driven experience' : (/^[aeiou]/i.test(mainUI) ? 'an ' : 'a ') + mainUI + ' site') + ' with ' + st.length + ' detected technologies' + (rc && rc.elements > dc.elements * 1.5 ? ', and most of its DOM is rendered by JavaScript.' : '.'));
      L.push('', '## The answer', '', (ev.dom.title || ev.host) + ' serves a ' + B(ev.html && ev.html.size) + ' HTML document with **' + dc.elements + ' elements** (' + dc.img + ' img, ' + dc.svg + ' svg, ' + dc.video + ' video, ' + dc.iframe + ' iframe, ' + dc.canvas + ' canvas)' + (rc ? ', growing to **' + rc.elements + '** after JavaScript runs' : '') + '. It references ' + (ev.dom.scripts.length) + ' external scripts and ' + ev.dom.styles.length + ' stylesheets.');
      if (ev.microlink && ev.microlink.description) L.push('', 'Self-description: "' + ev.microlink.description.slice(0, 200) + '"');
    } else {
      L.push('> ' + ev.target + ' is a ' + ev.format + ' (' + ev.platform + ')' + (st.length ? ' built with ' + st.slice(0, 3).map(function (s) { return s.name; }).join(', ') : '') + '.');
      L.push('', '## The answer', '', ev.target + ' contains **' + ev.fileCount + ' files** (' + B(ev.size) + '). ' + (ev.manifest.bundleId ? 'Bundle ' + ev.manifest.bundleId + ' v' + ev.manifest.version + ' (build ' + ev.manifest.build + '). ' : '') + (ev.manifest.package ? 'Package id candidate: ' + ev.manifest.package + '. ' : '') + ((ev.extras.extensions || []).length ? 'It ships ' + ev.extras.extensions.length + ' extensions: ' + ev.extras.extensions.join(', ') + '. ' : ''));
    }
    L.push('', '## The stack', '');
    if (!st.length) L.push('- No known fingerprints matched. Likely hand-written code or an unusual stack.');
    st.forEach(function (s) { var e = s.evidence[0] || {}; L.push('- **' + s.name + (s.version ? ' ' + s.version : '') + '** — ' + s.category + ' (' + (e.kind === 'insight' ? 'Wappalyzer' : e.kind === 'file' ? 'file' : 'fingerprint') + ' in `' + String(e.file || '').slice(0, 40) + '`)'); });
    L.push('', '## Design system', '');
    if ((d.colors || []).length) L.push('- **Colors:** ' + d.colors.slice(0, 10).map(function (x) { return '`' + x[0] + '`'; }).join(' '));
    if ((d.palette || []).length) L.push('- **Screenshot palette:** ' + d.palette.slice(0, 8).map(function (x) { return '`' + x + '`'; }).join(' '));
    if ((d.fonts || []).length) L.push('- **Fonts:** ' + d.fonts.map(function (x) { return x[0]; }).join(', '));
    if ((d.fontSizes || []).length) L.push('- **Type scale:** ' + d.fontSizes.slice(0, 8).map(function (x) { return x[0]; }).join(', '));
    if ((d.spacing || []).length) L.push('- **Spacing:** ' + d.spacing.slice(0, 10).map(function (x) { return x[0]; }).join(', '));
    if ((d.radii || []).length) L.push('- **Radii:** ' + d.radii.slice(0, 6).map(function (x) { return x[0]; }).join(', '));
    if ((d.breakpoints || []).length) L.push('- **Breakpoints:** ' + d.breakpoints.map(function (x) { return x[0]; }).join(', '));
    if ((d.keyframes || []).length) L.push('- **Animations:** ' + d.keyframes.slice(0, 10).join(', '));
    if ((d.cssVariables || []).length) L.push('- **CSS variables:** ' + d.cssVariables.length + ' found, e.g. `' + d.cssVariables.slice(0, 4).join('`, `') + '`');
    if (ev.kind === 'website') {
      L.push('', '## Page structure', '');
      var lm = ev.dom.landmarks; L.push('- Landmarks: ' + (Object.keys(lm).filter(function (k) { return lm[k]; }).map(function (k) { return k + ' ×' + lm[k]; }).join(', ') || 'none (plain div layout)'));
      if (ev.dom.links.nav.length) L.push('- Navigation: ' + ev.dom.links.nav.slice(0, 10).join(' · '));
      (ev.renderedDom || ev.dom).headings.slice(0, 10).forEach(function (h) { L.push('  ' + new Array(h.level).join('  ') + '- H' + h.level + ': ' + h.text); });
      L.push('', '## Features', '');
      if (!ev.dom.forms.length && !ev.dom.buttons.length && !(ev.renderedDom && ev.renderedDom.buttons.length)) L.push('- Mostly static content: no forms or buttons in the HTML' + (ev.dom.links.internal + ev.dom.links.external ? ', ' + (ev.dom.links.internal + ev.dom.links.external) + ' links' : '') + '.');
      if (ev.dom.forms.length) ev.dom.forms.forEach(function (f) { L.push('- Form (' + f.method.toUpperCase() + ' ' + (f.action || 'same page') + '): ' + f.fields.join(', ')); });
      var btn = (ev.renderedDom && ev.renderedDom.buttons.length ? ev.renderedDom.buttons : ev.dom.buttons); if (btn.length) L.push('- Actions: ' + btn.slice(0, 12).join(' · '));
      if (ev.dom.hasManifest) L.push('- Installable PWA (web manifest present)');
    } else {
      L.push('', '## Page structure', '');
      L.push('- Largest files: ' + ev.largest.slice(0, 6).map(function (f) { return '`' + f.path + '` ' + B(f.size); }).join(', '));
      L.push('- File types: ' + ev.fileTypes.slice(0, 8).map(function (f) { return f[0] + ' ×' + f[1]; }).join(', '));
      L.push('', '## Features', '');
      (ev.manifest.permissions || []).slice(0, 12).forEach(function (p) { L.push('- Permission: `' + p + '`'); });
      (ev.manifest.components || []).slice(0, 10).forEach(function (p) { L.push('- Component: `' + p + '`'); });
      (ev.extras.extensions || []).forEach(function (p) { L.push('- Extension: `' + p + '`'); });
    }
    L.push('', '## APIs & data', '');
    (c.endpoints || []).slice(0, 15).forEach(function (u) { L.push('- Endpoint: `' + u + '`'); });
    (c.routes || []).slice(0, 10).forEach(function (u) { L.push('- Route: `' + u + '`'); });
    (c.storageKeys || []).slice(0, 8).forEach(function (u) { L.push('- Storage key: `' + u + '`'); });
    (ev.thirdParties || []).slice(0, 10).forEach(function (h) { L.push('- Third party: ' + h[0] + ' (' + h[1] + ' refs)'); });
    (c.prompts || []).slice(0, 3).forEach(function (p) { L.push('- AI prompt-like string: "' + p.slice(0, 160) + '…"'); });
    if (!(c.endpoints || []).length && !(ev.thirdParties || []).length) L.push('- No endpoints found in the files read.');
    L.push('', '## How it works', '');
    var stepsW = ['The browser loads the HTML shell' + (ev.html ? ' (' + B(ev.html.size) + ')' : '') + '.', 'Scripts boot ' + mainUI + (c.dynamicImports ? ' and lazy-load ' + c.dynamicImports + ' dynamic chunks' : '') + '.', (c.workers ? c.workers + ' Web Worker(s) handle heavy work off the main thread.' : 'Work runs on the main thread (no workers seen).'), (c.endpoints || []).length ? 'Data comes from ' + c.endpoints.length + ' endpoint candidates.' : 'Content appears to be static or embedded.'];
    (ev.kind === 'website' ? stepsW : ['The OS launches the ' + ev.platform + ' entry point.', 'Framework runtime: ' + (st.length ? st[0].name : 'native code') + '.', 'Resources load from the bundle (' + ev.fileCount + ' files).']).forEach(function (s, i) { L.push((i + 1) + '. ' + s); });
    L.push('', '## What it loads', '');
    if (ev.inventory) Object.keys(ev.inventory).forEach(function (k) { L.push('- **' + k + ':** ' + ev.inventory[k].length + ' referenced'); });
    if (ev.loaded && ev.loaded.length) L.push('- Fetched and measured: ' + ev.loaded.length + ' files, ' + B(ev.totals && ev.totals.fetchedBytes));
    if (ev.fileTypes) ev.fileTypes.slice(0, 8).forEach(function (f) { L.push('- **.' + f[0] + ':** ' + f[1] + ' files, ' + B(f[2])); });
    L.push('', '## Rebuild it', '');
    rebuildSteps(ev).forEach(function (s, i) { L.push((i + 1) + '. ' + s); });
    L.push('', "## What the evidence can't show", '');
    (ev.cantSee || []).forEach(function (s) { L.push('- ' + s); });
    (ev.errors || []).slice(0, 4).forEach(function (s) { L.push('- Reader issue: ' + s.slice(0, 160)); });
    return L.join('\n');
  }

  function rebuildSteps(ev) {
    var st = (ev.stack || []).map(function (s) { return s.name; }).join(' ');
    var s = [];
    s.push('Scaffold a free stack: ' + (/Three|WebGL/.test(st) ? 'Vite + Three.js' : /React|Next/.test(st) ? 'Vite + React (or Next.js)' : /Vue|Nuxt/.test(st) ? 'Vite + Vue' : /Svelte/.test(st) ? 'SvelteKit' : /Flutter/.test(st) ? 'Flutter' : 'plain HTML/CSS/JS') + ', deployed on GitHub Pages or Netlify.');
    s.push('Define design tokens as CSS variables (colors, type scale, spacing, radii) inspired by the palette above, with your own brand.');
    s.push('Build the layout regions and navigation first, using semantic landmarks.');
    s.push('Implement each feature as an isolated component with placeholder content.');
    if (/GSAP|ScrollTrigger|Lenis|Framer/.test(st)) s.push('Add motion with GSAP + ScrollTrigger (free for most uses) or CSS scroll-driven animations.');
    if (/Three|WebGL/.test(st)) s.push('Create the 3D scene with your own models (Blender, CC0 assets), compress with Draco/KTX2, and drive it from scroll progress.');
    s.push('Wire data through your own API or a free backend (Supabase/Firebase free tier) if needed.');
    s.push('Test at 360-1440 px, check accessibility (contrast, focus, alt text), then ship.');
    return s;
  }

  var PLAN_SYS = 'You are a senior engineer. ' + ETHICS + ' From the teardown, write a step-by-step REBUILD PLAN in Markdown: ## Goal, ## Stack (free tools only), ## File structure (code block tree), ## Steps (numbered phases each with concrete tasks and an acceptance check), ## Design tokens (CSS variables block), ## Risks & unknowns. Keep it tight and actionable.';

  var CLONE_SYS = 'You are an expert front-end engineer. ' + ETHICS + ' Output ONE complete, self-contained HTML document (inline <style> and <script>, no external requests except optional Google Fonts) that is an ORIGINAL, working, responsive app/page inspired by the teardown: same kind of structure, layout and features, but a new invented name, original copy and placeholder data. Make the main features actually work in vanilla JS (state in localStorage where useful). No lorem ipsum walls; keep it concise (under ~400 lines). Return ONLY the HTML inside a single ```html code block.';

  var SHOT_SYS = 'You are Bizzy, a UI reverse-engineering analyst. ' + ETHICS + ' You are given screenshot(s) of an app or site. Reply in Markdown with: > one-line verdict, ## The answer, ## Likely stack (with confidence and visual clues), ## Design system (estimated hex colors, font style/family guesses, type scale, spacing grid, radii, shadows, iconography), ## Page structure (regions, components hierarchy), ## Features (each visible feature and how it probably works), ## APIs & data (what data/backend it implies), ## Rebuild it (numbered), ## What the screenshot can\'t show. Use the measured palette provided.';

  function extractCode(text) {
    var m = /```html\s*([\s\S]*?)```/i.exec(text) || /```\s*([\s\S]*?)```/.exec(text);
    var code = (m ? m[1] : text).trim();
    if (!/<html|<!doctype/i.test(code) && /<body|<div|<main/i.test(code)) code = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body>' + code + '</body></html>';
    return code;
  }

  /* Local starter clone (no AI): a working, original skeleton driven by the evidence. */
  function localClone(ev) {
    var d = ev.design || {}, cols = (d.palette || []).concat((d.colors || []).map(function (x) { return x[0]; })).filter(function (c) { return /^#[0-9a-f]{6}$/i.test(c); });
    var bg = cols[0] || '#0b0f0c', fg = '#f2f2f2', acc = cols[1] || '#39ff14', acc2 = cols[2] || '#7c4dff';
    var font = (d.fonts && d.fonts[0] && d.fonts[0][0]) || 'system-ui';
    var heads = (ev.renderedDom || ev.dom || { headings: [] }).headings || [];
    var nav = ev.dom && ev.dom.links.nav.length ? ev.dom.links.nav.slice(0, 5) : ['Home', 'Features', 'Pricing', 'About'];
    nav = nav.map(function (n, i) { return ['Overview', 'Features', 'Showcase', 'Pricing', 'Contact'][i] || 'Section ' + (i + 1); });
    var secs = heads.filter(function (h) { return h.level <= 2; }).slice(0, 4).map(function (h, i) { return ['Built for speed', 'Designed to delight', 'Works everywhere', 'Ready when you are'][i]; });
    if (!secs.length) secs = ['Built for speed', 'Designed to delight', 'Works everywhere'];
    var esc = function (s) { return String(s).replace(/[<>&"]/g, function (c) { return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]; }); };
    return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Nova Starter</title>\n<style>\n:root{--bg:' + bg + ';--fg:' + fg + ';--accent:' + acc + ';--accent2:' + acc2 + ';--radius:14px;--space:16px;font-family:' + esc(font) + ',system-ui,sans-serif}\n*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);line-height:1.6}\nheader{display:flex;justify-content:space-between;align-items:center;padding:var(--space) calc(var(--space)*2);position:sticky;top:0;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(8px);z-index:2}\nnav a{color:var(--fg);opacity:.8;margin-left:18px;text-decoration:none}nav a:hover{opacity:1;color:var(--accent)}\n.hero{min-height:70vh;display:grid;place-items:center;text-align:center;padding:48px 20px}\n.hero h1{font-size:clamp(2rem,6vw,4.2rem);margin:0 0 12px;background:linear-gradient(90deg,var(--accent),var(--accent2));-webkit-background-clip:text;background-clip:text;color:transparent}\n.btn{display:inline-block;padding:12px 22px;border-radius:999px;background:var(--accent);color:#000;font-weight:700;border:0;cursor:pointer}\nsection{padding:64px 20px;max-width:1080px;margin:auto}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:var(--space)}\n.card{padding:22px;border-radius:var(--radius);background:color-mix(in srgb,var(--fg) 6%,transparent);border:1px solid color-mix(in srgb,var(--fg) 12%,transparent);transition:transform .2s}.card:hover{transform:translateY(-4px)}\n.reveal{opacity:0;transform:translateY(24px);transition:all .6s}.reveal.in{opacity:1;transform:none}\nfooter{padding:32px;text-align:center;opacity:.6}@media(max-width:600px){nav{display:none}}\n</style></head><body>\n<header><strong>Nova</strong><nav>' + nav.map(function (n) { return '<a href="#' + n.toLowerCase() + '">' + esc(n) + '</a>'; }).join('') + '</nav></header>\n<div class="hero"><div><h1>Your idea, rebuilt.</h1><p>An original starter inspired by the structure of ' + esc(ev.host || 'the target') + '.</p><button class="btn" id="cta">Get started</button><p id="count" aria-live="polite"></p></div></div>\n' + secs.map(function (s, i) { return '<section id="' + (nav[i] || 'sec' + i).toLowerCase() + '" class="reveal"><h2>' + esc(s) + '</h2><div class="grid">' + [1, 2, 3].map(function (k) { return '<div class="card"><h3>Feature ' + (i * 3 + k) + '</h3><p>Placeholder copy describing an original feature.</p></div>'; }).join('') + '</div></section>'; }).join('\n') + '\n<footer>Built with Bizzle X-Ray v4.20 · original starter, no copied assets</footer>\n<script>\nvar n=+localStorage.getItem("nova.clicks")||0;var out=document.getElementById("count");function show(){out.textContent=n?"Clicked "+n+" times":"";}show();\ndocument.getElementById("cta").onclick=function(){n++;localStorage.setItem("nova.clicks",n);show();};\nvar io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting)e.target.classList.add("in");});},{threshold:.15});document.querySelectorAll(".reveal").forEach(function(el){io.observe(el);});\n</script></body></html>';
  }

  /* Prompt pack: copyable prompts for other AI builders and agents. */
  function promptPack(t) {
    var ev = t.evidence || {}, host = ev.host || ev.target || 'the target';
    var stack = (ev.stack || []).slice(0, 12).map(function (s) { return s.name + (s.version ? ' ' + s.version : ''); }).join(', ') || 'unknown';
    var d = ev.design || {};
    var colors = (d.palette || []).concat((d.colors || []).map(function (x) { return x[0]; })).slice(0, 8).join(', ');
    var fonts = (d.fonts || []).map(function (x) { return x[0]; }).join(', ');
    var summary = (t.report || '').split('\n').filter(function (l) { return /^>/.test(l); })[0] || '';
    return [
      { title: 'Rebuild prompt (Claude Code / Cursor / Grok / Codex)', text: 'Build an ORIGINAL app inspired by this teardown of ' + host + '. Do not copy its name, logo, text or assets.\n\nVerdict: ' + summary.replace(/^>\s*/, '') + '\nDetected stack: ' + stack + '\nDesign cues: colors ' + (colors || 'n/a') + '; fonts ' + (fonts || 'n/a') + '.\n\nFull teardown:\n' + (t.report || '').slice(0, 6000) + '\n\nSteps: scaffold, implement every feature listed, test it in a headless browser at 360/768/1440 px, then hand it over with a README.' },
      { title: 'Design-system prompt', text: 'Create a design-token file (CSS variables + a short style guide) for an original brand inspired by: colors ' + (colors || 'n/a') + '; fonts ' + (fonts || 'n/a') + '; type scale ' + (d.fontSizes || []).slice(0, 6).map(function (x) { return x[0]; }).join(', ') + '; spacing ' + (d.spacing || []).slice(0, 8).map(function (x) { return x[0]; }).join(', ') + '; radii ' + (d.radii || []).slice(0, 4).map(function (x) { return x[0]; }).join(', ') + '; breakpoints ' + (d.breakpoints || []).map(function (x) { return x[0]; }).join(', ') + '. Include light/dark variants and accessible contrast.' },
      { title: 'Feature-by-feature prompt', text: 'Here are the features found in ' + host + '. For each, explain how it likely works, then implement an original version as a small component with tests:\n' + ((t.report || '').split('## Features')[1] || '').split('##')[0].trim().slice(0, 3000) },
      { title: 'One-shot builder prompt (Lovable / Bolt / v0 / AI Studio)', text: 'Make a responsive web app, original branding, inspired by the structure of ' + host + ': ' + summary.replace(/^>\s*/, '') + ' Stack: ' + stack + '. Use placeholder content, working navigation and the main interactions. Mobile-first.' },
      { title: 'REA agent prompt (for an assistant with REA installed)', text: 'Reverse engineer ' + host + ' with REA: open it in a clean browser, watch it run while scrolling, read the code it downloads, log every file it loads, identify the stack with evidence, and save a teardown (answer, stack, how it works, what it loads, rebuild it, what the evidence can\'t show, evidence). Then build me an original version and test it in a hidden browser before opening it.' },
      { title: 'Ask-why prompt (learning)', text: 'Explain like I am a junior dev how ' + host + ' achieves its main effect, using this evidence. Then give me a 30-minute exercise to recreate the core technique from scratch.\n\n' + (t.report || '').slice(0, 3000) }
    ].concat(((ev.code && ev.code.prompts) || []).slice(0, 3).map(function (p, i) { return { title: 'Prompt string found in the target code #' + (i + 1) + ' (reference only)', text: p }; }));
  }

  /* Tiny safe markdown → HTML (escapes everything first). */
  function md(src) {
    var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var lines = String(src || '').replace(/\r/g, '').split('\n'), out = [], inCode = false, code = [], list = null;
    function inline(s) {
      s = esc(s);
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
      s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
      s = s.replace(/\[(E\d+)\]/g, '<a class="evref" href="#ev-$1">[$1]</a>');
      return s;
    }
    function closeList() { if (list) { out.push('</' + list + '>'); list = null; } }
    lines.forEach(function (l) {
      if (/^```/.test(l)) { if (inCode) { out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>'); code = []; inCode = false; } else { closeList(); inCode = true; } return; }
      if (inCode) { code.push(l); return; }
      var m;
      if ((m = /^(#{1,4})\s+(.*)/.exec(l))) { closeList(); var lv = Math.min(4, m[1].length + 1); out.push('<h' + lv + '>' + inline(m[2]) + '</h' + lv + '>'); return; }
      if ((m = /^>\s?(.*)/.exec(l))) { closeList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); return; }
      if ((m = /^\s*[-*]\s+(.*)/.exec(l))) { if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      if ((m = /^\s*\d+[.)]\s+(.*)/.exec(l))) { if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      if (/^\s*\|.*\|\s*$/.test(l)) { closeList(); if (/^\s*\|[\s:-|]+\|\s*$/.test(l)) return; out.push('<div class="mdrow">' + l.split('|').slice(1, -1).map(function (c) { return '<span>' + inline(c.trim()) + '</span>'; }).join('') + '</div>'); return; }
      if (!l.trim()) { closeList(); return; }
      closeList(); out.push('<p>' + inline(l) + '</p>');
    });
    if (inCode) out.push('<pre><code>' + esc(code.join('\n')) + '</code></pre>');
    closeList();
    return out.join('\n');
  }

  function evidenceMd(ev) {
    return '## Evidence\n\n' + (ev.evidence || []).map(function (e) { return '- **' + e.id + '** ' + e.claim + ' — _' + e.source + '_' + (e.detail ? ' `' + e.detail.replace(/`/g, "'").slice(0, 160) + '`' : ''); }).join('\n');
  }

  window.XBrain = {
    ETHICS: ETHICS, REPORT_SYS: REPORT_SYS, PLAN_SYS: PLAN_SYS, CLONE_SYS: CLONE_SYS, SHOT_SYS: SHOT_SYS,
    compactEvidence: compactEvidence, reportPrompt: reportPrompt, localReport: localReport, rebuildSteps: rebuildSteps,
    extractCode: extractCode, localClone: localClone, promptPack: promptPack, md: md, evidenceMd: evidenceMd
  };
})();
