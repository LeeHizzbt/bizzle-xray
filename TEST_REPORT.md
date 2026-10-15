# Bizzle X-Ray v4.20: test report (2026-10-15)

## Web / PWA: 43 passed, 0 failed
These are Playwright runs (Chrome) against a local server plus the live GitHub Pages site, at widths 360/390/768/1024/1440, with real Gemini calls. Screenshots are in `test-shots/` in the build workspace.

| Result | Test | Detail |
|---|---|---|
| PASS | Branding: neon green v4.20 badge, Advanced AI Settings button, Bizzy bubble | neon rgb(57, 255, 20) |
| PASS | Security: no API keys in shipped code | no API keys in shipped code |
| PASS | Website teardown with NO key (local evidence engine, example.com) | all 11 sections + copy button |
| PASS | Copy button on teardown copies full markdown | 2945 chars copied |
| PASS | Download teardown as .md (Obsidian-ready front matter) | example-domain-teardown.md |
| PASS | Website teardown WITH Gemini (igloo.inc): stack/versions/chunk graph | AI; stack=19 incl. Three.js/GSAP/Svelte; fetched 2 bundles, max 1451 KB |
| PASS | Design system + evidence list extracted (colors, fonts, palette, >=8 evidence) | 0 colors, 0 fonts, 10 palette, 27 evidence items |
| PASS | Screenshot of target loads (Microlink / thum.io) | screenshot 2560px wide |
| PASS | Read it to me (speech synthesis of the teardown) | 117 utterances queued |
| PASS | Rebuild plan (local + AI) with copy and back button | AI plan 6865 chars |
| PASS | Build: instant starter (no AI) → SCAFFOLD/CODE/TEST/LAUNCH, sandboxed preview | Passed the hidden-browser test ✓ |
| PASS | Build with Gemini → hidden-browser test (auto-fix) → preview | AI build in 17s, 37 elements; Passed the hidden-browser test ✓ |
| PASS | Build: apply a change request (iterate with AI) | change applied |
| PASS | Build preview: device widths + code view with copy | preview widths + code tab |
| PASS | Download generated clone as .html | igloo-inc-rebuild.html |
| PASS | Open as its own window (sandboxed launch.html with back button) | launch.html window with 39 elements |
| PASS | Copyable prompt pack (each prompt has a copy button) | 6 prompts, all with copy |
| PASS | Screenshot upload → AI vision teardown + measured palette | AI vision 10024 chars |
| PASS | App package: zipped macOS .app (Info.plist, Mach-O, extensions, frameworks) | DemoNotes.app.zip |
| PASS | App package: Electron ASAR (file table, package.json, IPC/endpoint) | demo.asar |
| PASS | Paste code teardown (stack, endpoints, design tokens) | GSAP + endpoint + color found |
| PASS | Command bar: “reverse engineer example.com” | voice/text command started a scan |
| PASS | Advanced AI Settings: per-provider keys (localStorage), tier, extra instructions | keys saved/cleared in localStorage only; settings persisted |
| PASS | Test key button (real Gemini call) | ✓ gemini · gemini-3.5-flash-lite replied: X-RAY ONLINE |
| PASS | Live model list from provider | 28 live models |
| PASS | AI color themes (7) + theme cycle | 7 AI color themes + cycle button |
| PASS | Bizzy Bot bubble with persistent memory (+AI recall) | memory persisted across reload and used by AI |
| PASS | Bizzy: screenshot upload for AI help + copy on reply | It is a three-column notes and document-editing application featuring markdown shortcuts,  |
| PASS | Bizzy back button | back closes bubble |
| PASS | Vault (second brain): auto-save, search, export, delete | 7 saved, search, export, delete |
| PASS | Degrades: all CORS readers down → Microlink rendered HTML still works | readers blocked → Microlink (rendered) |
| PASS | Degrades: every service down → clear error, no crash | clear failure + back button: ✕ Could not read example.org through any free reader. All free readers failed: Di |
| PASS | Layout @360px: back button on all 9 views + Bizzy, no horizontal overflow, back navigates |  |
| PASS | Layout @390px: back button on all 9 views + Bizzy, no horizontal overflow, back navigates |  |
| PASS | Layout @768px: back button on all 9 views + Bizzy, no horizontal overflow, back navigates |  |
| PASS | Layout @1024px: back button on all 9 views + Bizzy, no horizontal overflow, back navigates |  |
| PASS | Layout @1440px: back button on all 9 views + Bizzy, no horizontal overflow, back navigates |  |
| PASS | PWA (live): service worker active, cache named after build id | SW active, cache ['bizzle-xray-2026-10-15.2'] |
| PASS | PWA (live): installable manifest with icons | Bizzle X-Ray v4.20 |
| PASS | PWA (live): cache busting (CACHE name + ?v= match build) | CACHE + ?v= query match build 2026-10-15.2 |
| PASS | PWA (live): offline app shell | app shell loads offline |
| PASS | Live GitHub Pages: website scan works from the real origin | live scan via AllOrigins JSON |
| PASS | No uncaught page errors in the app during the run |  |

## Android APK (emulator kief30, API 30, x86_64, software rendering): 7 passed, 0 failed
| Result | Test | Detail |
|---|---|---|
| PASS | Signed release APK | apksigner verify OK; cert CN=Bizzle X-Ray, O=Nunya Bizz; 3,710,700 bytes |
| PASS | Install + launch | `adb install -r` Success; MainActivity shows the neon v4.20 home |
| PASS | Website scan inside WebView | example.com teardown completed (Microlink + local engine) |
| PASS | Hardware back key | returns to previous view, app stays open |
| PASS | Bizzy bubble opens in APK | back button, copy button, attach button visible |
| PASS | No crashes | no FATAL/uncaught errors in logcat |
| PASS | Package teardown of the release APK (skill script) | Capacitor/Cordova/Kotlin, 464 files |

The release APK's SHA-256 is `6e4cd4706806e43fdfbac2a311da329938e80d5d8e17ba0021f8d74f0fb42287`.

Not covered: real iOS/IPA files (only parser logic is tested), Groq/OpenRouter live calls (Gemini only), the in-browser APK teardown with this exact APK, and long-term free-service availability.
