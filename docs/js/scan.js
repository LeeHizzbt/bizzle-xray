/* Bizzle X-Ray v4.20 — evidence engine ("REA-lite" for the browser).
   Reads only what a site already sends to any browser, through public CORS-friendly readers.
   Every finding carries evidence; unknowns are listed, never guessed. */
(function () {
  'use strict';
  var UA_TIMEOUT = 25000;

  function withTimeout(p, ms, label) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error((label || 'request') + ' timed out')); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  }
  function normUrl(u) {
    u = (u || '').trim();
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
    try { return new URL(u).href; } catch (e) { return ''; }
  }
  function bytes(n) {
    if (n == null || isNaN(n)) return '?';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }

  /* ---------- Fetch layer: free readers, tried in order, each degrades to the next ---------- */
  function textReader(id, label, build, extra) {
    return { id: id, label: label, fetch: function (u) {
      return fetch(build(u), extra || {}).then(function (r) {
        if (!r.ok) throw new Error(label + ' HTTP ' + r.status);
        return r.text().then(function (t) {
          if (!t) throw new Error(label + ' returned nothing');
          if (/^\s*\{"(?:data|error)":null|Rate limit exceeded|error code: 5\d\d/.test(t.slice(0, 200))) throw new Error(label + ': ' + t.slice(0, 80));
          return { text: t, size: t.length, type: r.headers.get('content-type') || '', finalUrl: u };
        });
      });
    } };
  }
  var READERS = [
    textReader('direct', 'Direct (CORS-open file)', function (u) { return u; }, { mode: 'cors', credentials: 'omit' }),
    textReader('allorigins-raw', 'AllOrigins', function (u) { return 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u); }),
    textReader('corslol', 'cors.lol', function (u) { return 'https://api.cors.lol/?url=' + encodeURIComponent(u); }),
    { id: 'allorigins', label: 'AllOrigins JSON', fetch: function (u) {
      return fetch('https://api.allorigins.win/get?url=' + encodeURIComponent(u)).then(function (r) {
        if (!r.ok) throw new Error('AllOrigins JSON HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || typeof j.contents !== 'string' || !j.contents) throw new Error('AllOrigins JSON returned nothing');
        var st = j.status || {};
        if (st.http_code && st.http_code >= 400) throw new Error('Target answered HTTP ' + st.http_code);
        return { text: j.contents, size: st.content_length || j.contents.length, type: st.content_type || '', finalUrl: st.url || u };
      });
    } },
    textReader('codetabs', 'CodeTabs', function (u) { return 'https://api.codetabs.com/v1/proxy/?quest=' + encodeURIComponent(u); }),
    textReader('jina', 'Jina Reader', function (u) { return 'https://r.jina.ai/' + u; }, { headers: { 'X-Return-Format': 'html' } })
  ];
  var health = {};   // id -> {ok, fail}; healthy readers are tried first so later asset fetches stay fast

  function ordered() {
    return READERS.slice(0, 1).concat(READERS.slice(1).sort(function (a, b) {
      var ha = health[a.id] || { ok: 0, fail: 0 }, hb = health[b.id] || { ok: 0, fail: 0 };
      return (ha.fail - ha.ok * 2) - (hb.fail - hb.ok * 2);
    }));
  }
  function fetchVia(u, opts) {
    opts = opts || {};
    var list = ordered().filter(function (r) { return !opts.only || opts.only.indexOf(r.id) >= 0; });
    if (opts.asset) list = list.slice(0, 3);
    var errors = [], i = 0;
    function next() {
      if (i >= list.length) { var e = new Error('All free readers failed: ' + errors.join(' | ')); e.errors = errors; throw e; }
      var rd = list[i++], h = health[rd.id] || (health[rd.id] = { ok: 0, fail: 0 });
      return withTimeout(rd.fetch(u), rd.id === 'direct' ? 6000 : (opts.timeout || 12000), rd.label).then(function (res) {
        h.ok++; res.via = rd.label; return res;
      }, function (err) {
        h.fail++; errors.push(rd.label + ': ' + (err && err.message || err));
        return next();
      });
    }
    return Promise.resolve().then(next);
  }

  /* Microlink free tier (no key, ~50 requests/day/IP): rendered HTML after JS, Wappalyzer tech, screenshot, palette, meta. Cached 24 h. */
  function microlink(u) {
    var ck = 'bx.ml.' + u;
    try {
      var c = JSON.parse(localStorage.getItem(ck) || 'null');
      if (c && Date.now() - c.t < 864e5) return Promise.resolve(Object.assign({ cached: true }, c.d));
    } catch (e) {}
    var q = 'https://api.microlink.io/?url=' + encodeURIComponent(u) +
      '&screenshot=true&meta=true&palette=true&insights.technologies=true&insights.lighthouse=false' +
      '&data.html.selector=html&data.html.attr=html&waitUntil=networkidle2&waitForTimeout=2500';
    return withTimeout(fetch(q).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }), 45000, 'Microlink')
      .then(function (o) {
        if (!o.ok || !o.j || o.j.status !== 'success') throw new Error('Microlink: ' + ((o.j && (o.j.message || o.j.code)) || 'failed'));
        var d = o.j.data || {};
        var out = {
          title: d.title, description: d.description, lang: d.lang, publisher: d.publisher, author: d.author,
          html: cleanRendered(d.html || ''), screenshot: d.screenshot && d.screenshot.url,
          palette: [].concat((d.screenshot && d.screenshot.palette) || [], (d.logo && d.logo.palette) || []).slice(0, 10),
          background: d.screenshot && d.screenshot.background_color,
          logo: d.logo && d.logo.url, image: d.image && d.image.url,
          tech: ((d.insights && d.insights.technologies) || []).map(function (t) { return { name: t.name, categories: t.categories || [], confidence: t.confidence }; })
        };
        var store = Object.assign({}, out, { html: (out.html || '').slice(0, 200000) });
        try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: store })); } catch (e) {}
        return out;
      });
  }
  /* Microlink's headless Chrome injects a cookie-banner-hiding stylesheet; strip it so it can't pollute fingerprints. */
  function cleanRendered(h) {
    return String(h).replace(/<style[^>]*>[^<]*(?:fast-cmp-root|cookies-banner|onetrust|#cookie|cmp-container)[^<]*<\/style>/gi, '');
  }
  function screenshotUrl(u, w) { return 'https://image.thum.io/get/width/' + (w || 1200) + '/' + u; }

  /* ---------- Static analysis ---------- */
  var SIGS = [
    // [name, category, regex, where ('html'|'js'|'css'|'url'|'any'), versionRegex]
    ['React', 'UI framework', /react-dom|__REACT_DEVTOOLS_GLOBAL_HOOK__|react\.production\.min|_reactRootContainer|data-reactroot/, 'any', /react(?:-dom)?@(\d+\.\d+\.\d+)|ReactVersion\s*=\s*"(\d+\.\d+\.\d+)"/],
    ['Next.js', 'Meta-framework', /__NEXT_DATA__|\/_next\/static|next\/dist|__next_f/, 'any', /"buildId"|next@(\d+\.\d+\.\d+)/],
    ['Vue', 'UI framework', /__VUE__|data-v-[0-9a-f]{6,}|vue\.runtime|createApp\(|Vue\.version/, 'any', /vue@(\d+\.\d+\.\d+)/],
    ['Nuxt', 'Meta-framework', /__NUXT__|\/_nuxt\/|nuxt-link/, 'any'],
    ['Svelte', 'UI framework', /svelte-[a-z0-9]{5,}|\bsvelte\b|SvelteComponent|__svelte/, 'any'],
    ['SvelteKit', 'Meta-framework', /__sveltekit|\/_app\/immutable\//, 'any'],
    ['Angular', 'UI framework', /ng-version=|@angular\/core|ɵcmp|ng-star-inserted/, 'any', /ng-version="(\d+\.\d+\.\d+)"/],
    ['Solid', 'UI framework', /solid-js|_\$HY|data-hk=/, 'any'],
    ['Preact', 'UI framework', /preact(\.min)?\.js|__PREACT_DEVTOOLS__/, 'any'],
    ['Astro', 'Meta-framework', /astro-island|data-astro-cid|\/_astro\//, 'any'],
    ['Remix', 'Meta-framework', /__remixContext|__remixManifest/, 'any'],
    ['Gatsby', 'Meta-framework', /___gatsby|gatsby-chunk-mapping/, 'any'],
    ['Qwik', 'UI framework', /q:container|qwikloader/, 'any'],
    ['jQuery', 'Library', /jquery(\.min)?\.js|jQuery\.fn|\$\.ajax/, 'any', /jquery[.-]?(\d+\.\d+\.\d+)/i],
    ['Alpine.js', 'Library', /x-data=|alpinejs/, 'any'],
    ['htmx', 'Library', /hx-get=|hx-post=|htmx\.org|htmx\.min\.js/, 'any'],
    ['Three.js', '3D / WebGL', /THREE\.|three\.module|WebGLRenderer|__THREE__|three@/, 'any', /REVISION\s*=\s*"(\d+)"|three@0\.(\d+)/],
    ['Babylon.js', '3D / WebGL', /BABYLON\.|babylonjs/, 'any'],
    ['PixiJS', '2D / WebGL', /PIXI\.|pixi\.js|pixijs/, 'any'],
    ['GSAP', 'Animation', /gsap|TweenMax|TweenLite|GreenSock/, 'any', /gsap[@\s"v:]*(\d+\.\d+\.\d+)|GSAP\s*(\d+\.\d+\.\d+)/i],
    ['ScrollTrigger', 'Animation', /ScrollTrigger/, 'any'],
    ['Lenis smooth scroll', 'Animation', /lenis|data-lenis/i, 'any'],
    ['Locomotive Scroll', 'Animation', /locomotive-scroll|data-scroll-container/, 'any'],
    ['Framer Motion', 'Animation', /framer-motion|motion\.div|data-framer-/, 'any'],
    ['Lottie', 'Animation', /lottie|bodymovin/i, 'any'],
    ['Swiper', 'UI component', /swiper-wrapper|swiper-slide|Swiper\(/, 'any'],
    ['Tailwind CSS', 'CSS', /--tw-|tailwindcss|\b(?:flex|grid) [a-z-]*(?:gap|px|py|mx|my)-\d/, 'any'],
    ['Bootstrap', 'CSS', /bootstrap(\.min)?\.(css|js)|class="[^"]*\b(container-fluid|col-md-\d|navbar-expand)/, 'any', /Bootstrap v(\d+\.\d+\.\d+)/],
    ['Bulma', 'CSS', /bulma(\.min)?\.css/, 'any'],
    ['Material UI', 'UI kit', /MuiButton|Mui[A-Z][a-z]+-root|@mui\//, 'any'],
    ['Chakra UI', 'UI kit', /chakra-ui|css-[a-z0-9]+ chakra/, 'any'],
    ['shadcn/Radix UI', 'UI kit', /data-radix-|radix-ui/, 'any'],
    ['styled-components', 'CSS-in-JS', /sc-[a-zA-Z]{6,}|styled-components/, 'any'],
    ['Emotion', 'CSS-in-JS', /css-[a-z0-9]{6,}-|@emotion/, 'any'],
    ['Google Fonts', 'Fonts', /fonts\.googleapis\.com|fonts\.gstatic\.com/, 'any'],
    ['Adobe Fonts', 'Fonts', /use\.typekit\.net|p\.typekit\.net/, 'any'],
    ['Font Awesome', 'Icons', /font-awesome|fontawesome|fa-solid|fa-brands/, 'any'],
    ['Google Analytics', 'Analytics', /google-analytics\.com|gtag\(|googletagmanager\.com\/gtag/, 'any'],
    ['Google Tag Manager', 'Analytics', /googletagmanager\.com\/gtm\.js|GTM-[A-Z0-9]{4,}/, 'any'],
    ['Plausible', 'Analytics', /plausible\.io\/js/, 'any'],
    ['Segment', 'Analytics', /cdn\.segment\.com|analytics\.load\(/, 'any'],
    ['Hotjar', 'Analytics', /static\.hotjar\.com|hjSiteSettings/, 'any'],
    ['PostHog', 'Analytics', /posthog/, 'any'],
    ['Mixpanel', 'Analytics', /mixpanel/, 'any'],
    ['Vercel Analytics', 'Analytics', /\/_vercel\/insights|va\.vercel-scripts/, 'any'],
    ['Sentry', 'Monitoring', /sentry\.io|Sentry\.init|@sentry\//, 'any'],
    ['Intercom', 'Support chat', /widget\.intercom\.io|Intercom\(/, 'any'],
    ['Crisp', 'Support chat', /client\.crisp\.chat/, 'any'],
    ['Stripe', 'Payments', /js\.stripe\.com|Stripe\(/, 'any'],
    ['PayPal', 'Payments', /paypal\.com\/sdk|paypalobjects/, 'any'],
    ['Firebase', 'Backend', /firebaseapp\.com|firebase\/app|initializeApp\(\{[^}]*apiKey/, 'any'],
    ['Supabase', 'Backend', /supabase\.co|createClient\([^)]*supabase/, 'any'],
    ['GraphQL', 'API style', /graphql|__typename|query\s+\w+\s*\{/, 'js'],
    ['Apollo', 'API client', /ApolloClient|apollo-client|__APOLLO_STATE__/, 'any'],
    ['Socket.IO', 'Realtime', /socket\.io/, 'any'],
    ['WebSocket', 'Realtime', /new WebSocket\(|wss:\/\//, 'js'],
    ['Shopify', 'Platform', /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/, 'any'],
    ['WordPress', 'Platform', /wp-content\/|wp-includes\/|wp-json/, 'any'],
    ['Webflow', 'Platform', /webflow\.(js|com)|data-wf-page|w-nav/, 'any'],
    ['Wix', 'Platform', /static\.wixstatic\.com|wix-code|_wixCIDX/, 'any'],
    ['Squarespace', 'Platform', /squarespace\.com|static1\.squarespace/, 'any'],
    ['Framer (site builder)', 'Platform', /framerusercontent\.com|__framer_|framer\.com\/m\//, 'any'],
    ['Ghost', 'Platform', /ghost\.io|content="Ghost/, 'any'],
    ['Drupal', 'Platform', /Drupal\.settings|\/sites\/default\/files/, 'any'],
    ['Cloudflare', 'CDN / host', /cdnjs\.cloudflare\.com|cloudflareinsights|__cf_bm|cf-ray/, 'any'],
    ['Vercel', 'CDN / host', /vercel\.app|_vercel|x-vercel/, 'any'],
    ['Netlify', 'CDN / host', /netlify/, 'any'],
    ['GitHub Pages', 'CDN / host', /github\.io/, 'url'],
    ['WebGL', 'Browser API', /getContext\(\s*["'](?:webgl2?|experimental-webgl)["']|WebGLRenderingContext|WEBGL_/, 'js'],
    ['WebGPU', 'Browser API', /navigator\.gpu|GPUDevice|requestAdapter\(/, 'js'],
    ['WebAssembly', 'Browser API', /WebAssembly\.(instantiate|compile)|\.wasm\b/, 'any'],
    ['Web Workers', 'Browser API', /new Worker\(|new SharedWorker\(/, 'js'],
    ['Service Worker / PWA', 'Browser API', /serviceWorker\.register|rel="manifest"/, 'any'],
    ['Web Audio', 'Browser API', /AudioContext|webkitAudioContext/, 'js'],
    ['Howler.js', 'Audio', /howler|new Howl\(/, 'any'],
    ['Draco mesh compression', '3D assets', /draco|DRACOLoader/i, 'any'],
    ['KTX2 / Basis textures', '3D assets', /\.ktx2|KTX2Loader|basis_transcoder/, 'any'],
    ['glTF models', '3D assets', /GLTFLoader|\.glb\b|\.gltf\b/, 'any'],
    ['Meshopt', '3D assets', /meshopt/i, 'any'],
    ['postprocessing (pmndrs)', '3D effects', /EffectComposer|BloomEffect|DepthOfFieldEffect/, 'js'],
    ['Bloom effect', '3D effects', /UnrealBloomPass|BloomEffect|luminanceThreshold/, 'js'],
    ['FXAA', '3D effects', /EDGE_THRESHOLD_MIN|FXAAShader|FXAAEffect/, 'js'],
    ['Custom GLSL shaders', '3D effects', /gl_FragColor|gl_Position|precision (?:highp|mediump) float/, 'js'],
    ['React Three Fiber', '3D / WebGL', /@react-three\/fiber|useFrame\(/, 'any'],
    ['D3.js', 'Data viz', /d3\.select|d3-selection|d3\.v\d/, 'any'],
    ['Chart.js', 'Data viz', /chart\.js|new Chart\(/i, 'any'],
    ['Mapbox', 'Maps', /mapbox-gl|api\.mapbox\.com/, 'any'],
    ['Leaflet', 'Maps', /leaflet(\.js|\.css)|L\.map\(/, 'any'],
    ['Google Maps', 'Maps', /maps\.googleapis\.com/, 'any'],
    ['Algolia', 'Search', /algolia|algoliasearch/, 'any'],
    ['YouTube embed', 'Media', /youtube\.com\/embed|youtube-nocookie/, 'any'],
    ['Vimeo embed', 'Media', /player\.vimeo\.com/, 'any'],
    ['reCAPTCHA', 'Security', /recaptcha/, 'any'],
    ['hCaptcha', 'Security', /hcaptcha\.com/, 'any'],
    ['Turnstile', 'Security', /challenges\.cloudflare\.com\/turnstile/, 'any'],
    ['OpenAI API', 'AI', /api\.openai\.com|openai\/|chat\/completions/, 'js'],
    ['Anthropic API', 'AI', /api\.anthropic\.com|anthropic-version/, 'js'],
    ['Gemini API', 'AI', /generativelanguage\.googleapis\.com/, 'js'],
    ['Vite', 'Build tool', /\/@vite\/client|import\.meta\.hot|__vite__|modulepreload-polyfill/, 'any'],
    ['Webpack', 'Build tool', /webpackChunk|__webpack_require__|webpackJsonp/, 'js'],
    ['Turbopack', 'Build tool', /turbopack/i, 'js'],
    ['Parcel', 'Build tool', /parcelRequire/, 'js'],
    ['Rollup', 'Build tool', /rollup/i, 'js'],
    ['TypeScript (emitted)', 'Language', /__awaiter|__extends|__decorate/, 'js'],
    ['core-js polyfills', 'Library', /core-js/, 'js'],
    ['Lodash', 'Library', /lodash|_\.debounce/, 'js'],
    ['Zustand', 'State', /zustand/, 'js'],
    ['Redux', 'State', /__REDUX_DEVTOOLS_EXTENSION__|createStore\(|@reduxjs/, 'js'],
    ['TanStack Query', 'State', /QueryClient|@tanstack\/query|react-query/, 'js']
  ];

  function snippet(text, idx, len) {
    var s = Math.max(0, idx - 30), e = Math.min(text.length, idx + (len || 0) + 40);
    return text.slice(s, e).replace(/\s+/g, ' ').trim();
  }

  function fingerprint(sources) {
    // sources: [{name, kind:'html'|'js'|'css'|'url', text}]
    var found = {};
    sources.forEach(function (src) {
      if (!src.text) return;
      var text = src.text.length > 3e6 ? src.text.slice(0, 3e6) : src.text;
      SIGS.forEach(function (s) {
        var where = s[3];
        if (where !== 'any' && where !== src.kind) return;
        var m = s[2].exec(text);
        if (!m) return;
        var f = found[s[0]] || (found[s[0]] = { name: s[0], category: s[1], evidence: [], version: '' });
        if (f.evidence.length < 3) f.evidence.push({ file: src.name, kind: src.kind, match: m[0].slice(0, 80), context: snippet(text, m.index, m[0].length) });
        if (!f.version && s[4]) {
          var v = s[4].exec(text);
          if (v) f.version = (v[1] || v[2] || '').trim();
          if (f.version && s[0] === 'Three.js' && /^\d+$/.test(f.version)) f.version = 'r' + f.version;
        }
      });
    });
    return Object.keys(found).map(function (k) { return found[k]; });
  }

  function cssAnalyze(css) {
    var out = { colors: {}, vars: {}, fonts: {}, sizes: {}, spacing: {}, radii: {}, shadows: 0, breakpoints: {}, keyframes: [], transitions: 0, fontFaces: [] };
    if (!css) return out;
    css = css.length > 2e6 ? css.slice(0, 2e6) : css;
    var m, re;
    re = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})\b|rgba?\([^)]{5,40}\)|hsla?\([^)]{5,40}\)|oklch\([^)]{5,40}\)/g;
    while ((m = re.exec(css))) { var c = m[0].toLowerCase().replace(/\s+/g, ''); out.colors[c] = (out.colors[c] || 0) + 1; }
    re = /(--[\w-]{1,40})\s*:\s*([^;}{]{1,80})/g;
    while ((m = re.exec(css))) { if (Object.keys(out.vars).length < 120) out.vars[m[1]] = m[2].trim(); }
    re = /font-family\s*:\s*([^;}]{1,120})/g;
    while ((m = re.exec(css))) { var f = m[1].split(',')[0].replace(/["']/g, '').trim(); if (f && !/^var\(/.test(f)) out.fonts[f] = (out.fonts[f] || 0) + 1; }
    re = /font-size\s*:\s*([^;}]{1,40})/g;
    while ((m = re.exec(css))) { var fs = m[1].trim(); out.sizes[fs] = (out.sizes[fs] || 0) + 1; }
    re = /(?:margin|padding|gap|row-gap|column-gap)(?:-[a-z]+)?\s*:\s*([^;}]{1,40})/g;
    while ((m = re.exec(css))) { m[1].trim().split(/\s+/).forEach(function (v) { if (/^-?[\d.]+(px|rem|em|%|vw|vh)$/.test(v) && !/^0/.test(v)) out.spacing[v] = (out.spacing[v] || 0) + 1; }); }
    re = /border-radius\s*:\s*([^;}]{1,40})/g;
    while ((m = re.exec(css))) { var r = m[1].trim(); out.radii[r] = (out.radii[r] || 0) + 1; }
    out.shadows = (css.match(/box-shadow\s*:/g) || []).length;
    re = /@media[^{]*?\((?:min|max)-width\s*:\s*([\d.]+(?:px|em|rem))/g;
    while ((m = re.exec(css))) out.breakpoints[m[1]] = (out.breakpoints[m[1]] || 0) + 1;
    re = /@keyframes\s+([\w-]+)/g;
    while ((m = re.exec(css))) if (out.keyframes.indexOf(m[1]) < 0 && out.keyframes.length < 40) out.keyframes.push(m[1]);
    out.transitions = (css.match(/transition\s*:/g) || []).length;
    re = /@font-face\s*\{[^}]*font-family\s*:\s*["']?([^;"']+)/g;
    while ((m = re.exec(css))) if (out.fontFaces.indexOf(m[1].trim()) < 0) out.fontFaces.push(m[1].trim());
    return out;
  }
  function top(obj, n) {
    return Object.keys(obj).map(function (k) { return [k, obj[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n || 12);
  }

  function jsAnalyze(text, name) {
    var out = { endpoints: [], routes: [], urls: [], sourceMaps: [], prompts: [], storageKeys: [], assets: [], workers: 0, dynamicImports: 0 };
    if (!text) return out;
    var t = text.length > 4e6 ? text.slice(0, 4e6) : text, m, re, seen = {};
    function add(arr, v, cap) { if (!seen[arr + v] && out[arr].length < (cap || 60)) { seen[arr + v] = 1; out[arr].push(v); } }
    re = /(?:fetch|axios(?:\.(?:get|post|put|delete|patch))?|\.open)\(\s*[`"']([^`"'\s]{2,200})[`"']/g;
    while ((m = re.exec(t))) add('endpoints', m[1]);
    re = /[`"'](\/(?:api|graphql|v\d|rest|rpc|_api|wp-json|trpc)[\w\-\/.:?=&{}$]{0,120})[`"']/g;
    while ((m = re.exec(t))) add('endpoints', m[1]);
    re = /[`"'](wss?:\/\/[^`"'\s]{4,200})[`"']/g;
    while ((m = re.exec(t))) add('endpoints', m[1]);
    re = /path\s*:\s*[`"'](\/[\w\-\/:*]{0,80})[`"']|[`"'](\/[a-z][\w-]{1,40}\/:[a-zA-Z]\w{1,30})[`"']/g;
    while ((m = re.exec(t))) add('routes', m[1] || m[2], 40);
    re = /https?:\/\/[a-zA-Z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'`)<>\\]{0,100})?/g;
    while ((m = re.exec(t))) { if (!/w3\.org|reactjs\.org\/docs|github\.com\/[^/]+\/[^/]+\/(issues|blob)|mozilla\.org|schema\.org|fb\.me/.test(m[0])) add('urls', m[0], 80); }
    re = /sourceMappingURL=([^\s'"]+)/g;
    while ((m = re.exec(t))) add('sourceMaps', m[1], 10);
    re = /[`"']((?:You are|Act as|You're an?|As an AI|System prompt)[^`"']{40,600})[`"']/g;
    while ((m = re.exec(t))) add('prompts', m[1], 12);
    re = /(?:localStorage|sessionStorage)\.(?:getItem|setItem)\(\s*[`"']([^`"']{1,60})[`"']/g;
    while ((m = re.exec(t))) add('storageKeys', m[1], 30);
    re = /[`"']([^`"'\s]{1,160}\.(?:glb|gltf|ktx2|basis|hdr|exr|wasm|mp3|ogg|wav|m4a|mp4|webm|json|png|jpe?g|webp|avif|svg|woff2?|ttf))[`"']/g;
    while ((m = re.exec(t))) add('assets', m[1], 120);
    out.workers = (t.match(/new (?:Shared)?Worker\(/g) || []).length;
    out.dynamicImports = (t.match(/\bimport\(\s*[`"'.]/g) || []).length;
    return out;
  }

  function htmlAnalyze(html, base) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var all = doc.querySelectorAll('body *');
    var q = function (s) { return doc.querySelectorAll(s); };
    var abs = function (u) { try { return new URL(u, base).href; } catch (e) { return u; } };
    var meta = {};
    q('meta').forEach(function (m) { var k = m.getAttribute('name') || m.getAttribute('property') || m.getAttribute('http-equiv'); if (k && m.getAttribute('content')) meta[k.toLowerCase()] = m.getAttribute('content').slice(0, 300); });
    var headings = [];
    q('h1,h2,h3').forEach(function (h) { if (headings.length < 40) { var tx = (h.textContent || '').replace(/\s+/g, ' ').trim(); if (tx) headings.push({ level: +h.tagName[1], text: tx.slice(0, 120) }); } });
    var landmarks = {};
    ['header', 'nav', 'main', 'section', 'article', 'aside', 'footer', 'form', 'dialog', 'canvas', 'template'].forEach(function (t) { landmarks[t] = q(t).length; });
    var host = ''; try { host = new URL(base).host; } catch (e) {}
    var links = { internal: 0, external: 0, nav: [] };
    q('a[href]').forEach(function (a) {
      var h = a.getAttribute('href'); if (!h || /^(#|javascript:|mailto:|tel:)/.test(h)) return;
      var u = abs(h); var ext = false; try { ext = new URL(u).host !== host; } catch (e) {}
      if (ext) links.external++; else links.internal++;
      if (a.closest('nav,header') && links.nav.length < 20) { var tx = (a.textContent || '').replace(/\s+/g, ' ').trim(); if (tx) links.nav.push(tx.slice(0, 40)); }
    });
    var scripts = [], inline = [], styles = [], inlineCss = '', resources = [];
    q('script').forEach(function (s) {
      var src = s.getAttribute('src');
      if (src) scripts.push({ url: abs(src), type: s.getAttribute('type') || 'classic', async: s.hasAttribute('async'), defer: s.hasAttribute('defer') });
      else if ((s.textContent || '').trim()) inline.push({ type: s.getAttribute('type') || 'classic', id: s.id || '', text: s.textContent.slice(0, 400000) });
    });
    q('link[rel]').forEach(function (l) {
      var rel = (l.getAttribute('rel') || '').toLowerCase(), href = l.getAttribute('href'); if (!href) return;
      if (rel.indexOf('stylesheet') >= 0) styles.push(abs(href));
      else resources.push({ rel: rel, url: abs(href), as: l.getAttribute('as') || '' });
    });
    q('style').forEach(function (s) { inlineCss += '\n' + s.textContent; });
    var styleAttrs = ''; q('[style]').forEach(function (e, i) { if (i < 400) styleAttrs += e.getAttribute('style') + ';'; });
    var media = [];
    q('img[src],source[src],video[src],audio[src],img[srcset]').forEach(function (e) { if (media.length < 80) media.push(abs(e.getAttribute('src') || (e.getAttribute('srcset') || '').split(' ')[0])); });
    var jsonld = [];
    q('script[type="application/ld+json"]').forEach(function (s) { try { var j = JSON.parse(s.textContent); [].concat(j).forEach(function (x) { if (x && x['@type']) jsonld.push([].concat(x['@type']).join('/')); }); } catch (e) {} });
    var classes = {};
    for (var i = 0; i < all.length && i < 3000; i++) { (all[i].getAttribute('class') || '').split(/\s+/).forEach(function (c) { if (c) classes[c] = (classes[c] || 0) + 1; }); }
    var forms = [];
    q('form').forEach(function (f) { if (forms.length < 8) forms.push({ action: f.getAttribute('action') || '', method: (f.getAttribute('method') || 'get').toLowerCase(), fields: Array.prototype.map.call(f.querySelectorAll('input,select,textarea'), function (x) { return (x.getAttribute('type') || x.tagName.toLowerCase()) + (x.getAttribute('name') ? ':' + x.getAttribute('name') : ''); }).slice(0, 12) }); });
    var buttons = []; q('button,[role=button]').forEach(function (b) { var tx = (b.textContent || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim(); if (tx && buttons.length < 25 && buttons.indexOf(tx.slice(0, 40)) < 0) buttons.push(tx.slice(0, 40)); });
    var text = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ').trim();
    return {
      title: (doc.title || '').trim(), lang: doc.documentElement.getAttribute('lang') || '', meta: meta,
      counts: { elements: all.length, img: q('img').length, svg: q('svg').length, video: q('video').length, iframe: q('iframe').length, canvas: q('canvas').length, button: q('button').length, input: q('input,textarea,select').length, a: q('a').length, script: q('script').length },
      headings: headings, landmarks: landmarks, links: links, scripts: scripts, inlineScripts: inline, styles: styles, inlineCss: inlineCss, styleAttrs: styleAttrs,
      resources: resources, media: media, jsonld: jsonld, forms: forms, buttons: buttons,
      topClasses: top(classes, 25), wordCount: text ? text.split(' ').length : 0, textSample: text.slice(0, 1500),
      hasManifest: !!doc.querySelector('link[rel=manifest]'), generator: meta.generator || ''
    };
  }

  function extOf(u) { var m = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(u || ''); return m ? m[1].toLowerCase() : ''; }
  function classify(u) {
    var e = extOf(u);
    if (/^(js|mjs|cjs)$/.test(e)) return 'Scripts';
    if (e === 'css') return 'Styles';
    if (/^(png|jpe?g|gif|webp|avif|svg|ico)$/.test(e)) return 'Images';
    if (/^(woff2?|ttf|otf|eot)$/.test(e)) return 'Fonts';
    if (/^(mp3|ogg|wav|m4a|aac)$/.test(e)) return 'Audio';
    if (/^(mp4|webm|mov|m3u8)$/.test(e)) return 'Video';
    if (/^(glb|gltf|obj|fbx|usdz|drc)$/.test(e)) return '3D models';
    if (/^(ktx2|basis|hdr|exr|dds)$/.test(e)) return 'GPU textures';
    if (e === 'wasm') return 'WebAssembly';
    if (e === 'json') return 'Data';
    return 'Other';
  }

  /* ---------- Full website scan ---------- */
  function scanWebsite(input, opts) {
    opts = opts || {};
    var step = opts.onStep || function () {};
    var log = opts.onLog || function () {};
    var url = normUrl(input);
    if (!url) return Promise.reject(new Error('That does not look like a URL.'));
    var host = new URL(url).host;
    var ev = { kind: 'website', target: url, host: host, startedAt: new Date().toISOString(), sources: [], errors: [], loaded: [] };
    var mlP = opts.skipMicrolink ? Promise.resolve(null) : microlink(url).then(function (r) { log('Microlink: rendered page + tech insights' + (r.cached ? ' (cached)' : '')); return r; }, function (e) { ev.errors.push(String(e.message || e)); log('Microlink unavailable: ' + e.message); return null; });

    step('open', 'Opening the site in a clean reader');
    var rawP = fetchVia(url).then(function (res) {
      log('HTML ' + bytes(res.size) + ' via ' + res.via);
      ev.html = { via: res.via, size: res.size, finalUrl: res.finalUrl };
      return res.text;
    });
    // Use whichever arrives: raw HTML (preferred) or, if the free readers are slow/down, Microlink's rendered HTML.
    var htmlP = new Promise(function (resolve, reject) {
      var settled = false, rawErr = null, mlHtml = null, graceT = null;
      function useMl() { if (settled || !mlHtml) return; settled = true; log('Using Microlink rendered HTML (readers slow or down)'); ev.html = { via: 'Microlink (rendered)', size: mlHtml.length }; resolve(mlHtml); }
      rawP.then(function (t) { if (!settled) { settled = true; clearTimeout(graceT); resolve(t); } }, function (e) {
        rawErr = e; ev.errors.push(e.message); log(e.message);
        if (mlHtml) useMl();
        else mlP.then(function (ml) { if (ml && ml.html) { mlHtml = ml.html; useMl(); } else if (!settled) { settled = true; reject(new Error('Could not read ' + host + ' through any free reader. ' + e.message)); } });
      });
      mlP.then(function (ml) { if (ml && ml.html && !settled) { mlHtml = ml.html; graceT = setTimeout(useMl, 6000); } });
    });
    return htmlP.then(function (html) { return html;     }).then(function (html) {
      step('load', 'Waiting for it to load (rendered snapshot + screenshot)');
      return mlP.then(function (ml) { return { html: html, ml: ml }; });
    }).then(function (o) {
      step('read', 'Reading the code: DOM, styles and scripts');
      var h = htmlAnalyze(o.html, url);
      var hr = o.ml && o.ml.html ? htmlAnalyze('<html>' + o.ml.html + '</html>', url) : null;
      ev.dom = h; ev.renderedDom = hr ? { counts: hr.counts, headings: hr.headings, landmarks: hr.landmarks, buttons: hr.buttons, topClasses: hr.topClasses, wordCount: hr.wordCount, textSample: hr.textSample.slice(0, 800) } : null;
      ev.microlink = o.ml ? { title: o.ml.title, description: o.ml.description, lang: o.ml.lang, publisher: o.ml.publisher, palette: o.ml.palette, background: o.ml.background, tech: o.ml.tech, logo: o.ml.logo, image: o.ml.image } : null;
      ev.screenshot = (o.ml && o.ml.screenshot) || screenshotUrl(url);
      ev.screenshotVia = (o.ml && o.ml.screenshot) ? 'Microlink' : 'thum.io';
      var sources = [{ name: 'index.html', kind: 'html', text: o.html }];
      if (o.ml && o.ml.html) sources.push({ name: 'rendered DOM', kind: 'html', text: o.ml.html });
      h.inlineScripts.forEach(function (s, i) { sources.push({ name: 'inline script #' + (i + 1) + (s.id ? ' (' + s.id + ')' : ''), kind: 'js', text: s.text }); });
      sources.push({ name: 'page URL', kind: 'url', text: url });
      var maxJs = opts.maxScripts == null ? 6 : opts.maxScripts, maxCss = opts.maxStyles == null ? 4 : opts.maxStyles;
      var sameFirst = function (a, b) { var ah = a.indexOf(host) >= 0 ? 0 : 1, bh = b.indexOf(host) >= 0 ? 0 : 1; return ah - bh; };
      var jsList = h.scripts.map(function (s) { return s.url; }).sort(sameFirst).slice(0, maxJs);
      var preJs = h.resources.filter(function (r) { return /modulepreload|preload/.test(r.rel) && (r.as === 'script' || /\.m?js/.test(r.url)); }).map(function (r) { return r.url; });
      preJs.forEach(function (u) { if (jsList.length < maxJs + 2 && jsList.indexOf(u) < 0) jsList.push(u); });
      var cssList = h.styles.slice(0, maxCss);
      step('list', 'Listing everything it loads (' + (h.scripts.length + h.styles.length + h.resources.length + h.media.length) + ' references)');
      var jobs = [];
      jsList.forEach(function (u) { jobs.push(fetchVia(u, { asset: true, timeout: 20000 }).then(function (r) { ev.loaded.push({ url: u, size: r.size, type: 'Scripts', via: r.via }); sources.push({ name: u.split('/').pop().split('?')[0] || u, url: u, kind: 'js', text: r.text }); log('JS ' + bytes(r.size) + ' ' + u.split('/').pop().slice(0, 50)); }, function (e) { ev.errors.push('JS ' + u + ': ' + e.message.slice(0, 120)); })); });
      cssList.forEach(function (u) { jobs.push(fetchVia(u, { asset: true, timeout: 20000 }).then(function (r) { ev.loaded.push({ url: u, size: r.size, type: 'Styles', via: r.via }); sources.push({ name: u.split('/').pop().split('?')[0] || u, url: u, kind: 'css', text: r.text }); log('CSS ' + bytes(r.size) + ' ' + u.split('/').pop().slice(0, 50)); }, function (e) { ev.errors.push('CSS ' + u + ': ' + e.message.slice(0, 120)); })); });
      return Promise.all(jobs).then(function () {
        // Follow the chunk graph one level: lazy/dynamic chunks referenced by the bundles we read (e.g. a big 3D bundle).
        var budget = Math.max(0, maxJs + 2 - jsList.length), chunks = [];
        sources.filter(function (s) { return s.kind === 'js' && s.url; }).forEach(function (s) {
          var re = /import\(\s*["'`]([^"'`]+\.m?js)["'`]\s*\)|["'`]((?:\.{0,2}\/)?(?:assets\/|_next\/static\/chunks\/|_app\/immutable\/)?[\w.\-\/]*?[\w-]+[-.][0-9a-zA-Z_-]{6,}\.m?js)["'`]/g, m;
          while ((m = re.exec(s.text)) && chunks.length < 40) {
            var rel = m[1] || m[2], absu; try { absu = new URL(rel, s.url).href; } catch (e) { continue; }
            if (jsList.indexOf(absu) < 0 && chunks.indexOf(absu) < 0) chunks.push(absu);
          }
        });
        ev.chunkGraph = { discovered: chunks.length, sample: chunks.slice(0, 15) };
        if (chunks.length) log('Chunk graph: ' + chunks.length + ' lazy chunks referenced; reading ' + Math.min(budget, chunks.length));
        return Promise.all(chunks.slice(0, budget).map(function (u) {
          return fetchVia(u, { asset: true, timeout: 15000 }).then(function (r) { ev.loaded.push({ url: u, size: r.size, type: 'Scripts', via: r.via, lazy: true }); sources.push({ name: (u.split('/').pop().split('?')[0] || u) + ' (lazy chunk)', url: u, kind: 'js', text: r.text }); log('Lazy JS ' + bytes(r.size) + ' ' + u.split('/').pop().slice(0, 50)); }, function (e) { ev.errors.push('Lazy JS ' + u + ': ' + e.message.slice(0, 100)); });
        }));
      }).then(function () { return { h: h, sources: sources }; });
    }).then(function (o) {
      step('stack', 'Identifying the stack');
      var h = o.h, sources = o.sources;
      ev.sources = sources.map(function (s) { return { name: s.name, kind: s.kind, size: (s.text || '').length }; });
      var stack = fingerprint(sources);
      (ev.microlink && ev.microlink.tech || []).forEach(function (t) {
        var ex = stack.filter(function (s) { return s.name.toLowerCase() === t.name.toLowerCase(); })[0];
        if (ex) ex.evidence.push({ file: 'Wappalyzer (Microlink)', kind: 'insight', match: t.name, context: 'confidence ' + t.confidence + '%' });
        else stack.push({ name: t.name, category: (t.categories || [])[0] || 'Detected', version: '', evidence: [{ file: 'Wappalyzer (Microlink)', kind: 'insight', match: t.name, context: (t.categories || []).join(', ') + ' · confidence ' + t.confidence + '%' }] });
      });
      ev.stack = stack;
      var css = h.inlineCss + '\n' + h.styleAttrs + '\n' + sources.filter(function (s) { return s.kind === 'css'; }).map(function (s) { return s.text; }).join('\n');
      var ca = cssAnalyze(css);
      ev.design = {
        colors: top(ca.colors, 16), cssVariables: top(Object.keys(ca.vars).reduce(function (a, k) { a[k + ': ' + ca.vars[k]] = 1; return a; }, {}), 40).map(function (x) { return x[0]; }),
        fonts: top(ca.fonts, 8), fontFaces: ca.fontFaces.slice(0, 12), fontSizes: top(ca.sizes, 12), spacing: top(ca.spacing, 14), radii: top(ca.radii, 8),
        shadows: ca.shadows, breakpoints: top(ca.breakpoints, 8), keyframes: ca.keyframes, transitions: ca.transitions,
        palette: ev.microlink && ev.microlink.palette || [], themeColor: h.meta['theme-color'] || '', cssBytes: css.length
      };
      var js = { endpoints: [], routes: [], urls: [], sourceMaps: [], prompts: [], storageKeys: [], assets: [], workers: 0, dynamicImports: 0 };
      sources.filter(function (s) { return s.kind === 'js' || s.kind === 'html'; }).forEach(function (s) {
        var r = jsAnalyze(s.text, s.name);
        ['endpoints', 'routes', 'urls', 'sourceMaps', 'prompts', 'storageKeys', 'assets'].forEach(function (k) { r[k].forEach(function (v) { if (js[k].indexOf(v) < 0 && js[k].length < 80) js[k].push(v); }); });
        js.workers += r.workers; js.dynamicImports += r.dynamicImports;
      });
      ev.code = js;
      var hosts = {};
      h.scripts.concat(h.resources).concat(h.styles.map(function (u) { return { url: u }; })).concat(h.media.map(function (u) { return { url: u }; })).forEach(function (r) {
        try { var hh = new URL(r.url).host; if (hh && hh !== host) hosts[hh] = (hosts[hh] || 0) + 1; } catch (e) {}
      });
      ev.thirdParties = top(hosts, 20);
      var inv = {};
      var refs = h.scripts.map(function (s) { return s.url; }).concat(h.styles, h.resources.map(function (r) { return r.url; }), h.media, js.assets);
      refs.forEach(function (u) { var c = classify(u); (inv[c] = inv[c] || []).push(u); });
      Object.keys(inv).forEach(function (k) { var uniq = []; inv[k].forEach(function (u) { if (uniq.indexOf(u) < 0) uniq.push(u); }); inv[k] = uniq; });
      ev.inventory = inv;
      ev.totals = { references: refs.length, fetchedBytes: ev.loaded.reduce(function (a, b) { return a + (b.size || 0); }, 0) + ((ev.html && ev.html.size) || 0) };
      step('evidence', 'Lining up the evidence');
      ev.evidence = buildEvidence(ev);
      ev.cantSee = [
        'Network requests made only after real user interaction (clicks, logins, scrolling deep) unless the rendered snapshot triggered them.',
        'Exact byte sizes and timings of every request: only fetched files are measured; others are references found in the code.',
        'Server-side code, databases, private APIs behind auth, and environment secrets.',
        'Scripts beyond the first ' + ((opts.maxScripts == null ? 6 : opts.maxScripts)) + ' bundles and styles beyond the first ' + ((opts.maxStyles == null ? 4 : opts.maxStyles)) + ' stylesheets.',
        'Anything a free reader was blocked from (bot walls, geo blocks, rate limits).'
      ];
      ev.finishedAt = new Date().toISOString();
      return ev;
    });
  }

  function buildEvidence(ev) {
    var E = [], n = 0;
    function add(claim, source, detail) { n++; E.push({ id: 'E' + n, claim: claim, source: source, detail: (detail || '').slice(0, 220) }); }
    if (ev.html) add('HTML document fetched (' + bytes(ev.html.size) + ')', ev.html.via, ev.html.finalUrl || ev.target);
    if (ev.dom) add('DOM has ' + ev.dom.counts.elements + ' elements: ' + ev.dom.counts.img + ' img, ' + ev.dom.counts.svg + ' svg, ' + ev.dom.counts.video + ' video, ' + ev.dom.counts.iframe + ' iframe, ' + ev.dom.counts.canvas + ' canvas', 'static HTML parse', '');
    if (ev.renderedDom) add('Rendered DOM (after JS) has ' + ev.renderedDom.counts.elements + ' elements and ' + ev.renderedDom.wordCount + ' words', 'Microlink headless Chrome', '');
    (ev.stack || []).forEach(function (s) { var e = s.evidence[0] || {}; add(s.name + (s.version ? ' ' + s.version : '') + ' (' + s.category + ')', e.file + ' · ' + (e.kind === 'insight' ? 'Wappalyzer' : 'fingerprint'), e.context || e.match); });
    (ev.loaded || []).forEach(function (l) { add(l.type + ' file ' + bytes(l.size), l.via, l.url); });
    (ev.code && ev.code.endpoints || []).slice(0, 15).forEach(function (u) { add('Endpoint candidate ' + u, 'string in code', ''); });
    (ev.code && ev.code.routes || []).slice(0, 10).forEach(function (u) { add('Route candidate ' + u, 'string in code', ''); });
    (ev.code && ev.code.sourceMaps || []).forEach(function (u) { add('Source map reference ' + u, 'sourceMappingURL comment', ''); });
    (ev.code && ev.code.prompts || []).slice(0, 5).forEach(function (p) { add('AI prompt-like string found', 'string in code', p); });
    return E;
  }

  /* ---------- Packages: APK / IPA / ZIP / JAR / ASAR / zipped .app / single files ---------- */
  function asciiStrings(u8, min, cap) {
    var out = [], cur = '', max = Math.min(u8.length, 25e6);
    for (var i = 0; i < max; i++) { var c = u8[i]; if (c >= 32 && c < 127) cur += String.fromCharCode(c); else { if (cur.length >= min) { out.push(cur); if (out.length >= cap) break; } cur = ''; } }
    return out;
  }
  function utf16Strings(u8, min, cap) {
    var out = [], cur = '';
    for (var i = 0; i + 1 < u8.length; i += 2) { var c = u8[i] | (u8[i + 1] << 8); if (c >= 32 && c < 127) cur += String.fromCharCode(c); else { if (cur.length >= min) { out.push(cur); if (out.length >= cap) break; } cur = ''; } }
    return out;
  }
  function analyzeAsar(buf, name) {
    var dv = new DataView(buf);
    var jsonLen = dv.getUint32(12, true);
    var header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 16, jsonLen)));
    var headerSize = dv.getUint32(4, true);
    var base = 8 + headerSize, files = [];
    (function walk(node, p) { Object.keys(node.files || {}).forEach(function (k) { var f = node.files[k]; if (f.files) walk(f, p + k + '/'); else files.push({ path: p + k, size: f.size || 0, offset: +f.offset || 0, unpacked: !!f.unpacked }); }); })(header, '');
    function read(path) { var f = files.filter(function (x) { return x.path === path; })[0]; if (!f || f.unpacked) return ''; return new TextDecoder().decode(new Uint8Array(buf, base + f.offset, Math.min(f.size, 4e6))); }
    return { files: files, read: read };
  }

  function analyzePackage(file, opts) {
    opts = opts || {};
    var step = opts.onStep || function () {}, log = opts.onLog || function () {};
    var name = file.name || 'file', lower = name.toLowerCase();
    var ev = { kind: 'package', target: name, host: name, size: file.size, startedAt: new Date().toISOString(), errors: [], loaded: [] };
    step('open', 'Opening the target (' + bytes(file.size) + ')');
    return file.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf);
      var isZip = u8[0] === 0x50 && u8[1] === 0x4b;
      if (/\.asar$/.test(lower) || (!isZip && u8[0] === 4 && u8[1] === 0 && u8[2] === 0 && u8[3] === 0)) {
        step('read', 'Reading the ASAR archive header');
        var a = analyzeAsar(buf, name);
        var pkg = a.read('package.json'), pj = {}; try { pj = JSON.parse(pkg); } catch (e) {}
        var mainSrc = pj.main ? a.read(pj.main.replace(/^\.\//, '')) : '';
        var sources = [{ name: 'package.json', kind: 'js', text: pkg }, { name: pj.main || 'main', kind: 'js', text: mainSrc }];
        a.files.filter(function (f) { return /\.(js|mjs|html)$/.test(f.path) && !/node_modules/.test(f.path); }).slice(0, 12).forEach(function (f) { sources.push({ name: f.path, kind: /html$/.test(f.path) ? 'html' : 'js', text: a.read(f.path) }); });
        return finishPkg(ev, { format: 'Electron ASAR archive', files: a.files.map(function (f) { return { path: f.path, size: f.size }; }), manifest: pj, sources: sources, platform: 'Electron (desktop)', step: step });
      }
      if (isZip && window.JSZip) {
        step('read', 'Unpacking the archive (zip container)');
        return JSZip.loadAsync(buf).then(function (zip) {
          var files = [];
          zip.forEach(function (p, f) { if (!f.dir) files.push({ path: p, size: (f._data && f._data.uncompressedSize) || 0, entry: f }); });
          log(files.length + ' files inside');
          return inspectZip(ev, zip, files, lower, step, log);
        });
      }
      // single text-ish file
      step('read', 'Reading the file as source');
      var text = new TextDecoder().decode(u8.slice(0, 6e6));
      var kind = /\.css$/.test(lower) ? 'css' : (/\.html?$/.test(lower) ? 'html' : 'js');
      var printable = (text.match(/[\x20-\x7e\n\r\t]/g) || []).length / Math.max(1, text.length);
      var sources;
      if (printable < 0.7) { sources = [{ name: name + ' (strings)', kind: 'js', text: asciiStrings(u8, 6, 40000).join('\n') }]; ev.binary = true; }
      else sources = [{ name: name, kind: kind, text: text }];
      return finishPkg(ev, { format: ev.binary ? 'Binary (strings only)' : kind.toUpperCase() + ' source file', files: [{ path: name, size: file.size }], sources: sources, platform: ev.binary ? 'Native binary' : 'Web source', step: step, single: kind === 'css' ? text : '' });
    });
  }

  function inspectZip(ev, zip, files, lower, step, log) {
    var has = function (re) { return files.some(function (f) { return re.test(f.path); }); };
    var platform = 'Archive', format = 'ZIP archive', frameworks = [];
    if (has(/^AndroidManifest\.xml$/)) { platform = 'Android'; format = /\.aab$/.test(lower) ? 'Android App Bundle' : 'Android APK'; }
    else if (has(/^Payload\/[^/]+\.app\//)) { platform = 'iOS'; format = 'iOS IPA'; }
    else if (has(/\.app\/Contents\/Info\.plist$/) || has(/^Contents\/Info\.plist$/)) { platform = 'macOS'; format = 'macOS .app bundle (zipped)'; }
    else if (has(/^manifest\.json$/) && has(/\.js$/)) { platform = 'Browser extension'; format = 'Browser extension package'; }
    else if (has(/^META-INF\/MANIFEST\.MF$/)) { platform = 'Java'; format = 'Java JAR'; }
    else if (has(/^\[Content_Types\]\.xml$/)) { platform = 'Office document'; format = 'OOXML document'; }
    var F = function (n, re, why) { if (has(re)) frameworks.push({ name: n, category: 'App framework', version: '', evidence: [{ file: (files.filter(function (f) { return re.test(f.path); })[0] || {}).path, kind: 'file', match: why, context: why }] }); };
    F('Flutter', /libflutter\.so|flutter_assets\//, 'libflutter.so / flutter_assets present');
    F('React Native', /index\.android\.bundle|main\.jsbundle|libreactnativejni|libhermes/, 'React Native JS bundle / Hermes library');
    F('Hermes JS engine', /libhermes/, 'libhermes.so present');
    F('Capacitor', /capacitor\.config\.json|assets\/public\/index\.html/, 'Capacitor web assets');
    F('Cordova', /cordova\.js|assets\/www\//, 'Cordova www folder');
    F('Xamarin / .NET MAUI', /libmonodroid|assemblies\/.*\.dll|libmonosgen/, '.NET assemblies on Android');
    F('Unity', /libunity\.so|assets\/bin\/Data\/|UnityFramework/, 'Unity runtime');
    F('Godot', /libgodot/, 'Godot runtime');
    F('Kotlin', /^kotlin\/|kotlin-stdlib/, 'Kotlin metadata');
    F('Electron', /app\.asar|Electron Framework\.framework/, 'Electron runtime');
    F('Qt', /libQt\d|QtCore\.framework/, 'Qt libraries');
    F('SwiftUI / Swift runtime', /libswift|\.swiftmodule/, 'Swift libraries');
    var abis = {}; files.forEach(function (f) { var m = /^lib\/([^/]+)\/[^/]+\.so$/.exec(f.path); if (m) abis[m[1]] = 1; });
    var exts = files.filter(function (f) { return /PlugIns\/[^/]+\.appex\/$|PlugIns\/[^/]+\.appex\/Contents\/Info\.plist$|PlugIns\/[^/]+\.appex\/Info\.plist$/.test(f.path); }).map(function (f) { return /PlugIns\/([^/]+\.appex)/.exec(f.path)[1]; });
    var sources = [], manifest = {}, extras = { abis: Object.keys(abis), extensions: exts.filter(function (x, i) { return exts.indexOf(x) === i; }) };
    var jobs = [];
    var readText = function (path, kind, cap) { var f = zip.file(path); if (!f) return Promise.resolve(); return f.async('uint8array').then(function (u8) { var t = new TextDecoder().decode(u8.slice(0, cap || 4e6)); sources.push({ name: path, kind: kind, text: t }); return t; }); };
    if (platform === 'Android') {
      step('stack', 'REA-lite: inspect manifest + dex strings');
      jobs.push(zip.file('AndroidManifest.xml').async('uint8array').then(function (u8) {
        var strs = utf16Strings(u8, 3, 4000).concat(asciiStrings(u8, 4, 4000));
        manifest.permissions = strs.filter(function (s) { return /^android\.permission\.|\.permission\.[A-Z_]+$/.test(s); }).filter(function (v, i, a) { return a.indexOf(v) === i; });
        manifest.components = strs.filter(function (s) { return /^[a-z][\w]*(\.[\w$]+){2,}$/.test(s) && /Activity|Service|Receiver|Provider/.test(s); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 30);
        manifest.package = (strs.filter(function (s) { return /^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,5}$/.test(s) && !/^android\./.test(s); })[0]) || '';
      }));
      var dexes = files.filter(function (f) { return /^classes\d*\.dex$/.test(f.path); }).slice(0, 4);
      dexes.forEach(function (d) { jobs.push(d.entry.async('uint8array').then(function (u8) {
        var strs = asciiStrings(u8, 6, 200000), pk = {};
        strs.forEach(function (s) { var m = /^L([a-z][\w]*\/[\w]+(?:\/[\w]+)?)\//.exec(s); if (m) pk[m[1]] = (pk[m[1]] || 0) + 1; });
        manifest.dexPackages = top(pk, 30);
        sources.push({ name: d.path + ' (strings)', kind: 'js', text: strs.join('\n').slice(0, 3e6) });
      })); });
      ['assets/index.android.bundle', 'assets/capacitor.config.json', 'assets/public/index.html'].forEach(function (p) { if (zip.file(p)) jobs.push(readText(p, /html$/.test(p) ? 'html' : 'js')); });
    } else if (platform === 'iOS' || platform === 'macOS') {
      step('stack', 'REA-lite: inspect plist + binary strings');
      var plist = files.filter(function (f) { return /(Payload\/[^/]+\.app\/Info\.plist|\.app\/Contents\/Info\.plist|^Contents\/Info\.plist)$/.test(f.path); })[0];
      if (plist) jobs.push(plist.entry.async('uint8array').then(function (u8) {
        var t = new TextDecoder().decode(u8);
        var get = function (k) { var m = new RegExp('<key>' + k + '</key>\\s*<string>([^<]*)</string>').exec(t); return m ? m[1] : ''; };
        if (/<plist/.test(t)) { manifest.bundleId = get('CFBundleIdentifier'); manifest.version = get('CFBundleShortVersionString'); manifest.build = get('CFBundleVersion'); manifest.executable = get('CFBundleExecutable'); manifest.minOS = get('LSMinimumSystemVersion') || get('MinimumOSVersion'); manifest.principalClass = get('NSPrincipalClass'); }
        else { var s = asciiStrings(u8, 3, 3000); manifest.plistStrings = s.slice(0, 80); }
        sources.push({ name: plist.path, kind: 'js', text: t.slice(0, 200000) });
      }));
      var bin = files.filter(function (f) { return /\.app\/(Contents\/MacOS\/[^/]+|[^/.]+)$/.test(f.path) && f.size > 10000; }).sort(function (a, b) { return b.size - a.size; })[0];
      if (bin) jobs.push(bin.entry.async('uint8array').then(function (u8) {
        var magic = (u8[0] << 24 | u8[1] << 16 | u8[2] << 8 | u8[3]) >>> 0;
        manifest.machO = { cafebabe: 'universal (fat) binary', feedfacf: 'Mach-O 64-bit (BE)', cffaedfe: 'Mach-O 64-bit', cefaedfe: 'Mach-O 32-bit' }[magic.toString(16)] || ('magic 0x' + magic.toString(16));
        var s = asciiStrings(u8, 6, 150000);
        manifest.linkedFrameworks = s.filter(function (x) { return /\.framework\/|\/usr\/lib\/.*\.dylib/.test(x); }).filter(function (v, i, a) { return a.indexOf(v) === i; }).slice(0, 40);
        var pre = {}; s.forEach(function (x) { var m = /^([A-Z]{2,4})[A-Z][a-z]+(?:View|Controller|Manager|Window|Cell|Model)\b/.exec(x); if (m) pre[m[1]] = (pre[m[1]] || 0) + 1; });
        manifest.classPrefixes = top(pre, 8);
        sources.push({ name: bin.path + ' (strings)', kind: 'js', text: s.join('\n').slice(0, 3e6) });
      }));
    } else {
      step('stack', 'Reading manifests and sources');
      ['manifest.json', 'package.json', 'META-INF/MANIFEST.MF'].forEach(function (p) { if (zip.file(p)) jobs.push(readText(p, 'js').then(function (t) { try { manifest[p] = JSON.parse(t); } catch (e) { manifest[p] = (t || '').slice(0, 2000); } })); });
      files.filter(function (f) { return /\.(m?js|html?|css)$/.test(f.path) && !/node_modules|\.min\.|vendor/.test(f.path); }).sort(function (a, b) { return b.size - a.size; }).slice(0, 10)
        .forEach(function (f) { jobs.push(readText(f.path, /css$/.test(f.path) ? 'css' : (/html?$/.test(f.path) ? 'html' : 'js'), 2e6)); });
    }
    return Promise.all(jobs).then(function () {
      return finishPkg(ev, { format: format, platform: platform, files: files.map(function (f) { return { path: f.path, size: f.size }; }), manifest: manifest, sources: sources, frameworks: frameworks, extras: extras, step: step });
    });
  }

  function finishPkg(ev, o) {
    var step = o.step || function () {};
    step('evidence', 'Lining up the evidence');
    ev.format = o.format; ev.platform = o.platform; ev.manifest = o.manifest || {}; ev.extras = o.extras || {};
    var byType = {};
    (o.files || []).forEach(function (f) { var e = extOf(f.path) || '(none)'; byType[e] = byType[e] || { count: 0, bytes: 0 }; byType[e].count++; byType[e].bytes += f.size || 0; });
    ev.fileTypes = Object.keys(byType).map(function (k) { return [k, byType[k].count, byType[k].bytes]; }).sort(function (a, b) { return b[2] - a[2]; }).slice(0, 15);
    ev.largest = (o.files || []).slice().sort(function (a, b) { return (b.size || 0) - (a.size || 0); }).slice(0, 15);
    ev.fileCount = (o.files || []).length;
    ev.tree = (o.files || []).slice(0, 400).map(function (f) { return f.path; });
    ev.stack = (o.frameworks || []).concat(fingerprint(o.sources || []).filter(function (s) { return s.category !== 'Build tool' || true; }));
    var css = (o.sources || []).filter(function (s) { return s.kind === 'css' || s.kind === 'html'; }).map(function (s) { return s.text; }).join('\n') + (o.single || '');
    var ca = cssAnalyze(css);
    ev.design = { colors: top(ca.colors, 16), fonts: top(ca.fonts, 8), fontSizes: top(ca.sizes, 10), spacing: top(ca.spacing, 12), radii: top(ca.radii, 8), breakpoints: top(ca.breakpoints, 8), keyframes: ca.keyframes, cssVariables: Object.keys(ca.vars).slice(0, 30).map(function (k) { return k + ': ' + ca.vars[k]; }) };
    var js = { endpoints: [], routes: [], urls: [], sourceMaps: [], prompts: [], storageKeys: [], assets: [], workers: 0, dynamicImports: 0 };
    (o.sources || []).forEach(function (s) { var r = jsAnalyze(s.text, s.name); ['endpoints', 'routes', 'urls', 'sourceMaps', 'prompts', 'storageKeys'].forEach(function (k) { r[k].forEach(function (v) { if (js[k].indexOf(v) < 0 && js[k].length < 60) js[k].push(v); }); }); js.workers += r.workers; });
    ev.code = js;
    ev.sources = (o.sources || []).map(function (s) { return { name: s.name, kind: s.kind, size: (s.text || '').length }; });
    var E = [], n = 0, add = function (c, s, d) { n++; E.push({ id: 'E' + n, claim: c, source: s, detail: (d || '').slice(0, 220) }); };
    add('Format: ' + ev.format + ' with ' + ev.fileCount + ' files (' + bytes(ev.size) + ')', 'container parse', '');
    ev.stack.forEach(function (s) { var e = s.evidence[0] || {}; add(s.name + (s.version ? ' ' + s.version : '') + ' (' + s.category + ')', e.file + ' · ' + (e.kind || 'fingerprint'), e.context || e.match); });
    if (ev.manifest.package) add('Package id candidate ' + ev.manifest.package, 'AndroidManifest.xml strings', '');
    (ev.manifest.permissions || []).slice(0, 12).forEach(function (p) { add('Permission ' + p, 'AndroidManifest.xml strings', ''); });
    if (ev.manifest.bundleId) add('Bundle ' + ev.manifest.bundleId + ' v' + ev.manifest.version + ' build ' + ev.manifest.build, 'Info.plist', '');
    if (ev.manifest.machO) add('Executable is ' + ev.manifest.machO, 'Mach-O header magic', '');
    (ev.extras.extensions || []).forEach(function (x) { add('App extension ' + x, 'PlugIns folder', ''); });
    if ((ev.extras.abis || []).length) add('Native ABIs: ' + ev.extras.abis.join(', '), 'lib/ folder', '');
    js.endpoints.slice(0, 12).forEach(function (u) { add('Endpoint candidate ' + u, 'string in code', ''); });
    js.prompts.slice(0, 5).forEach(function (p) { add('AI prompt-like string found', 'string in code', p); });
    ev.evidence = E;
    ev.cantSee = ['Runtime behaviour: nothing was executed (static inspection only).', 'Decompiled method bodies (needs JADX/Ghidra/Hopper; use the REA CLI or the skill for that).', 'Encrypted, obfuscated or downloaded-later code and server APIs.', 'Binary plist and compiled XML are read as strings, so some fields may be missing.'];
    ev.finishedAt = new Date().toISOString();
    return ev;
  }

  /* Local palette from an uploaded image (median-cut lite). Returns ['#rrggbb', ...]. */
  function imagePalette(img, n) {
    var c = document.createElement('canvas'), W = 120, H = Math.max(1, Math.round(120 * img.naturalHeight / img.naturalWidth));
    c.width = W; c.height = H; var x = c.getContext('2d'); x.drawImage(img, 0, 0, W, H);
    var d = x.getImageData(0, 0, W, H).data, buckets = {};
    for (var i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; var k = (d[i] >> 4) + ',' + (d[i + 1] >> 4) + ',' + (d[i + 2] >> 4); var b = buckets[k] || (buckets[k] = [0, 0, 0, 0]); b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++; }
    var hex = function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); };
    var arr = Object.keys(buckets).map(function (k) { var b = buckets[k]; return { c: '#' + hex(b[0] / b[3]) + hex(b[1] / b[3]) + hex(b[2] / b[3]), n: b[3], r: b[0] / b[3], g: b[1] / b[3], b: b[2] / b[3] }; }).sort(function (a, b) { return b.n - a.n; });
    var out = [];
    arr.forEach(function (p) { if (out.length >= (n || 8)) return; if (out.every(function (q) { return Math.abs(q.r - p.r) + Math.abs(q.g - p.g) + Math.abs(q.b - p.b) > 60; })) out.push(p); });
    return out.map(function (p) { return p.c; });
  }

  window.XScan = {
    READERS: READERS, normUrl: normUrl, bytes: bytes, fetchVia: fetchVia, microlink: microlink, screenshotUrl: screenshotUrl,
    fingerprint: fingerprint, cssAnalyze: cssAnalyze, jsAnalyze: jsAnalyze, htmlAnalyze: htmlAnalyze, scanWebsite: scanWebsite,
    analyzePackage: analyzePackage, cleanRendered: cleanRendered, imagePalette: imagePalette, top: top, classify: classify, SIGS: SIGS
  };
})();
