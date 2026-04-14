# AI Automation Framework

Enterprise-grade test automation built on Playwright with intelligent self-healing, persistent learning, and local AI integration.

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run setup wizard (generates .env, installs browsers)
npx ts-node src/setup.ts

# 3. Run tests
npm test
```

## Test Commands

```bash
npm test                    # all tests
npm run test:smoke          # smoke suite
npm run test:sanity         # sanity suite
npm run test:regression     # regression suite
npm run test:headed         # visible browser
npm run test:debug          # Playwright inspector
npm run test:mobile         # mobile emulation (Pixel 5)
npm run report              # open HTML report
```

---

## Self-Healing

When a locator fails, the framework automatically finds the correct element and remembers the fix for next time:

```typescript
// Your test stays the same — framework handles UI changes automatically
await runSteps(page, [
  { label: "Click Login", action: "click", codegenLocator: "getByRole('button', { name: 'Login' })" }
]);
// If the button changes → framework finds it → stores fix → next run is instant
```

Fixes are stored in `learning-db.json` and reused automatically on every subsequent run.

---

## Writing Tests

```typescript
import { test } from "@playwright/test";
import { runSteps } from "../src";

test("login and navigate", async ({ page }) => {
  await runSteps(page, [
    { label: "Navigate",       action: "navigate",      expectedUrl: process.env.APP_URL },
    { label: "Enter username", action: "fill",          codegenLocator: "getByRole('textbox', { name: 'Username' })", value: process.env.APP_USERNAME },
    { label: "Enter password", action: "fill",          codegenLocator: "getByRole('textbox', { name: 'Password' })", value: process.env.APP_PASSWORD },
    { label: "Click Login",    action: "click",         codegenLocator: "getByRole('button', { name: 'Login' })" },
    { label: "Verify login",   action: "assertVisible", codegenLocator: "getByRole('link', { name: 'Modules' })" },
  ], { name: "Login", suite: "smoke" });
});
```

### Workflow Options

```typescript
await runSteps(page, steps, {
  name:                        "My Workflow",
  suite:                       "regression",    // smoke | sanity | regression | general
  stopOnFailure:               true,            // halt on first hard failure
  screenshotOnFailure:         true,            // auto screenshot on failure
  screenshotEachStep:          false,           // screenshot every step
  waitForStabilityAfterAction: true,            // wait for page stable after clicks
  workflowRetries:             1,              // retry entire workflow on failure
  maxWorkflowMs:               60000,          // hard budget — stops runaway tests
});
```

### Soft Assertions

```typescript
// Soft failures are recorded but workflow continues
{ label: "Check banner", action: "assertVisible", codegenLocator: "...", soft: true }
```

### Parallel Workflows

```typescript
import { runStepsParallel } from "../src";

const [loginResult, setupResult] = await runStepsParallel([
  { page: page1, steps: loginSteps,  options: { name: "Login" } },
  { page: page2, steps: setupSteps,  options: { name: "Setup" } },
]);
```

---

## Mobile Testing

```typescript
import { MobileHelper, MOBILE_DEVICES } from "../src/utils/MobileHelper";

test("mobile login", async ({ page }) => {
  const mobile = new MobileHelper(page);
  await mobile.emulateDevice("iPhone 14");
  await page.goto(process.env.APP_URL!);

  await mobile.swipe("up", 400);
  await mobile.tap("getByRole('button', { name: 'Login' })");
  await mobile.rotateToLandscape();
});
```

Available devices: `Pixel 5`, `Pixel 7`, `iPhone 12`, `iPhone 13`, `iPhone 14`, `iPhone 14 Pro Max`, `iPhone SE`, `iPad Pro 11`, `iPad Mini` + landscape variants.

---

## Debugging — Trace Viewer

```typescript
import { TraceManager } from "../src/utils/TraceManager";

test("debug failing workflow", async ({ page, context }) => {
  const trace = new TraceManager(context);

  await trace.wrap("login-flow", async () => {
    await runSteps(page, steps);
  });
});

// Open the trace:
// npx playwright show-trace test-results/traces/login-flow-<timestamp>.zip
```

---

## Session Management

```typescript
import { StabilityGuard } from "../src/utils/StabilityGuard";

const guard = new StabilityGuard(page, {
  sessionAliveLocator: "getByRole('link', { name: 'Modules' })",
  onSessionExpired: async (page) => {
    const login = new LoginPage(page);
    await login.login();
  }
});

await guard.withSessionRecovery(
  () => navPage.goToModule("Leave"),
  () => navPage.goToModule("Leave")
);
```

---

## Network Interception

```typescript
import { NetworkInterceptor } from "../src/utils/NetworkInterceptor";

const net = new NetworkInterceptor(page);
net.mock("/api/users", { status: 200, body: { users: [] } });
net.block("/analytics");
net.observe("/api/save");
await net.activate();
```

---

## Accessibility

```typescript
import { AccessibilityChecker } from "../src/utils/AccessibilityChecker";

const a11y = new AccessibilityChecker(page);
const result = await a11y.audit();
await a11y.assertNoViolations();
```

---

## Visual Regression

```typescript
import { VisualRegression } from "../src/utils/VisualRegression";

const visual = new VisualRegression(page);
await visual.captureBaseline("login-page");
const result = await visual.compare("login-page");
```

---

## Security

```typescript
import { SecurityEnforcer } from "../src/security/SecurityEnforcer";

// Scan locator for injection risks
const result = SecurityEnforcer.scanLocator(locator);
if (!result.safe) console.warn(result.risks);

// Sanitize before use
const safe = SecurityEnforcer.sanitizeLocator(locator);

// Validate URLs
SecurityEnforcer.validateUrl(url); // only allows http/https
```

---

## Configuration

All settings via environment variables (`.env`):

| Variable | Default | Description |
|---|---|---|
| `BASE_URL` | — | App base URL |
| `APP_USERNAME` | — | Test user login |
| `APP_PASSWORD` | — | Test user password |
| `HEADLESS` | `true` | Run headless |
| `FW_TIMEOUT` | `5000` | Action timeout (ms) |
| `FW_WAIT_TIMEOUT` | `5000` | Element wait timeout (ms) |
| `FW_MAX_RETRIES` | `3` | Retry attempts per action |
| `FW_LEARNING` | `true` | Enable self-healing learning |
| `FW_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `FW_LLM` | `false` | Enable AI recovery (requires Ollama) |
| `FW_LLM_MODEL` | `llama3` | Ollama model name |
| `FW_LLM_TIMEOUT_MS` | `8000` | Max ms to wait for AI response |

---

## Supported Actions

Navigation: `navigate` `reload` `goBack` `goForward` `newTab` `closeTab` `switchTab`

Mouse: `click` `doubleClick` `rightClick` `hover` `dragDrop` `tap`

Keyboard: `fill` `clearInput` `typeSlowly` `keyPress` `focus` `blur` `selectAll`

Forms: `submit` `dropdown` `multiSelect` `check` `uncheck` `upload` `fileDownload`

Assertions: `assertVisible` `assertHidden` `assertText` `assertValue` `assertUrl` `assertTitle` `assertCount` `assertAttribute` `assertChecked` `assertEnabled` `assertDisabled` `assertHasClass` `assertInViewport` `assertEditable` `assertFocused`

Waits: `wait` `waitForUrl` `waitForText` `waitForNetwork` `waitForFunction` `waitForSelector`

Advanced: `iframe` `alert` `screenshot` `scroll` `scrollTo` `evaluate` `dispatchEvent` `clipboardCopy` `clipboardPaste` `geolocation` `emulateMedia`

---

## Adding Custom Actions

```typescript
import { registerAction } from "../src/engine/ActionRouter";

registerAction("selectSelect2", async (page, step) => {
  await page.locator(step.locator!).click();
  await page.locator(".select2-result-label").filter({ hasText: step.value! }).click();
  return true;
});
```

---

## Local AI Setup (Optional)

The framework supports local AI for enhanced recovery. Disabled by default.

```bash
# 1. Install Ollama (free, runs locally)
# https://ollama.com

# 2. Pull a model (one time)
ollama pull llama3

# 3. Enable in .env
FW_LLM=true
FW_LLM_MODEL=llama3
```

All AI calls go to `localhost:11434` only — no external network requests, no data sent outside your machine.

---

## License

MIT
