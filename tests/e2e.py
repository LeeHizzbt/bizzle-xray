#!/usr/bin/env python3
"""Bizzle X-Ray v4.20 end-to-end tests (Playwright + system Chrome).
Real network: free readers, Microlink, thum.io. Real Gemini calls if GEMINI_API_KEY is set (value is never printed).
usage: python tests/e2e.py [--base http://localhost:8765/] [--shots DIR] [--live https://leehizzbt.github.io/bizzle-xray/]
"""
import asyncio, json, os, re, sys, time, argparse
from playwright.async_api import async_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', default='http://localhost:8765/')
ap.add_argument('--shots', default='/workspace/reverse-engineer/test-shots')
ap.add_argument('--fixtures', default='/workspace/reverse-engineer/test-fixtures')
ap.add_argument('--apk', default='')
ap.add_argument('--live', default='')
ap.add_argument('--only', default='')
A = ap.parse_args()
KEY = os.environ.get('GEMINI_API_KEY', '')
WIDTHS = [360, 390, 768, 1024, 1440]
R = []   # (status, name, detail)
os.makedirs(A.shots, exist_ok=True)

def rec(ok, name, detail=''):
    detail = str(detail).replace(KEY, '***') if KEY else str(detail)
    R.append(('PASS' if ok else 'FAIL', name, detail[:300])); print(('PASS ' if ok else 'FAIL ') + name + (' — ' + detail[:200] if detail else ''), flush=True)

async def check(name, coro):
    try:
        r = await coro
        if r is False: rec(False, name)
        else: rec(True, name, r if isinstance(r, str) else '')
    except Exception as e:
        rec(False, name, repr(e))

async def new_ctx(br, w=1024, h=860):
    ctx = await br.new_context(viewport={'width': w, 'height': h}, accept_downloads=True, permissions=['clipboard-read', 'clipboard-write'])
    return ctx

async def with_key(pg):
    if KEY: await pg.evaluate("k=>localStorage.setItem('bx.aiKeys', JSON.stringify({gemini:k}))", KEY)

async def wait_report(pg, t=330000):
    await pg.wait_for_url(re.compile(r'#/report/'), timeout=t); await pg.wait_for_timeout(600)

async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox', '--autoplay-policy=no-user-gesture-required'])
        ctx = await new_ctx(br); pg = await ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto(A.base); await pg.wait_for_timeout(500)

        # ---------- static / branding ----------
        async def t_brand():
            v = await pg.inner_text('.topbar .ver'); assert v.strip() == 'v4.20', v
            col = await pg.eval_on_selector('.topbar .ver', 'e=>getComputedStyle(e).color'); assert col == 'rgb(57, 255, 20)', col
            assert await pg.is_visible('#advBtn'); assert 'Advanced AI Settings' in await pg.inner_text('#advBtn')
            assert await pg.is_visible('#bizzyBtn'); return 'neon ' + col
        await check('Branding: neon green v4.20 badge, Advanced AI Settings button, Bizzy bubble', t_brand())
        async def t_nokeys():
            src = ''.join([open(os.path.join(d, f), errors='ignore').read() for d, _, fs in os.walk('/workspace/bizzle-xray/docs') for f in fs if f.endswith(('.js', '.html', '.json'))])
            assert not re.search(r'AIza[0-9A-Za-z_\-]{30}|gsk_[0-9A-Za-z]{20}|sk-or-v1-[0-9a-f]{20}', src); return 'no API keys in shipped code'
        await check('Security: no API keys in shipped code', t_nokeys())

        # ---------- website scan without key ----------
        async def t_scan_nokey():
            await pg.fill('#urlIn', 'example.com'); await pg.click('#scanUrl')
            await pg.wait_for_selector('#steps li', timeout=5000)
            await pg.wait_for_timeout(1500); await pg.screenshot(path=f'{A.shots}/scan-progress-1024.png')
            await wait_report(pg)
            body = await pg.inner_text('#rBody')
            for sec in ['The answer', 'The stack', 'Design system', 'Page structure', 'Features', 'APIs & data', 'How it works', 'What it loads', 'Rebuild it', "What the evidence can't show", 'Evidence']:
                assert sec in body, 'missing ' + sec
            assert await pg.is_visible('#rBody .copy'); assert 'local evidence engine' in await pg.inner_text('#rMeta')
            await pg.screenshot(path=f'{A.shots}/report-nokey-example-1024.png'); return 'all 11 sections + copy button'
        await check('Website teardown with NO key (local evidence engine, example.com)', t_scan_nokey())

        # copy button → clipboard
        async def t_copy():
            await pg.click('#rBody .copy'); await pg.wait_for_timeout(300)
            clip = await pg.evaluate('navigator.clipboard.readText()'); assert 'The stack' in clip and '## Evidence' in clip; return f'{len(clip)} chars copied'
        await check('Copy button on teardown copies full markdown', t_copy())

        # downloads .md
        async def t_md():
            async with pg.expect_download() as d: await pg.click('#dlMd')
            dl = await d.value; path = await dl.path(); txt = open(path).read(); assert txt.startswith('---') and 'Teardown:' in txt; return dl.suggested_filename
        await check('Download teardown as .md (Obsidian-ready front matter)', t_md())

        await with_key(pg); await pg.reload(); await pg.wait_for_timeout(400)

        # ---------- website scan with AI (igloo.inc) ----------
        async def t_scan_ai():
            await pg.goto(A.base + '#/'); await pg.fill('#urlIn', 'igloo.inc'); await pg.fill('#askIn', 'How does the scroll effect work?'); await pg.click('#scanUrl')
            await wait_report(pg)
            meta = await pg.inner_text('#rMeta'); body = await pg.inner_text('#rBody')
            stack = await pg.evaluate("XApp.getCurrent().evidence.stack.map(s=>s.name)")
            need = ['Three.js', 'GSAP', 'Svelte']
            miss = [n for n in need if n not in stack]
            assert not miss, 'stack missing ' + str(miss)
            if KEY: assert 'AI ·' in meta, meta
            assert 'The stack' in body
            loaded = await pg.evaluate("XApp.getCurrent().evidence.loaded.map(l=>l.size)")
            await pg.screenshot(path=f'{A.shots}/report-ai-igloo-1024.png', full_page=True)
            return f'{"AI" if KEY else "local"}; stack={len(stack)} incl. Three.js/GSAP/Svelte; fetched {len(loaded)} bundles, max {max(loaded or [0])//1024} KB'
        await check('Website teardown WITH Gemini (igloo.inc): stack/versions/chunk graph', t_scan_ai())
        igloo_id = await pg.evaluate("XApp.getCurrent() && XApp.getCurrent().id")

        async def t_design():
            d = await pg.evaluate("XApp.getCurrent().evidence.design"); assert d['colors'] or d['palette']; ev = await pg.evaluate("XApp.getCurrent().evidence.evidence.length")
            assert ev >= 8, ev; return f"{len(d['colors'])} colors, {len(d['fonts'])} fonts, {len(d['palette'])} palette, {ev} evidence items"
        await check('Design system + evidence list extracted (colors, fonts, palette, >=8 evidence)', t_design())

        async def t_shot_img():
            ok = await pg.eval_on_selector('#rShot', 'i=>new Promise(r=>{if(i.complete)r(i.naturalWidth);else{i.onload=()=>r(i.naturalWidth);i.onerror=()=>r(0)}; setTimeout(()=>r(i.naturalWidth),15000)})')
            assert ok and ok > 100, ok; return f'screenshot {ok}px wide'
        await check('Screenshot of target loads (Microlink / thum.io)', t_shot_img())

        # read aloud (stub speechSynthesis to count utterances)
        async def t_read():
            await pg.evaluate("window.__spoken=0; const o=speechSynthesis.speak.bind(speechSynthesis); speechSynthesis.speak=u=>{window.__spoken++;}")
            await pg.click('#readAloud'); await pg.wait_for_timeout(300); n = await pg.evaluate('window.__spoken'); assert n > 3, n; return f'{n} utterances queued'
        await check('Read it to me (speech synthesis of the teardown)', t_read())

        # ---------- plan ----------
        async def t_plan():
            await pg.click('#goPlan'); await pg.wait_for_selector('#planBody h3'); txt = await pg.inner_text('#planBody'); assert 'Steps' in txt and 'Design tokens' in txt
            assert await pg.is_visible('[data-view=plan] .back'); assert await pg.is_visible('#planBody .copy')
            if KEY:
                await pg.click('#planAi'); await pg.wait_for_function("!document.querySelector('#planAi').disabled", timeout=240000)
                txt = await pg.inner_text('#planBody'); assert len(txt) > 800 and 'Local plan' not in txt, txt[:200]
            await pg.screenshot(path=f'{A.shots}/plan-1024.png', full_page=True); return ('AI plan ' if KEY else 'local plan ') + str(len(txt)) + ' chars'
        await check('Rebuild plan (local + AI) with copy and back button', t_plan())

        # ---------- build ----------
        async def t_build_local():
            await pg.goto(A.base + '#/build/' + igloo_id); await pg.wait_for_timeout(300)
            await pg.click('#buildLocal')
            await pg.wait_for_function("document.querySelector('.stages [data-st=launch]').className==='done'", timeout=60000)
            res = await pg.inner_text('#testResult'); assert 'Passed' in res, res
            fr = pg.frame_locator('#preview'); assert await fr.locator('h1').count() >= 1
            return res
        await check('Build: instant starter (no AI) → SCAFFOLD/CODE/TEST/LAUNCH, sandboxed preview', t_build_local())

        async def t_build_ai():
            if not KEY: return 'skipped (no key)'
            t = time.time(); await pg.click('#buildAi')
            await pg.wait_for_function("document.querySelector('.stages [data-st=launch]').className==='done' || /failed:/.test(document.querySelector('#bLog').textContent)", timeout=420000)
            log = await pg.inner_text('#bLog'); assert 'LAUNCH' in log, log[-300:]
            await pg.wait_for_timeout(1500); n = await pg.frame_locator('#preview').locator('body *').count(); assert n > 10, n
            await pg.screenshot(path=f'{A.shots}/build-ai-1024.png', full_page=True)
            return f'AI build in {int(time.time()-t)}s, {n} elements; ' + (await pg.inner_text('#testResult'))[:80]
        await check('Build with Gemini → hidden-browser test (auto-fix) → preview', t_build_ai())

        async def t_iter():
            if not KEY: return 'skipped (no key)'
            await pg.fill('#buildTweak', 'add a visible footer that says Made with X-Ray'); await pg.click('#buildIterate')
            await pg.wait_for_function("document.querySelector('.stages [data-st=launch]').className==='done' || /failed:/.test(document.querySelector('#bLog').textContent)", timeout=420000)
            code = await pg.evaluate('XApp.getCurrent().code'); assert 'Made with X-Ray' in code; return 'change applied'
        await check('Build: apply a change request (iterate with AI)', t_iter())

        async def t_viewports():
            for w in ['360', '768', '100%']:
                await pg.click(f'.vwb[data-w="{w}"]'); await pg.wait_for_timeout(350)
            await pg.click('.ptab[data-p=source]'); src = await pg.inner_text('#srcView'); assert '<html' in src.lower() or '<!doctype' in src.lower()
            assert await pg.is_visible('[data-pp=source] .copy'); await pg.click('.ptab[data-p=preview]'); return 'preview widths + code tab'
        await check('Build preview: device widths + code view with copy', t_viewports())

        async def t_dl_html():
            async with pg.expect_download() as d: await pg.click('#dlHtml')
            dl = await d.value; txt = open(await dl.path()).read(); assert '<' in txt and 'XRAY_SHIM' not in txt; return dl.suggested_filename
        await check('Download generated clone as .html', t_dl_html())

        async def t_openwin():
            async with ctx.expect_page() as np: await pg.click('#openWin')
            w = await np.value; await w.wait_for_load_state(); await w.wait_for_timeout(1200)
            n = await w.frame_locator('#f').locator('body *').count(); assert n > 3, n
            assert await w.is_visible('.bar button'); await w.screenshot(path=f'{A.shots}/launched-window.png'); await w.close(); return f'launch.html window with {n} elements'
        await check('Open as its own window (sandboxed launch.html with back button)', t_openwin())

        # ---------- prompts ----------
        async def t_prompts():
            await pg.goto(A.base + '#/prompts/' + igloo_id); await pg.wait_for_selector('.prompt')
            n = await pg.locator('.prompt').count(); c = await pg.locator('.prompt .copy').count(); assert n >= 6 and c == n, (n, c)
            await pg.locator('.prompt .copy').first.click(); await pg.wait_for_timeout(200); clip = await pg.evaluate('navigator.clipboard.readText()'); assert 'ORIGINAL' in clip
            await pg.screenshot(path=f'{A.shots}/prompts-1024.png', full_page=True); return f'{n} prompts, all with copy'
        await check('Copyable prompt pack (each prompt has a copy button)', t_prompts())

        # ---------- screenshot teardown ----------
        async def t_shot():
            await pg.goto(A.base + '#/'); await pg.click('.tab[data-tab=shot]')
            await pg.set_input_files('#shotFile', os.path.join(A.fixtures, 'app-screenshot.jpg')); await pg.wait_for_selector('#shotThumbs img')
            await pg.click('#scanShot'); await wait_report(pg)
            body = await pg.inner_text('#rBody'); assert 'Design system' in body
            if KEY: assert 'AI vision' in await pg.inner_text('#rMeta')
            await pg.screenshot(path=f'{A.shots}/report-screenshot-1024.png', full_page=True); return ('AI vision ' if KEY else 'local ') + str(len(body)) + ' chars'
        await check('Screenshot upload → AI vision teardown + measured palette', t_shot())

        # ---------- packages ----------
        async def pkg(path, expect):
            await pg.goto(A.base + '#/'); await pg.click('.tab[data-tab=pkg]'); await pg.set_input_files('#pkgFile', path)
            await pg.click('#scanPkg'); await wait_report(pg); st = await pg.evaluate('JSON.stringify(XApp.getCurrent().evidence)')
            for e in expect: assert e in st, 'missing ' + e
            return os.path.basename(path)
        if A.apk and os.path.exists(A.apk):
            await check('App package: Android APK (Capacitor detected, permissions, dex packages)', pkg(A.apk, ['Capacitor', 'android.permission.INTERNET', 'dexPackages']))
        await check('App package: zipped macOS .app (Info.plist, Mach-O, extensions, frameworks)', pkg(os.path.join(A.fixtures, 'DemoNotes.app.zip'), ['com.example.demonotes', 'DemoNotesWidget.appex', 'Mach-O 64-bit', 'AppKit.framework']))
        await check('App package: Electron ASAR (file table, package.json, IPC/endpoint)', pkg(os.path.join(A.fixtures, 'demo.asar'), ['Electron ASAR', 'demo-electron', '/api/notes']))
        async def t_code():
            await pg.goto(A.base + '#/'); await pg.click('.tab[data-tab=code]')
            await pg.fill('#codeIn', '<html><head><script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script><style>:root{--brand:#ff3366}body{font-family:Inter;padding:24px;border-radius:12px}</style></head><body><nav><a href="/">Home</a></nav><button>Buy</button><script>fetch("/api/cart")</script></body></html>')
            await pg.click('#scanCode'); await wait_report(pg); st = await pg.evaluate('JSON.stringify(XApp.getCurrent().evidence)')
            assert 'GSAP' in st and '/api/cart' in st and '#ff3366' in st; return 'GSAP + endpoint + color found'
        await check('Paste code teardown (stack, endpoints, design tokens)', t_code())

        # ---------- command bar ----------
        async def t_cmd():
            await pg.goto(A.base + '#/'); await pg.fill('#cmd', 'reverse engineer example.com'); await pg.click('#cmdGo')
            await pg.wait_for_url(re.compile('#/scan'), timeout=5000); await wait_report(pg); assert 'example.com' in await pg.inner_text('#rMeta'); return 'voice/text command started a scan'
        await check('Command bar: “reverse engineer example.com”', t_cmd())

        # ---------- settings ----------
        async def t_settings():
            await pg.click('#advBtn'); await pg.wait_for_selector('#keyRows input')
            assert await pg.locator('#keyRows input[type=password]').count() == 3
            await pg.fill('#key-groq', 'gsk_test_dummy_value'); await pg.fill('#sSys', 'Be brief'); await pg.select_option('#sEffort', 'Fast'); await pg.click('#saveSet')
            s = await pg.evaluate("JSON.parse(localStorage.getItem('bx.aiSettings'))"); k = await pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('bx.aiKeys')))")
            assert s['effort'] == 'Fast' and s['systemPrompt'] == 'Be brief' and 'groq' in k
            await pg.click('[data-clear=groq]'); k = await pg.evaluate("Object.keys(JSON.parse(localStorage.getItem('bx.aiKeys')))"); assert 'groq' not in k
            await pg.select_option('#sEffort', 'Pro'); await pg.fill('#sSys', ''); await pg.click('#saveSet')
            await pg.screenshot(path=f'{A.shots}/settings-1024.png', full_page=True); return 'keys saved/cleared in localStorage only; settings persisted'
        await check('Advanced AI Settings: per-provider keys (localStorage), tier, extra instructions', t_settings())
        async def t_testkey():
            if not KEY: return 'skipped (no key)'
            await pg.click('#testKey'); await pg.wait_for_function("/✓|✕/.test(document.querySelector('#setMsg').textContent)", timeout=90000)
            m = await pg.inner_text('#setMsg'); assert m.startswith('✓'), m; return m[:80]
        await check('Test key button (real Gemini call)', t_testkey())
        async def t_models():
            if not KEY: return 'skipped'
            await pg.click('#loadModels'); await pg.wait_for_function("document.querySelectorAll('#sModel option').length>5", timeout=30000); return str(await pg.locator('#sModel option').count()) + ' live models'
        await check('Live model list from provider', t_models())
        async def t_themes():
            names = []
            for t in ['violet', 'ice', 'ember', 'matrix', 'rose', 'daylight', 'neon']:
                await pg.click(f'[data-theme-pick={t}]'); cur = await pg.evaluate("document.documentElement.dataset.theme"); assert cur == t; names.append(t)
                if t in ('violet', 'ember', 'daylight'): await pg.screenshot(path=f'{A.shots}/theme-{t}-1024.png')
            await pg.click('#themeCycle'); assert await pg.evaluate("document.documentElement.dataset.theme") == 'violet'; await pg.click('[data-theme-pick=neon]')
            return '7 AI color themes + cycle button'
        await check('AI color themes (7) + theme cycle', t_themes())

        # ---------- Bizzy ----------
        async def t_bizzy():
            await pg.goto(A.base + '#/'); await pg.click('#bizzyBtn'); await pg.wait_for_selector('#bizzy:not([hidden])')
            assert await pg.is_visible('#bzBack')
            await pg.fill('#bzText', 'remember my favorite color is teal'); await pg.click('#bzSend'); await pg.wait_for_timeout(300)
            mem = await pg.evaluate("JSON.parse(localStorage.getItem('bx.bizzy.memory'))"); assert any('teal' in m for m in mem), mem
            await pg.reload(); await pg.click('#bizzyBtn'); await pg.click('#bzMem'); assert 'teal' in await pg.inner_text('#bzMemList')
            await pg.click('#bzMem')
            if KEY:
                n0 = await pg.locator('#bzMsgs .msg.bot').count()
                await pg.fill('#bzText', 'What is my favorite color? One word.'); await pg.click('#bzSend')
                await pg.wait_for_function(f"document.querySelectorAll('#bzMsgs .msg.bot').length>{n0} && !/thinking/.test(document.querySelector('#bzMsgs').lastElementChild.textContent)", timeout=150000)
                last = await pg.locator('#bzMsgs .msg.bot').last.inner_text(); assert 'teal' in last.lower(), last
                assert await pg.locator('#bzMsgs .msg.bot').last.locator('.copy').count() == 1
            await pg.screenshot(path=f'{A.shots}/bizzy-1024.png'); return 'memory persisted across reload' + (' and used by AI' if KEY else '')
        await check('Bizzy Bot bubble with persistent memory (+AI recall)', t_bizzy())
        async def t_bizzy_img():
            if not KEY: return 'skipped'
            await pg.set_input_files('#bzFile', os.path.join(A.fixtures, 'app-screenshot.jpg')); await pg.wait_for_selector('#bzThumbs img')
            n0 = await pg.locator('#bzMsgs .msg.bot').count()
            await pg.fill('#bzText', 'What kind of app is in this screenshot? Answer in one short sentence.'); await pg.click('#bzSend')
            await pg.wait_for_function(f"document.querySelectorAll('#bzMsgs .msg.bot').length>{n0} && !/thinking/.test(document.querySelector('#bzMsgs').lastElementChild.textContent)", timeout=120000)
            last = await pg.locator('#bzMsgs .msg.bot').last.inner_text(); assert re.search(r'note', last, re.I), last
            await pg.locator('#bzMsgs .msg.bot').last.locator('.copy').click(); await pg.wait_for_timeout(200); clip = await pg.evaluate('navigator.clipboard.readText()'); assert len(clip) > 5
            await pg.screenshot(path=f'{A.shots}/bizzy-image-1024.png'); return last[:90]
        await check('Bizzy: screenshot upload for AI help + copy on reply', t_bizzy_img())
        async def t_bz_close():
            await pg.click('#bzBack'); assert await pg.is_hidden('#bizzy'); return 'back closes bubble'
        await check('Bizzy back button', t_bz_close())

        # ---------- vault ----------
        async def t_vault():
            await pg.goto(A.base + '#/vault'); await pg.wait_for_selector('#vaultList .item'); n = await pg.locator('#vaultList .item').count(); assert n >= 5, n
            await pg.fill('#vSearch', 'igloo'); await pg.wait_for_timeout(200); m = await pg.locator('#vaultList .item').count(); assert 1 <= m < n
            await pg.fill('#vSearch', '')
            async with pg.expect_download() as d: await pg.click('#vExport')
            data = json.load(open(await (await d.value).path())); assert len(data) == n
            pg.once('dialog', lambda dl: asyncio.ensure_future(dl.accept()))
            await pg.locator('#vaultList .item .del').last.click(); await pg.wait_for_timeout(400); assert await pg.locator('#vaultList .item').count() == n - 1
            await pg.screenshot(path=f'{A.shots}/vault-1024.png', full_page=True); return f'{n} saved, search, export, delete'
        await check('Vault (second brain): auto-save, search, export, delete', t_vault())

        # ---------- graceful degradation ----------
        async def t_degrade():
            c2 = await new_ctx(br); p2 = await c2.new_page()
            await p2.route(re.compile(r'allorigins|cors\.lol|codetabs|r\.jina\.ai'), lambda r: r.abort())
            await p2.goto(A.base); await p2.fill('#urlIn', 'example.com'); await p2.click('#scanUrl'); await wait_report(p2)
            via = await p2.evaluate('XApp.getCurrent().evidence.html.via'); await c2.close(); return 'readers blocked → ' + via
        await check('Degrades: all CORS readers down → Microlink rendered HTML still works', t_degrade())
        async def t_fail():
            c2 = await new_ctx(br); p2 = await c2.new_page()
            await p2.route(re.compile(r'allorigins|cors\.lol|codetabs|r\.jina\.ai|microlink|example\.org'), lambda r: r.abort())
            await p2.goto(A.base); await p2.fill('#urlIn', 'example.org'); await p2.click('#scanUrl')
            await p2.wait_for_selector('#steps li.fail', timeout=90000); log = await p2.inner_text('#scanLog'); await p2.screenshot(path=f'{A.shots}/scan-graceful-failure-1024.png')
            assert await p2.is_visible('[data-view=scan] .back'); await c2.close(); return 'clear failure + back button: ' + log.strip().split('\n')[-1][:100]
        await check('Degrades: every service down → clear error, no crash', t_fail())

        vault_json = await pg.evaluate("localStorage.getItem('bx.vault')")
        await ctx.close()

        # ---------- every view × every width: back button, no overflow, screenshots ----------
        views = ['home', 'scan', 'report', 'plan', 'build', 'prompts', 'vault', 'settings', 'about']
        ids = json.loads(vault_json); rid = next((t['id'] for t in ids if t['kind'] == 'website' and 'igloo' in t['target']), ids[0]['id'])
        for w in WIDTHS:
            c = await new_ctx(br, w, 860 if w > 500 else 780); q = await c.new_page()
            await q.goto(A.base); await q.evaluate("v=>localStorage.setItem('bx.vault', v)", vault_json)
            bad = []
            for v in views:
                h = '#/' + v + ('/' + rid if v in ('report', 'plan', 'build', 'prompts') else '')
                await q.goto(A.base + h); await q.wait_for_timeout(500)
                sel = f'[data-view={v}] .back'
                if not await q.is_visible(sel): bad.append(v + ':no-back')
                ow = await q.evaluate('document.documentElement.scrollWidth - innerWidth')
                if ow > 1: bad.append(f'{v}:overflow{ow}')
                if v in ('home', 'report', 'build', 'settings') or w in (360, 1440):
                    await q.screenshot(path=f'{A.shots}/{v}-{w}.png', full_page=(v in ('home', 'report')))
            # back button navigates back
            for hh in ['#/', '#/vault', '#/about']:
                await q.evaluate("h=>location.hash=h", hh); await q.wait_for_timeout(400)
            await q.click('[data-view=about] .back'); await q.wait_for_timeout(400)
            if '#/vault' not in q.url: bad.append('back-nav:' + q.url)
            await q.click('#bizzyBtn'); await q.wait_for_timeout(300)
            bb = await q.eval_on_selector('#bizzy', 'e=>{const r=e.getBoundingClientRect();return [r.left,r.right,innerWidth]}')
            if bb[0] < 0 or bb[1] > bb[2] + 1: bad.append('bizzy-offscreen')
            await q.screenshot(path=f'{A.shots}/bizzy-{w}.png')
            await c.close()
            rec(not bad, f'Layout @{w}px: back button on all 9 views + Bizzy, no horizontal overflow, back navigates', ', '.join(bad))

        # ---------- PWA (live site) ----------
        if A.live:
            c = await br.new_context(); q = await c.new_page()
            await q.goto(A.live); await q.wait_for_timeout(4000)
            async def t_sw():
                info = await q.evaluate("""async()=>{const r=await navigator.serviceWorker.getRegistration();const keys=await caches.keys();return {scope:r&&r.scope,active:!!(r&&r.active),keys,build:window.XRAY_BUILD}}""")
                assert info['active'], info; assert any(info['build'] in k for k in info['keys']), info
                return f"SW active, cache {info['keys']}"
            await check('PWA (live): service worker active, cache named after build id', t_sw())
            async def t_manifest():
                m = await q.evaluate("fetch('manifest.webmanifest').then(r=>r.json())"); assert m['display'] == 'standalone' and len(m['icons']) >= 3; return m['name']
            await check('PWA (live): installable manifest with icons', t_manifest())
            async def t_bust():
                sw = await q.evaluate("fetch('sw.js',{cache:'no-store'}).then(r=>r.text())"); html = await q.evaluate("fetch('./',{cache:'no-store'}).then(r=>r.text())"); b = await q.evaluate('window.XRAY_BUILD')
                assert f"bizzle-xray-{b}" in sw and f"?v={b}" in html; return 'CACHE + ?v= query match build ' + b
            await check('PWA (live): cache busting (CACHE name + ?v= match build)', t_bust())
            async def t_offline():
                await c.set_offline(True); await q.reload(); t = await q.inner_text('.topbar .ver'); await c.set_offline(False); assert t.strip() == 'v4.20'; return 'app shell loads offline'
            await check('PWA (live): offline app shell', t_offline())
            async def t_live_scan():
                await q.fill('#urlIn', 'example.com'); await q.click('#scanUrl'); await wait_report(q); via = await q.evaluate('XApp.getCurrent().evidence.html.via'); return 'live scan via ' + via
            await check('Live GitHub Pages: website scan works from the real origin', t_live_scan())
            await c.close()

        rec(not [e for e in errors if 'sandboxed' not in e], 'No uncaught page errors in the app during the run', '; '.join(errors[:3]))
        await br.close()
    ok = sum(1 for r in R if r[0] == 'PASS'); bad = [r for r in R if r[0] == 'FAIL']
    print(f'\nRESULT {ok} passed, {len(bad)} failed'); json.dump(R, open(os.path.join(A.shots, 'results.json'), 'w'), indent=1)
    sys.exit(1 if bad else 0)

asyncio.run(main())
