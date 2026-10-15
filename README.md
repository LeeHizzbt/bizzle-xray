# Bizzle X-Ray <sub>v4.20</sub>

**Give your AI x-ray vision.** Bizzle X-Ray is a free PWA and Android app that reverse engineers a website, a screenshot or an app package, then writes an evidence-backed teardown: the stack with versions, the design system, page structure, features, APIs and what it loads. It can also produce a step-by-step rebuild plan, build an **original** clone that it tests in a hidden sandbox before launch, and give you copyable prompts for other AI builders.

Live: https://leehizzbt.github.io/bizzle-xray/

Inspired by the REA (Reverse Engineer Anything, MIT) workflow shown in *"I Gave My AI Assistant the Power to Reverse Engineer ANYTHING!"*. This is an independent, free, browser-only take on the same idea.


## Features
- **Website teardown.** The site is opened through free CORS readers (direct → AllOrigins → cors.lol → CodeTabs), with Microlink rendered HTML, tech insights and a screenshot raced in parallel. It reads the DOM, styles and scripts, follows lazy JS chunks, matches ~110 stack fingerprints (with versions where visible), extracts the design system and palette, and lists everything it loads. Reports use the REA layout: verdict, the answer, the stack, how it works, what it loads, rebuild it, what the evidence can't show, evidence.
- **Screenshot teardown.** Upload or paste an image. The AI vision model describes the layout, components and stack guesses, and the app measures the palette.
- **App / package teardown.** All parsing is static and in the browser: APK, IPA, zipped macOS `.app` and Electron `.asar` (manifest/Info.plist, frameworks, native libs, endpoints).
- **Paste code teardown.**
- **Rebuild plan, Build my version (SCAFFOLD → CODE → TEST → LAUNCH).** The build is an original single-file clone, tested in a hidden sandboxed browser with an error probe, auto-fixed once, then previewed at device widths. You can view its code, iterate with change requests, download the .html, or open it in its own window.
- **Prompt pack.** Copyable prompts for other AI builders.
- **Read it to me.** Speech synthesis of the teardown. There is also a voice/text command bar ("reverse engineer stripe.com").
- **Vault (second brain).** Every teardown is auto-saved locally, with search, export (Obsidian-ready .md) and delete.
- **Bizzy Bot.** A pop-up chat bubble with persistent memory ("remember …"), screenshot upload, and a copy button on every reply.
- **Advanced AI Settings.** Bring your own key for Gemini (default), Groq or OpenRouter. It has a model tier/list with fallback, extra instructions and a test-key button.
- **7 AI color themes** (neon, violet, ice, ember, matrix, rose, daylight). Every view has a themed back button; Android's hardware back key works too.
- **PWA.** Installable, works offline (app shell), and the service worker cache is named after the build id with `?v=` cache busting (`scripts/bump-version.sh`).

## Privacy
Keys are stored only in your browser's localStorage and are sent only to the provider you picked. The repo has no backend and no keys. Pages you scan go through the third-party free readers listed above, so don't scan private or authenticated URLs. Without a key everything still works with the local evidence engine; the AI only writes the prose.

## Limits
- Free readers and Microlink are flaky and rate-limited (Microlink is ~50 requests/day/IP; results are cached for 24 h). When the readers are down, Microlink's rendered HTML can lack inline CSS, so the design colors and fonts may be empty; the screenshot palette is still used.
- It only sees what a public, anonymous browser downloads. Server-side code, databases and logged-in areas are invisible.
- Native apps are analysed statically (no decompiling or running).
- On Android, downloads go through the share sheet.
- AI output varies by model.

## Legal
Bizzle X-Ray is for learning and inspiration. Respect the sites' terms and robots rules. Do not copy trademarks, logos, copyrighted text, images or code into what you build; the build step is told to make original work. Teardowns describe public evidence only.

## Build & test
```bash
# web: static, served from docs/ (GitHub Pages: main /docs)
python3 -m http.server -d docs 8080
scripts/bump-version.sh            # new build id → SW cache + ?v= busting
# Android (Capacitor 7)
npm install && npx cap sync android
cd android && ./gradlew assembleRelease   # signing reads ../keystore/keystore.properties (gitignored)
# end-to-end tests (Playwright + Chrome; a GEMINI key env var enables the real-AI tests)
python3 tests/e2e.py --base http://localhost:8080 --live https://leehizzbt.github.io/bizzle-xray/
```
Android APK releases are published to the private repo `LeeHizzbt/kief-releases` (tag `xray-v4.20`).

MIT licensed, see LICENSE. JSZip is bundled under its MIT license (see `docs/vendor/JSZIP-LICENSE.md`).
