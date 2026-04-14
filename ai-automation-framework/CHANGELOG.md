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
- `SecurityEnforcer` — locator scanning, sanitization, URL/CSS allowlisting (CWE-95)
- `npm run help` — full CLI reference for all actions, options, troubleshooting
- `npm run setup` — interactive setup wizard generates `.env` and installs browsers
- `CONTRIBUTING.md` — guide for adding actions, reporting bugs, extending the framework
- GitHub Actions CI workflow — runs demo tests on every push

### Improved
- Structured error messages — step failures now show which recovery layer failed and why
- Faster locator strategy resolution with LRU caching
- Parallel batch strategy — races multiple locator strategies simultaneously
- Targeted DOM capture — container-scoped snapshot instead of full page
- Assertion guard — assertions never trigger self-heal (prevents false-positive heals)
- Improved learned locator routing for `getBy*` style locators

### Fixed
- Learned locators with `getBy*` prefix were incorrectly passed to `page.locator()`
- Self-heal running on assertion steps targeting intentionally non-existent elements
- `tracing.start` conflict when `playwright.config.ts` already enables tracing
- Conflicting learning-db entries now resolved by count + timestamp
- Path traversal protection in screenshot paths (CWE-22)

---

## [2.0.0] — Initial Release

### Core
- Multi-layer recovery engine
- Learning DB with in-memory cache and 30-day TTL
- Self-healing with assertion guard
- WorkflowRunner with soft assertions, retries, budget timeout
- Parallel workflow execution

### Engine
- ActionRouter with 40+ action types
- LocatorEngine with multiple strategy variants
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
