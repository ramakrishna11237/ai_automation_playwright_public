# Contributing to AI Automation Framework

## Reporting a Bug

When a test fails unexpectedly, include:

1. The full error message (copy from terminal — it now shows which layer failed and why)
2. The step definition that failed
3. `FW_LOG_LEVEL=debug` output
4. The Playwright trace if available (`npx playwright show-trace <path>`)

**Good bug report:**
```
Step "Click Save button" failed [action: click]
Locator: getByRole('button', { name: 'Save' })
Layer 1 (direct): locator not found
Layer 2 (strategy): all 15 strategies tried — none matched
Layer 3 (learned): no entry in learning-db
Layer 4 (self-heal): exhausted all DOM-aware candidates

App version: 2.5.1
Browser: Chromium 120
```

---

## Adding a New Action Type

1. Add the action name to `ActionType` union in `src/types.ts`
2. Add a `case` handler in `src/engine/ActionRouter.ts`
3. If it's an assertion, add it to `ASSERT_ACTIONS` in `src/core/Runner.ts`
4. Add pattern detection in `src/engine/PatternEngine.ts` (optional)

**Example — adding `selectSelect2`:**

```typescript
// src/types.ts
export type ActionType = ... | 'selectSelect2';

// src/engine/ActionRouter.ts
case "selectSelect2": {
  const el = getElement(page, step);
  if (!el) return false;
  await el.first().click();
  await page.locator(".select2-result-label")
    .filter({ hasText: step.value ?? "" })
    .first().click();
  Logger.info(`Select2 selected: ${step.value}`);
  return true;
}
```

Or use the plugin system without touching framework source:
```typescript
import { registerAction } from "../src/engine/ActionRouter";
registerAction("selectSelect2", async (page, step) => { ... });
```

---

## Adding a New Utility

Create `src/utils/MyHelper.ts`, export from `src/index.ts`:

```typescript
// src/index.ts
export { MyHelper } from "./utils/MyHelper";
```

---

## Modifying Self-Heal Behavior

- **Block a locator pattern from healing**: add to `ACTION_ELEMENT_PATTERNS` in `src/healing/SelfHeal.ts`
- **Add a new assertion to the guard**: add to `ASSERT_ACTIONS` in `src/core/Runner.ts`
- **Change heal candidate priority**: modify `buildHealCandidates()` in `src/healing/SelfHeal.ts`

---

## Learning DB

`learning-db.json` is auto-managed. Rules:
- Never edit it manually during a test run
- Delete individual entries if a wrong heal was stored
- Run `npm run clean` to reset it completely
- Entries expire after 30 days automatically
- Max 500 entries — oldest/least-used pruned automatically

---

## Code Style

- TypeScript strict mode — no `any` without a comment explaining why
- No external dependencies unless absolutely necessary (currently only 4 runtime deps)
- Every public function needs a JSDoc comment
- Error messages must be actionable — tell the user what to do, not just what failed

---

## Running Tests Locally

```bash
npm run setup          # first time only
npm test               # all tests
npm run test:demo      # framework feature demo (no credentials needed)
npm run test:headed    # watch the browser
FW_LOG_LEVEL=debug npm run test:smoke   # full debug trace
```

---

## Environment for Development

```bash
# .env for local development
FW_LOG_LEVEL=debug
HEADLESS=false
FW_DEBUG=true
FW_STRATEGY_TIMEOUT=2000   # slower strategies for debugging
```
