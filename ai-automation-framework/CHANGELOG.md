# Changelog

All notable changes to this framework are documented here.

---

## [2.1.0] — 2024

### Added
- `assertPattern` action — regex validation on any element text or input value
- `assertPdf` action — download and verify PDF content without external tools
- `PdfVerifier` utility — full PDF text extraction, pattern matching, page count assertions
- `DebugMode` utility — visual element highlighting when `FW_DEBUG=true`
- `TraceManager` utility — auto-save Playwright traces on failure, discard on pass
- `MobileHelper` utility — device emulation, touch gestures, orientation, viewport
- `runStepsParallel` — run independent workflows concurrently on separate pages
- `npm run help` — full CLI reference for all actions, options, troubleshooting
- `npm run setup` — interactive setup wizard generates `.env` and installs browsers
- `CONTRIBUTING.md` — guide for adding actions, reporting bugs, extending the framework
- GitHub Actions CI workflow — runs demo tests on every push

### Improved
- **Structured error messages** — step failures now show which layer failed and why, with actionable debug tips
- **Layer result tracking** — every recovery attempt recorded and shown on failure
- **Logger performance** — integer comparison instead of `indexOf` twice per call (3.1x faster)
- **Strategy cache** — `getLocatorStrategies` cached by locator key (7.4x faster on repeated steps)
- **DB write throttle** — `updateFix` writes every 10 runs instead of every run (90% fewer disk writes)
- **Targeted DOM capture** — container-scoped aria snapshot (~20ms) instead of full page (~150ms)
- **Parallel batch strategy** — Layer 2 races 3 strategies simultaneously instead of sequentially
- **networkidle opt-in** — no longer blocks every post-action wait (was wasting 5s per navigation)
- **Lazy describeStep** — step descriptions only computed when accessed, not on every step
- **PageHelper split** — lean core (195 lines) + PageHelperExtras for heavy helpers
- **FixApplier cache** — uses LearningStore in-memory cache, zero disk reads on Layer 3
- **Assertion guard** — assertions never trigger self-heal (prevents wrong heals like assertVisible → Save button)
- **getBy* routing fix** — learned locators starting with `getBy` correctly routed to `codegenLocator`
- **Duplicate code removed** — `extractNameFromCodegen` unified in LocatorEngine, removed from SelfHeal

### Fixed
- Layer 3 learned locators with `getBy*` prefix were passed to `page.locator()` — always failed
- Self-heal running on assertion steps that intentionally target non-existent elements
- `tracing.start` conflict when `playwright.config.ts` already enables tracing
- `waitForHidden` used as action type — replaced with `waitForSelector` + `waitForState: hidden`
- Conflicting learning-db entries now resolved by count + timestamp (most recent wins)
- Path traversal protection in screenshot paths (CWE-22)

---

## [2.0.0] — Initial Release

### Core
- 4-layer recovery engine (direct → strategy → learned → self-heal)
- Learning DB with in-memory cache and 30-day TTL
- Self-healing with assertion guard (blocks healing to interactive elements)
- WorkflowRunner with soft assertions, retries, budget timeout
- Parallel workflow execution

### Engine
- ActionRouter with 40+ action types
- LocatorEngine with 15 strategy variants
- PatternEngine for label-based action detection
- RetryEngine with exponential backoff and jitter
- SmartWait with opt-in networkidle

### Utils
- AccessibilityChecker (no axe-core dependency)
- NetworkInterceptor (mock, block, observe)
- VisualRegression (pixel comparison)
- StabilityGuard (session recovery)
- ErrorLogger (HTTP 4xx/5xx capture)
- ApiClient (lightweight HTTP client)
- SessionManager (cookie/localStorage management)
- TestDataManager (test data lifecycle)
- ShadowDOMHelper
- DashboardReporter
