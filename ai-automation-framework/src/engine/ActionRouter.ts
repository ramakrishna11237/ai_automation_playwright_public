import * as fs from "fs";
import * as path from "path";
import { Page, Locator } from "@playwright/test";
import { Step, ActionType } from "../types";
import { Logger } from "../utils/Logger";
import { DEFAULT_CONFIG } from "../config";
import { handleExtendedAction } from "./ActionRouterExtensions";
import { handleExtendedAction2 } from "./ActionRouterExtensions2";

// ── Locator resolution ────────────────────────────────────────────────────────

/**
 * Exported so SmartWait, SelfHeal and other modules can resolve Codegen strings.
 * Converts strings like getByRole('button', { name: 'Login' }) into real Locators.
 */
export function resolveLocatorToPlaywright(page: Page, locatorStr: string): Locator | null {
  return resolvePlaywrightLocator(page, locatorStr);
}

function resolvePlaywrightLocator(page: Page, locatorStr: string): Locator | null {
  if (!locatorStr) return null;

  try {
    const roleMatch = locatorStr.match(/^getByRole\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (roleMatch) {
      const role = roleMatch[1] as Parameters<Page["getByRole"]>[0];
      const opts = parseOptions(roleMatch[2] ?? "{}");
      let locator = page.getByRole(role, opts);
      const chained = extractChainedLocator(locatorStr);
      if (chained) locator = locator.locator(chained);
      return locator;
    }

    const labelMatch = locatorStr.match(/^getByLabel\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (labelMatch) return page.getByLabel(labelMatch[1], parseOptions(labelMatch[2] ?? "{}"));

    const textMatch = locatorStr.match(/^getByText\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (textMatch) return page.getByText(textMatch[1], parseOptions(textMatch[2] ?? "{}"));

    const testIdMatch = locatorStr.match(/^getByTestId\(\s*['"]([^'"]+)['"]\s*\)/);
    if (testIdMatch) return page.getByTestId(testIdMatch[1]);

    const placeholderMatch = locatorStr.match(/^getByPlaceholder\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (placeholderMatch) return page.getByPlaceholder(placeholderMatch[1], parseOptions(placeholderMatch[2] ?? "{}"));

    const altMatch = locatorStr.match(/^getByAltText\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (altMatch) return page.getByAltText(altMatch[1], parseOptions(altMatch[2] ?? "{}"));

    const titleMatch = locatorStr.match(/^getByTitle\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (titleMatch) return page.getByTitle(titleMatch[1], parseOptions(titleMatch[2] ?? "{}"));

    // Not a Codegen method string — treat as CSS/XPath
    return page.locator(locatorStr);

  } catch (e) {
    Logger.debug(`resolvePlaywrightLocator failed for "${locatorStr}": ${String(e)}`);
    try { return page.locator(locatorStr); } catch { return null; }
  }
}

/**
 * Parse a Playwright options object string into a plain JS object.
 *
 * Uses targeted regex extraction — no JSON.parse — so apostrophes in values
 * like { name: "O'Brien" } or { name: 'Don\'t click' } are handled correctly.
 */
function parseOptions(optStr: string): Record<string, unknown> {
  if (!optStr || optStr === "{}") return {};

  const result: Record<string, unknown> = {};

  const nameSingle = optStr.match(/name\s*:\s*'((?:[^'\\]|\\.)*)'/);
  const nameDouble = optStr.match(/name\s*:\s*"((?:[^"\\]|\\.)*)"/);
  const nameRegex  = optStr.match(/name\s*:\s*\/([^/]+)\/([gimsuy]*)/);

  if (nameSingle)      result["name"] = nameSingle[1];
  else if (nameDouble) result["name"] = nameDouble[1];
  else if (nameRegex)  result["name"] = new RegExp(nameRegex[1], nameRegex[2]);

  // All supported Playwright role options
  const exact        = optStr.match(/exact\s*:\s*(true|false)/);
  const checked      = optStr.match(/checked\s*:\s*(true|false)/);
  const disabled     = optStr.match(/disabled\s*:\s*(true|false)/);
  const expanded     = optStr.match(/expanded\s*:\s*(true|false)/);
  const pressed      = optStr.match(/pressed\s*:\s*(true|false)/);
  const selected     = optStr.match(/selected\s*:\s*(true|false)/);
  const includeHidden = optStr.match(/includeHidden\s*:\s*(true|false)/);
  const level        = optStr.match(/level\s*:\s*(\d+)/);

  if (exact)         result["exact"]         = exact[1]         === "true";
  if (checked)       result["checked"]       = checked[1]       === "true";
  if (disabled)      result["disabled"]      = disabled[1]      === "true";
  if (expanded)      result["expanded"]      = expanded[1]      === "true";
  if (pressed)       result["pressed"]       = pressed[1]       === "true";
  if (selected)      result["selected"]      = selected[1]      === "true";
  if (includeHidden) result["includeHidden"] = includeHidden[1] === "true";
  if (level)         result["level"]         = parseInt(level[1], 10);

  return result;
}

/**
 * Extract a chained .locator('...') from a Codegen string.
 * Handles single-quoted outer strings containing double quotes and vice versa.
 * e.g. getByRole('row', { name: 'foo' }).locator('input[type="image"]') → input[type="image"]
 */
function extractChainedLocator(locatorStr: string): string | null {
  const single = locatorStr.match(/\.locator\('([^']+)'\)/);
  if (single) return single[1];
  const double = locatorStr.match(/\.locator\("([^"]+)"\)/);
  if (double) return double[1];
  return null;
}

function getElement(page: Page, step: Step): Locator | null {
  const loc = step.codegenLocator || step.locator || "";
  if (!loc) { Logger.debug(`getElement: no locator on step "${step.label}"`); return null; }

  if (step.scope) {
    // Scope restricts matching to a specific container.
    // For Codegen strings: resolve natively against the container using
    // Playwright's built-in scoped methods (getByRole, getByText etc.)
    // For CSS/XPath: pass directly to container.locator()
    const container = page.locator(step.scope);
    return resolvePlaywrightLocatorScoped(container, loc);
  }

  return resolvePlaywrightLocator(page, loc);
}

/**
 * Resolve a locator string against a scoped container (Locator, not Page).
 * Mirrors resolvePlaywrightLocator but uses container methods so results
 * are restricted to descendants of the container element.
 */
function resolvePlaywrightLocatorScoped(container: Locator, locatorStr: string): Locator {
  try {
    const roleMatch = locatorStr.match(/^getByRole\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (roleMatch) {
      const role = roleMatch[1] as Parameters<Locator["getByRole"]>[0];
      const opts = parseOptions(roleMatch[2] ?? "{}");
      let loc = container.getByRole(role, opts);
      const chained = extractChainedLocator(locatorStr);
      if (chained) loc = loc.locator(chained);
      return loc;
    }

    const labelMatch = locatorStr.match(/^getByLabel\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (labelMatch) return container.getByLabel(labelMatch[1], parseOptions(labelMatch[2] ?? "{}"));

    const textMatch = locatorStr.match(/^getByText\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (textMatch) return container.getByText(textMatch[1], parseOptions(textMatch[2] ?? "{}"));

    const testIdMatch = locatorStr.match(/^getByTestId\(\s*['"]([^'"]+)['"]\s*\)/);
    if (testIdMatch) return container.getByTestId(testIdMatch[1]);

    const placeholderMatch = locatorStr.match(/^getByPlaceholder\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (placeholderMatch) return container.getByPlaceholder(placeholderMatch[1], parseOptions(placeholderMatch[2] ?? "{}"));

    const altMatch = locatorStr.match(/^getByAltText\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (altMatch) return container.getByAltText(altMatch[1], parseOptions(altMatch[2] ?? "{}"));

    const titleMatch = locatorStr.match(/^getByTitle\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
    if (titleMatch) return container.getByTitle(titleMatch[1], parseOptions(titleMatch[2] ?? "{}"));

    // Plain CSS/XPath — pass directly to container.locator()
    return container.locator(locatorStr);
  } catch {
    return container.locator(locatorStr);
  }
}

function resolveLocatorStr(step: Step): string {
  return step.codegenLocator || step.locator || "";
}

// ── Plugin registry ───────────────────────────────────────────────────────────
// Allows teams to register custom action types without modifying framework source.
//
// Usage:
//   import { registerAction } from "../engine/ActionRouter";
//   registerAction("selectSelect2", async (page, step) => {
//     await page.locator(step.locator!).click();
//     await page.locator(".select2-result-label").first().click();
//     return true;
//   });

type PluginHandler = (page: Page, step: Step) => Promise<boolean>;
const pluginRegistry = new Map<string, PluginHandler>();

/** Register a custom action type. Overwrites any existing handler for the same name. */
export function registerAction(name: string, handler: PluginHandler): void {
  pluginRegistry.set(name, handler);
  Logger.debug(`Plugin registered: action "${name}"`);
}

/** Remove a previously registered custom action. */
export function unregisterAction(name: string): void {
  pluginRegistry.delete(name);
  Logger.debug(`Plugin unregistered: action "${name}"`);
}

/** List all registered custom action names. */
export function listPlugins(): string[] {
  return [...pluginRegistry.keys()];
}

// ── Action router ─────────────────────────────────────────────────────────────

export async function routeAction(page: Page, action: ActionType, step: Step): Promise<boolean> {
  try {
    switch (action) {

      // ── Navigation ──────────────────────────────────────────────────────────

      case "navigate": {
        if (!step.expectedUrl) { Logger.warn("navigate: no expectedUrl"); return false; }
        await page.goto(step.expectedUrl, { timeout: step.timeout || 30000 });
        Logger.info(`Navigated to: ${step.expectedUrl}`);
        return true;
      }

      case "reload": {
        await page.reload({ timeout: step.timeout || 30000 });
        Logger.info("Page reloaded");
        return true;
      }

      case "goBack": {
        await page.goBack({ timeout: step.timeout || 10000 });
        Logger.info("Navigated back");
        return true;
      }

      case "goForward": {
        await page.goForward({ timeout: step.timeout || 10000 });
        Logger.info("Navigated forward");
        return true;
      }

      case "newTab": {
        const newPage = await page.context().newPage();
        if (step.expectedUrl) await newPage.goto(step.expectedUrl);
        Logger.info(`New tab opened${step.expectedUrl ? `: ${step.expectedUrl}` : ""}`);
        return true;
      }

      case "closeTab": {
        await page.close();
        Logger.info("Tab closed");
        return true;
      }

      case "switchTab": {
        const pages = page.context().pages();
        const idx = step.tabIndex ?? 0;
        if (pages[idx]) { await pages[idx].bringToFront(); Logger.info(`Switched to tab ${idx}`); return true; }
        Logger.warn(`Tab index ${idx} not found (total: ${pages.length})`);
        return false;
      }

      // ── Mouse ────────────────────────────────────────────────────────────────

      case "click": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().click({ timeout: step.timeout || DEFAULT_CONFIG.timeout });
        Logger.info(`Clicked: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "doubleClick": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().dblclick({ timeout: step.timeout || DEFAULT_CONFIG.timeout });
        Logger.info(`Double-clicked: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "rightClick": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().click({ button: "right", timeout: step.timeout || DEFAULT_CONFIG.timeout });
        Logger.info(`Right-clicked: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "hover": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().hover({ timeout: step.timeout || DEFAULT_CONFIG.timeout });
        Logger.info(`Hovered: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "dragDrop": {
        const source = getElement(page, step);
        if (!source || !step.dragTo) { Logger.warn("dragDrop: missing source or dragTo"); return false; }
        const target = resolvePlaywrightLocator(page, step.dragTo);
        if (!target) return false;
        await source.first().dragTo(target.first());
        Logger.info(`Dragged ${resolveLocatorStr(step)} → ${step.dragTo}`);
        return true;
      }

      // ── Keyboard / Input ─────────────────────────────────────────────────────

      case "fill": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().fill(step.value ?? step.text ?? "");
        Logger.info(`Filled: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "clearInput": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().clear();
        Logger.info(`Cleared: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "typeSlowly": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().pressSequentially(step.value ?? step.text ?? "", {
          delay: step.delay ?? DEFAULT_CONFIG.slowTypeDelay
        });
        Logger.info(`Typed slowly into: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "keyPress": {
        const key = step.key || "Enter";
        const el = getElement(page, step);
        if (el) await el.first().press(key);
        else await page.keyboard.press(key);
        Logger.info(`Key pressed: ${key}`);
        return true;
      }

      case "focus": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().focus();
        Logger.info(`Focused: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "blur": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().blur();
        Logger.info(`Blurred: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "selectAll": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().selectText();
        Logger.info(`Selected all text in: ${resolveLocatorStr(step)}`);
        return true;
      }

      // ── Forms ────────────────────────────────────────────────────────────────

      case "submit": {
        const loc = resolveLocatorStr(step);
        const btn = loc
          ? resolvePlaywrightLocator(page, loc) ?? page.locator(loc)
          : page.getByRole("button", { name: /submit|save|send|confirm/i });
        if ((await btn.count()) === 0) { Logger.warn("submit: no button found"); return false; }
        await btn.first().click();
        Logger.info("Form submitted");
        return true;
      }

      case "dropdown": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().selectOption(step.value ?? step.options?.[0] ?? "");
        Logger.info(`Dropdown selected: ${step.value ?? step.options?.[0]}`);
        return true;
      }

      case "multiSelect": {
        const el = getElement(page, step);
        if (!el) return false;
        const vals = step.values ?? step.options ?? [];
        if (vals.length === 0) { Logger.warn("multiSelect: no values provided"); return false; }
        await el.first().selectOption(vals);
        Logger.info(`Multi-select: [${vals.join(", ")}]`);
        return true;
      }

      case "check": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().check();
        Logger.info(`Checked: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "uncheck": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().uncheck();
        Logger.info(`Unchecked: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "upload": {
        const loc = resolveLocatorStr(step) || 'input[type="file"]';
        const input = resolvePlaywrightLocator(page, loc) ?? page.locator(loc);
        if ((await input.count()) === 0) { Logger.warn("upload: file input not found"); return false; }
        const filePath = step.filePath ?? step.value ?? "";
        if (!filePath) { Logger.warn("upload: no filePath provided"); return false; }
        await input.setInputFiles(filePath);
        Logger.info(`File uploaded: ${filePath}`);
        return true;
      }

      case "fileDownload": {
        const el = getElement(page, step);
        if (!el) return false;
        const [download] = await Promise.all([
          page.waitForEvent("download"),
          el.first().click()
        ]);
        const savePath = step.filePath ?? path.join(DEFAULT_CONFIG.downloadDir, download.suggestedFilename());
        fs.mkdirSync(path.dirname(savePath), { recursive: true });
        await download.saveAs(savePath);
        Logger.info(`File downloaded: ${savePath}`);
        return true;
      }

      // ── Auth ─────────────────────────────────────────────────────────────────

      case "login": {
        const userLoc = resolveLocatorStr(step);
        const userField = userLoc
          ? resolvePlaywrightLocator(page, userLoc) ?? page.locator(userLoc)
          : page.getByRole("textbox", { name: /username|email|user/i }).first();
        const passField = page.locator('input[type="password"]');
        const loginBtn  = page.getByRole("button", { name: /log\s?in|sign\s?in|submit/i });
        if ((await loginBtn.count()) === 0) { Logger.warn("login: no login button found"); return false; }
        if ((await userField.count()) > 0) await userField.fill(step.username ?? "");
        if ((await passField.count()) > 0) await passField.fill(step.password ?? "");
        await loginBtn.first().click();
        Logger.info("Login executed");
        return true;
      }

      case "logout": {
        const loc = resolveLocatorStr(step);
        const btn = loc
          ? resolvePlaywrightLocator(page, loc) ?? page.locator(loc)
          : page.getByRole("button", { name: /log\s?out|sign\s?out/i });
        if ((await btn.count()) === 0) { Logger.warn("logout: no logout button found"); return false; }
        await btn.first().click();
        Logger.info("Logout executed");
        return true;
      }

      // ── Search ───────────────────────────────────────────────────────────────

      case "search": {
        const loc = resolveLocatorStr(step);
        const field = loc
          ? resolvePlaywrightLocator(page, loc) ?? page.locator(loc)
          : page.getByRole("searchbox").or(
              page.locator('input[type="search"], input[placeholder*="search" i]')
            ).first();
        if ((await field.count()) === 0) { Logger.warn("search: no search field found"); return false; }
        await field.fill(step.text ?? step.value ?? "");
        await field.press("Enter");
        Logger.info(`Searched: "${step.text ?? step.value}"`);
        return true;
      }

      // ── Assertions ───────────────────────────────────────────────────────────

      case "validation": {
        const el = getElement(page, step);
        if (!el) return false;
        const text = await el.first().textContent();
        const result = (text ?? "").includes(step.expectedText ?? "");
        Logger.info(`Validation "${step.expectedText}": ${result}`);
        return result;
      }

      case "assertUrl": {
        const current = page.url();
        const result = current.includes(step.expectedUrl ?? "");
        Logger.info(`Assert URL "${step.expectedUrl}": ${result} (actual: ${current})`);
        return result;
      }

      case "assertTitle": {
        const title = await page.title();
        const result = title.includes(step.expectedTitle ?? "");
        Logger.info(`Assert title "${step.expectedTitle}": ${result} (actual: ${title})`);
        return result;
      }

      case "assertVisible": {
        const el = getElement(page, step);
        if (!el) return false;
        // waitFor instead of isVisible — handles post-navigation pages still loading
        try {
          await el.first().waitFor({ state: "visible", timeout: step.timeout ?? DEFAULT_CONFIG.waitTimeout });
          Logger.info(`Assert visible "${resolveLocatorStr(step)}": true`);
          return true;
        } catch {
          Logger.info(`Assert visible "${resolveLocatorStr(step)}": false (timeout)`);
          return false;
        }
      }

      case "assertHidden": {
        const loc = resolveLocatorStr(step);
        if (!loc) return true;
        const el = resolvePlaywrightLocator(page, loc);
        if (!el) return true;
        const count = await el.count();
        if (count === 0) { Logger.info(`Assert hidden "${loc}": true (not in DOM)`); return true; }
        const hidden = !(await el.first().isVisible());
        Logger.info(`Assert hidden "${loc}": ${hidden}`);
        return hidden;
      }

      case "assertCount": {
        const el = getElement(page, step);
        if (!el) return false;
        const count = await el.count();
        const result = count === (step.expectedCount ?? 0);
        Logger.info(`Assert count ${step.expectedCount}: actual=${count}, match=${result}`);
        return result;
      }

      case "assertAttribute": {
        const el = getElement(page, step);
        if (!el || !step.attributeName) { Logger.warn("assertAttribute: missing locator or attributeName"); return false; }
        const val = await el.first().getAttribute(step.attributeName);
        const result = (val ?? "").includes(step.expectedAttribute ?? "");
        Logger.info(`Assert [${step.attributeName}] contains "${step.expectedAttribute}": ${result}`);
        return result;
      }

      // ── Rich assertions (Playwright/Cypress parity) ───────────────────────

      case "assertText": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          await el.first().waitFor({ state: "visible", timeout: step.timeout ?? DEFAULT_CONFIG.waitTimeout });
          const text = (await el.first().textContent()) ?? "";
          const result = step.expectedText ? text.includes(step.expectedText) : text.length > 0;
          Logger.info(`Assert text contains "${step.expectedText}": ${result} (actual: "${text.slice(0, 80)}")`);
          return result;
        } catch { return false; }
      }

      case "assertValue": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const value  = await el.first().inputValue();
          const result = value === (step.expectedText ?? "");
          Logger.info(`Assert value "${step.expectedText}": ${result} (actual: "${value}")`);
          return result;
        } catch { return false; }
      }

      case "assertChecked": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const checked = await el.first().isChecked();
          Logger.info(`Assert checked: ${checked}`);
          return checked;
        } catch { return false; }
      }

      case "assertUnchecked": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const checked = await el.first().isChecked();
          Logger.info(`Assert unchecked: ${!checked}`);
          return !checked;
        } catch { return false; }
      }

      case "assertEnabled": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const enabled = await el.first().isEnabled();
          Logger.info(`Assert enabled: ${enabled}`);
          return enabled;
        } catch { return false; }
      }

      case "assertDisabled": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const disabled = await el.first().isDisabled();
          Logger.info(`Assert disabled: ${disabled}`);
          return disabled;
        } catch { return false; }
      }

      case "assertHasClass": {
        const el = getElement(page, step);
        if (!el || !step.expectedAttribute) { Logger.warn("assertHasClass: expectedAttribute (class name) required"); return false; }
        try {
          const cls    = (await el.first().getAttribute("class")) ?? "";
          const result = cls.split(/\s+/).includes(step.expectedAttribute);
          Logger.info(`Assert has class "${step.expectedAttribute}": ${result} (actual: "${cls}")`);
          return result;
        } catch { return false; }
      }

      // ── Waits ────────────────────────────────────────────────────────────────

      case "wait": {
        const ms = step.waitMs ?? 1000;
        await page.waitForTimeout(ms);
        Logger.info(`Waited ${ms}ms`);
        return true;
      }

      case "waitForUrl": {
        if (!step.expectedUrl) { Logger.warn("waitForUrl: no expectedUrl"); return false; }
        await page.waitForURL(step.expectedUrl, { timeout: step.timeout ?? DEFAULT_CONFIG.waitTimeout });
        Logger.info(`URL reached: ${step.expectedUrl}`);
        return true;
      }

      case "waitForText": {
        const loc = resolveLocatorStr(step) || "body";
        const el = resolvePlaywrightLocator(page, loc) ?? page.locator(loc);
        await el.filter({ hasText: step.expectedText ?? "" })
          .first()
          .waitFor({ state: "visible", timeout: step.timeout ?? DEFAULT_CONFIG.waitTimeout });
        Logger.info(`Text visible: "${step.expectedText}"`);
        return true;
      }

      case "waitForNetwork": {
        // Try networkidle first — fall back to domcontentloaded for apps with polling/WebSockets
        try {
          await page.waitForLoadState("networkidle", { timeout: step.timeout ?? 5000 });
        } catch {
          Logger.debug("waitForNetwork: networkidle timeout — falling back to domcontentloaded");
          try {
            await page.waitForLoadState("domcontentloaded", { timeout: step.timeout ?? 5000 });
          } catch { /* already loaded */ }
        }
        Logger.info("Network stable");
        return true;
      }

      // ── Page utilities ───────────────────────────────────────────────────────

      case "screenshot": {
        const dir = DEFAULT_CONFIG.screenshotDir;
        fs.mkdirSync(dir, { recursive: true });
        // CWE-22 fix: use path.basename to strip any directory components from name
        const rawName  = step.screenshotName ?? `screenshot-${Date.now()}.png`;
        const safeName = path.basename(rawName);
        const filePath = path.join(path.resolve(dir), safeName);
        const resolved = path.resolve(filePath);
        const base     = path.resolve(dir);
        if (!resolved.startsWith(base + path.sep) && resolved !== base) {
          Logger.warn(`Screenshot path traversal blocked: "${rawName}"`);
          return false;
        }
        await page.screenshot({ path: filePath, fullPage: true });
        Logger.info(`Screenshot: ${filePath}`);
        return true;
      }

      case "scroll": {
        const dir = step.scrollDirection ?? "down";
        const amount = step.scrollAmount ?? 300;
        const scrollMap: Record<string, [number, number]> = {
          down: [0, amount], up: [0, -amount],
          right: [amount, 0], left: [-amount, 0],
          top: [0, -99999], bottom: [0, 99999]
        };
        const [x, y] = scrollMap[dir] ?? [0, amount];
        await page.mouse.wheel(x, y);
        Logger.info(`Scrolled ${dir} ${amount}px`);
        return true;
      }

      case "scrollTo": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().scrollIntoViewIfNeeded();
        Logger.info(`Scrolled to: ${resolveLocatorStr(step)}`);
        return true;
      }

      // ── Advanced ─────────────────────────────────────────────────────────────

      case "iframe": {
        const iframeLoc = step.iframeLocator ?? "iframe";
        const innerLoc = resolveLocatorStr(step);
        if (!innerLoc) { Logger.warn("iframe: no inner locator"); return false; }
        const frame = page.frameLocator(iframeLoc);

        // frameLocator only accepts CSS/XPath — parse Codegen strings manually
        const rm  = innerLoc.match(/^getByRole\(\s*['"]([^'"]+)['"]\s*(?:,\s*(\{[^}]*\}))?\s*\)/);
        const lm  = innerLoc.match(/^getByLabel\(\s*['"]([^'"]+)['"]/);
        const tm  = innerLoc.match(/^getByText\(\s*['"]([^'"]+)['"]/);
        const tim = innerLoc.match(/^getByTestId\(\s*['"]([^'"]+)['"]/);
        const pm  = innerLoc.match(/^getByPlaceholder\(\s*['"]([^'"]+)['"]/);

        const frameEl = rm  ? frame.getByRole(rm[1] as Parameters<Page["getByRole"]>[0], parseOptions(rm[2] ?? "{}"))
                       : lm  ? frame.getByLabel(lm[1])
                       : tm  ? frame.getByText(tm[1])
                       : tim ? frame.getByTestId(tim[1])
                       : pm  ? frame.getByPlaceholder(pm[1])
                       :       frame.locator(innerLoc);

        await frameEl.first().click({ timeout: step.timeout ?? DEFAULT_CONFIG.iframeTimeout });
        Logger.info(`Clicked in iframe "${iframeLoc}": ${innerLoc}`);
        return true;
      }

      case "alert": {
        const alertAction = step.alertAction ?? "accept";
        page.once("dialog", async (dialog: {
          type: () => string; message: () => string;
          accept: (t?: string) => Promise<void>; dismiss: () => Promise<void>;
        }) => {
          Logger.info(`Dialog: type=${dialog.type()}, msg="${dialog.message()}"`);
          if (alertAction === "dismiss") await dialog.dismiss();
          else await dialog.accept(step.alertText);
        });
        const el = getElement(page, step);
        if (el && (await el.count()) > 0) await el.first().click();
        Logger.info(`Alert handled: ${alertAction}`);
        return true;
      }

      // ── Mobile / Touch ───────────────────────────────────────────────────────────

      case "tap": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().tap({
          position: step.tapPosition,
          timeout:  step.timeout || DEFAULT_CONFIG.timeout
        });
        Logger.info(`Tapped: ${resolveLocatorStr(step)}`);
        return true;
      }

      // ── DOM / JS ─────────────────────────────────────────────────────────────────

      case "dispatchEvent": {
        const el = getElement(page, step);
        if (!el || !step.eventType) { Logger.warn("dispatchEvent: locator and eventType required"); return false; }
        await el.first().dispatchEvent(step.eventType, step.eventInit ?? {});
        Logger.info(`Dispatched event "${step.eventType}" on: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "evaluate": {
        // CWE-95: No user-supplied strings executed as code.
        // step.expression selects a property via strict allowlist — zero eval/Function.
        if (!step.expression) { Logger.warn("evaluate: expression required"); return false; }
        const el = getElement(page, step);
        const expr = step.expression.trim();
        let result: unknown;

        const attrMatch = expr.match(/^getAttribute:([a-zA-Z][a-zA-Z0-9_-]*)$/);
        if (attrMatch) {
          if (!el) { Logger.warn("evaluate getAttribute: locator required"); return false; }
          result = await el.first().getAttribute(attrMatch[1]);
        } else if (expr.match(/^dataset:[a-zA-Z][a-zA-Z0-9_]*$/)) {
          if (!el) { Logger.warn("evaluate dataset: locator required"); return false; }
          result = await el.first().evaluate(
            (node: Element, k: string) => (node as HTMLElement).dataset[k] ?? null, expr.slice(8)
          );
        } else if (expr === "textContent") {
          if (!el) { Logger.warn("evaluate textContent: locator required"); return false; }
          result = await el.first().textContent();
        } else if (expr === "innerText") {
          if (!el) { Logger.warn("evaluate innerText: locator required"); return false; }
          result = await el.first().innerText();
        } else if (expr === "value") {
          if (!el) { Logger.warn("evaluate value: locator required"); return false; }
          result = await el.first().inputValue();
        } else if (expr === "checked") {
          if (!el) { Logger.warn("evaluate checked: locator required"); return false; }
          result = await el.first().isChecked();
        } else if (expr === "disabled") {
          if (!el) { Logger.warn("evaluate disabled: locator required"); return false; }
          result = !(await el.first().isEnabled());
        } else if (expr === "className") {
          if (!el) { Logger.warn("evaluate className: locator required"); return false; }
          result = await el.first().getAttribute("class");
        } else if (expr === "href") {
          if (!el) { Logger.warn("evaluate href: locator required"); return false; }
          result = await el.first().getAttribute("href");
        } else if (expr === "src") {
          if (!el) { Logger.warn("evaluate src: locator required"); return false; }
          result = await el.first().getAttribute("src");
        } else if (expr === "scrollTop") {
          if (!el) { Logger.warn("evaluate scrollTop: locator required"); return false; }
          result = await el.first().evaluate((node: Element) => (node as HTMLElement).scrollTop);
        } else if (expr === "scrollHeight") {
          if (!el) { Logger.warn("evaluate scrollHeight: locator required"); return false; }
          result = await el.first().evaluate((node: Element) => (node as HTMLElement).scrollHeight);
        } else {
          Logger.warn(`evaluate: "${expr}" not in safe allowlist — blocked (CWE-95)`);
          return false;
        }
        Logger.info(`Evaluate result: ${JSON.stringify(result)}`);
        if (step.extra) step.extra["evalResult"] = result;
        return true;
      }

      // ── Clipboard ─────────────────────────────────────────────────────────────────

      case "clipboardCopy": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().focus();
        await page.keyboard.press(process.platform === "darwin" ? "Meta+C" : "Control+C");
        Logger.info(`Clipboard copy on: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "clipboardPaste": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().focus();
        if (step.clipboardText) {
          // Write text to clipboard then paste
          await page.evaluate(
            (text: string) => navigator.clipboard.writeText(text),
            step.clipboardText
          );
        }
        await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
        Logger.info(`Clipboard paste on: ${resolveLocatorStr(step)}`);
        return true;
      }

      // ── Browser context ──────────────────────────────────────────────────────────

      case "geolocation": {
        if (step.latitude === undefined || step.longitude === undefined) {
          Logger.warn("geolocation: latitude and longitude required");
          return false;
        }
        await page.context().setGeolocation({
          latitude:  step.latitude,
          longitude: step.longitude,
          accuracy:  step.accuracy ?? 100
        });
        Logger.info(`Geolocation set: ${step.latitude}, ${step.longitude}`);
        return true;
      }

      case "emulateMedia": {
        await page.emulateMedia({
          colorScheme: step.colorScheme,
          media:       step.media
        });
        Logger.info(`Media emulated: colorScheme=${step.colorScheme ?? "unchanged"}, media=${step.media ?? "unchanged"}`);
        return true;
      }

      // ── Additional assertions (Playwright parity) ───────────────────────────

      case "assertInViewport": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const box = await el.first().boundingBox();
          if (!box) { Logger.info("assertInViewport: element has no bounding box"); return false; }
          const vp  = page.viewportSize();
          if (!vp)  { Logger.info("assertInViewport: no viewport"); return false; }
          const inView = box.x >= 0 && box.y >= 0 &&
                         box.x + box.width  <= vp.width &&
                         box.y + box.height <= vp.height;
          Logger.info(`Assert in viewport: ${inView} (box: ${JSON.stringify(box)})`);
          return inView;
        } catch { return false; }
      }

      case "assertEditable": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const editable = await el.first().isEditable();
          Logger.info(`Assert editable: ${editable}`);
          return editable;
        } catch { return false; }
      }

      case "assertFocused": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const focused = await el.first().evaluate(
            (node) => node === document.activeElement
          );
          Logger.info(`Assert focused: ${focused}`);
          return focused;
        } catch { return false; }
      }

      // ── Advanced waits ────────────────────────────────────────────────────────────

      case "waitForFunction": {
        // CWE-95: No user string passed to page.waitForFunction.
        // step.expression maps to a named Playwright load state.
        if (!step.expression) { Logger.warn("waitForFunction: expression required"); return false; }
        const expr = step.expression.trim();
        const timeout = step.timeout ?? DEFAULT_CONFIG.waitTimeout;
        if (expr === "document.readyState === 'complete'" || expr === "load") {
          await page.waitForLoadState("load", { timeout });
        } else if (expr === "document.readyState !== 'loading'" || expr === "domcontentloaded") {
          await page.waitForLoadState("domcontentloaded", { timeout });
        } else if (expr === "networkidle") {
          await page.waitForLoadState("networkidle", { timeout });
        } else if (expr === "document.body !== null") {
          await page.locator("body").first().waitFor({ state: "attached", timeout });
        } else {
          Logger.warn(`waitForFunction: "${expr.slice(0, 80)}" not in safe allowlist — blocked (CWE-95)`);
          return false;
        }
        Logger.info(`waitForFunction resolved: ${expr.slice(0, 60)}`);
        return true;
      }

      case "waitForSelector": {
        const loc = resolveLocatorStr(step);
        if (!loc) { Logger.warn("waitForSelector: locator required"); return false; }
        const state = step.waitForState ?? "visible";
        await page.locator(loc).first().waitFor({
          state,
          timeout: step.timeout ?? DEFAULT_CONFIG.waitTimeout
        });
        Logger.info(`waitForSelector "${loc}" state=${state}`);
        return true;
      }

      case "assertPattern": {
        const el = getElement(page, step);
        if (!el) { Logger.warn("assertPattern: no locator provided"); return false; }
        if (!step.pattern) { Logger.warn("assertPattern: no pattern provided"); return false; }
        try {
          const regex = new RegExp(step.pattern, step.patternFlags ?? "");
          let actual: string;
          try { actual = (await el.first().textContent()) ?? ""; } catch { actual = ""; }
          if (!actual.trim()) { try { actual = await el.first().inputValue(); } catch { actual = ""; } }
          const result = regex.test(actual);
          Logger.info(`assertPattern /${step.pattern}/${step.patternFlags ?? ""}: ${result} (actual: "${actual.slice(0, 80)}")`);
          return result;
        } catch (e) {
          Logger.warn(`assertPattern: invalid regex "${step.pattern}": ${String(e)}`);
          return false;
        }
      }

      case "assertPdf": {
        const { PdfVerifier } = await import("../utils/PdfVerifier");
        const pdf = new PdfVerifier(page);
        const patterns: Record<string, RegExp> = {};
        for (const [label, pat] of Object.entries(step.pdfPatterns ?? {})) {
          try { patterns[label] = new RegExp(pat); } catch { /* skip invalid */ }
        }
        let pdfResult;
        if (step.pdfTriggerLocator) {
          pdfResult = await pdf.downloadAndVerify(step.pdfTriggerLocator, {
            expectedTexts: step.pdfExpectedTexts, patterns,
            minPages: step.pdfMinPages, maxPages: step.pdfMaxPages, savePath: step.filePath
          });
        } else if (step.filePath) {
          pdfResult = await pdf.verifyFile(step.filePath, {
            expectedTexts: step.pdfExpectedTexts, patterns,
            minPages: step.pdfMinPages, maxPages: step.pdfMaxPages
          });
        } else {
          Logger.warn("assertPdf: provide pdfTriggerLocator or filePath");
          return false;
        }
        if (step.extra) step.extra["pdfResult"] = pdfResult;
        Logger.info(`assertPdf: ${pdfResult.message}`);
        return pdfResult.success;
      }

      // ── Mouse coordinate actions ────────────────────────────────────────────────────────────

      case "mouseMove": {
        await page.mouse.move(step.mouseX ?? 0, step.mouseY ?? 0);
        Logger.info(`Mouse moved to: (${step.mouseX ?? 0}, ${step.mouseY ?? 0})`);
        return true;
      }

      case "dragDropCoords": {
        if (step.sourceX === undefined || step.sourceY === undefined ||
            step.targetX === undefined || step.targetY === undefined) {
          Logger.warn("dragDropCoords: sourceX, sourceY, targetX, targetY required"); return false;
        }
        await page.mouse.move(step.sourceX, step.sourceY);
        await page.mouse.down();
        await page.mouse.move(step.targetX, step.targetY, { steps: 10 });
        await page.mouse.up();
        Logger.info(`Dragged (${step.sourceX},${step.sourceY}) → (${step.targetX},${step.targetY})`);
        return true;
      }

      case "hoverAndWait": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().hover({ timeout: step.timeout || DEFAULT_CONFIG.timeout });
        await page.waitForTimeout(step.hoverWaitMs ?? 500);
        Logger.info(`Hovered and waited ${step.hoverWaitMs ?? 500}ms: ${resolveLocatorStr(step)}`);
        return true;
      }

      case "pressAndHold": {
        const el = getElement(page, step);
        if (!el) return false;
        const box = await el.first().boundingBox();
        if (!box) { Logger.warn("pressAndHold: element has no bounding box"); return false; }
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(step.holdMs ?? 1000);
        await page.mouse.up();
        Logger.info(`Press and hold ${step.holdMs ?? 1000}ms: ${resolveLocatorStr(step)}`);
        return true;
      }

      // ── Input actions ────────────────────────────────────────────────────────────────────────

      case "selectText": {
        const el = getElement(page, step);
        if (!el) return false;
        await el.first().focus();
        if (step.selectionStart !== undefined && step.selectionEnd !== undefined) {
          await el.first().evaluate(
            (node, { start, end }) => (node as HTMLInputElement).setSelectionRange(start, end),
            { start: step.selectionStart, end: step.selectionEnd }
          );
          Logger.info(`Selected text [${step.selectionStart}-${step.selectionEnd}]: ${resolveLocatorStr(step)}`);
        } else {
          await el.first().selectText();
          Logger.info(`Selected all text: ${resolveLocatorStr(step)}`);
        }
        return true;
      }

      case "pressKey": {
        const key = step.key || "Enter";
        const el = getElement(page, step);
        if (el) await el.first().press(key);
        else await page.keyboard.press(key);
        Logger.info(`Key pressed: ${key}`);
        return true;
      }

      case "multiFileUpload": {
        const loc = resolveLocatorStr(step) || 'input[type="file"]';
        const input = resolvePlaywrightLocator(page, loc) ?? page.locator(loc);
        if ((await input.count()) === 0) { Logger.warn("multiFileUpload: file input not found"); return false; }
        const filePaths = step.filePaths ?? (step.filePath ? [step.filePath] : []);
        if (filePaths.length === 0) { Logger.warn("multiFileUpload: no filePaths provided"); return false; }
        await input.setInputFiles(filePaths);
        Logger.info(`Multiple files uploaded: [${filePaths.join(", ")}]`);
        return true;
      }

      // ── Browser context actions ───────────────────────────────────────────────────────────

      case "setViewport": {
        const w = step.viewportWidth ?? 1280;
        const h = step.viewportHeight ?? 720;
        await page.setViewportSize({ width: w, height: h });
        Logger.info(`Viewport set to ${w}x${h}`);
        return true;
      }

      case "mockDate": {
        if (!step.mockDateValue) { Logger.warn("mockDate: mockDateValue required"); return false; }
        const mockMs = new Date(step.mockDateValue).getTime();
        if (isNaN(mockMs)) { Logger.warn(`mockDate: invalid date "${step.mockDateValue}"`); return false; }
        // Pass mockMs as serialised data — never interpolate user input into script
        await page.addInitScript(({ ts }: { ts: number }) => {
          const __mockNow = ts;
          const __OrigDate = Date;
          class MockDate extends __OrigDate {
            constructor(...args: unknown[]) { if (args.length === 0) super(__mockNow); else super(...(args as ConstructorParameters<typeof Date>)); }
            static now() { return __mockNow; }
          }
          (window as unknown as { Date: typeof Date }).Date = MockDate as unknown as typeof Date;
        }, { ts: mockMs });
        Logger.info(`Date mocked to: ${step.mockDateValue}`);
        return true;
      }

      case "networkThrottle": {
        const profile = step.networkProfile ?? "reset";
        const cdp = await page.context().newCDPSession(page);
        const profiles: Record<string, { offline: boolean; downloadThroughput: number; uploadThroughput: number; latency: number }> = {
          offline: { offline: true,  downloadThroughput: 0,       uploadThroughput: 0,       latency: 0   },
          slow3g:  { offline: false, downloadThroughput: 50000,   uploadThroughput: 20000,   latency: 400 },
          fast3g:  { offline: false, downloadThroughput: 180000,  uploadThroughput: 84375,   latency: 150 },
          "4g":    { offline: false, downloadThroughput: 4000000, uploadThroughput: 3000000, latency: 20  },
          reset:   { offline: false, downloadThroughput: -1,      uploadThroughput: -1,      latency: 0   },
        };
        await cdp.send("Network.emulateNetworkConditions", profiles[profile] ?? profiles["reset"]!);
        Logger.info(`Network throttled to: ${profile}`);
        return true;
      }

      // ── Wait actions ───────────────────────────────────────────────────────────────────────────

      case "waitForDownload": {
        const el = getElement(page, step);
        const [download] = await Promise.all([
          page.waitForEvent("download", { timeout: step.downloadTimeout ?? 30000 }),
          el ? el.first().click() : Promise.resolve()
        ]);
        const rawName = download.suggestedFilename() || `download-${Date.now()}`;
        const safeName = path.basename(rawName.replace(/[^a-z0-9._-]/gi, "_"));
        const savePath = step.downloadSavePath ?? path.join(DEFAULT_CONFIG.downloadDir, safeName);
        fs.mkdirSync(path.dirname(savePath), { recursive: true });
        await download.saveAs(savePath);
        if (step.extra) step.extra["downloadPath"] = savePath;
        Logger.info(`Download completed: ${savePath}`);
        return true;
      }

      case "waitForVisible": {
        const loc = step.waitLocator ?? resolveLocatorStr(step);
        if (!loc) { Logger.warn("waitForVisible: locator required"); return false; }
        await (resolvePlaywrightLocator(page, loc) ?? page.locator(loc))
          .first().waitFor({ state: "visible", timeout: step.timeout ?? DEFAULT_CONFIG.waitTimeout });
        Logger.info(`Element visible: "${loc}"`);
        return true;
      }

      case "waitForHidden": {
        const loc = step.waitLocator ?? resolveLocatorStr(step);
        if (!loc) { Logger.warn("waitForHidden: locator required"); return false; }
        await (resolvePlaywrightLocator(page, loc) ?? page.locator(loc))
          .first().waitFor({ state: "hidden", timeout: step.timeout ?? DEFAULT_CONFIG.waitTimeout });
        Logger.info(`Element hidden: "${loc}"`);
        return true;
      }

      // ── Enhanced assertions ───────────────────────────────────────────────────────────────

      case "assertContainsText": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          await el.first().waitFor({ state: "visible", timeout: step.timeout ?? DEFAULT_CONFIG.waitTimeout });
          const text = (await el.first().textContent()) ?? "";
          const result = text.includes(step.expectedText ?? "");
          Logger.info(`Assert contains "${step.expectedText}": ${result}`);
          return result;
        } catch { return false; }
      }

      case "assertNotContainsText": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const text = (await el.first().textContent()) ?? "";
          const result = !text.includes(step.notExpectedText ?? "");
          Logger.info(`Assert NOT contains "${step.notExpectedText}": ${result}`);
          return result;
        } catch { return false; }
      }

      case "assertGreaterThan": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const raw = ((await el.first().textContent()) ?? await el.first().inputValue()).replace(/[^0-9.-]/g, "");
          const actual = parseFloat(raw);
          const result = actual > (step.expectedNumber ?? 0);
          Logger.info(`Assert ${actual} > ${step.expectedNumber}: ${result}`);
          return result;
        } catch { return false; }
      }

      case "assertLessThan": {
        const el = getElement(page, step);
        if (!el) return false;
        try {
          const raw = ((await el.first().textContent()) ?? await el.first().inputValue()).replace(/[^0-9.-]/g, "");
          const actual = parseFloat(raw);
          const result = actual < (step.expectedNumber ?? 0);
          Logger.info(`Assert ${actual} < ${step.expectedNumber}: ${result}`);
          return result;
        } catch { return false; }
      }

      // ── Table actions ───────────────────────────────────────────────────────────────────────────

      case "tableGetCell": {
        const tbl = step.tableLocator ?? resolveLocatorStr(step);
        if (!tbl) { Logger.warn("tableGetCell: tableLocator required"); return false; }
        try {
          const text = (await page.locator(`${tbl} tr`).nth(step.tableRow ?? 0)
            .locator("td, th").nth(step.tableCol ?? 0).textContent()) ?? "";
          Logger.info(`Table cell [${step.tableRow ?? 0}][${step.tableCol ?? 0}]: "${text}"`);
          if (step.extra) step.extra["cellText"] = text;
          return true;
        } catch { return false; }
      }

      case "tableAssertRow": {
        const tbl = step.tableLocator ?? resolveLocatorStr(step);
        if (!tbl) { Logger.warn("tableAssertRow: tableLocator required"); return false; }
        const rowText = step.tableRowText ?? step.expectedText ?? "";
        try {
          const count = await page.locator(`${tbl} tr`).filter({ hasText: rowText }).count();
          Logger.info(`Table row "${rowText}" exists: ${count > 0}`);
          return count > 0;
        } catch { return false; }
      }

      case "tableGetRowCount": {
        const tbl = step.tableLocator ?? resolveLocatorStr(step);
        if (!tbl) { Logger.warn("tableGetRowCount: tableLocator required"); return false; }
        try {
          const count = await page.locator(`${tbl} tr`).count();
          Logger.info(`Table row count: ${count}`);
          if (step.extra) step.extra["rowCount"] = count;
          if (step.expectedCount !== undefined) return count === step.expectedCount;
          return true;
        } catch { return false; }
      }

      default: {
        // Try extended actions first
        const extended = await handleExtendedAction(page, action as string, step);
        if (extended !== null) return extended;
        // Try extended actions 2
        const extended2 = await handleExtendedAction2(page, action as string, step);
        if (extended2 !== null) return extended2;
        // Then plugin registry
        const customHandler = pluginRegistry.get(action as string);
        if (customHandler) {
          Logger.debug(`Plugin action: ${action}`);
          return customHandler(page, step);
        }
        Logger.warn(`Unknown action type: ${action as string}`);
        return false;
      }
    }
  } catch (e) {
    Logger.error(`ActionRouter "${action}" failed on "${step.label}"`, String(e));
    return false;
  }
}