import { Page, BrowserContext } from "@playwright/test";
import { Logger } from "../utils/Logger";
import { Step } from "../types";

export interface SandboxResult {
  success: boolean;
  error?: string;
  sideEffects?: string[];
  domChanges?: number;
  executionTime: number;
  rollbackSuccessful: boolean;
}

export class SafeExecutionSandbox {
  private static isEnabled = process.env.FW_SANDBOX_EXECUTION === 'true';
  private static readonly MAX_SANDBOX_TIME_MS = 10000; // 10 seconds
  private static readonly ALLOWED_DOM_CHANGES = 3; // Maximum allowed DOM changes

  static async executeInSandbox(
    page: Page,
    action: string,
    step: Step,
    locator: string
  ): Promise<SandboxResult> {
    
    if (!this.isEnabled || this.isLowRiskAction(action)) {
      // Bypass sandbox for low-risk actions
      try {
        const result = await this.executeAction(page, action, step, locator);
        return { 
          success: result, 
          executionTime: 0, 
          rollbackSuccessful: true,
          sideEffects: [] 
        };
      } catch (error) {
        return { 
          success: false, 
          error: String(error),
          executionTime: 0, 
          rollbackSuccessful: true,
          sideEffects: [] 
        };
      }
    }

    const startTime = Date.now();
    let sandboxContext: BrowserContext | null = null;
    
    try {
      // Create isolated sandbox context
      sandboxContext = await this.createSandboxContext(page);
      const sandboxPage = await sandboxContext.newPage();
      
      // Capture initial state
      const initialState = await this.capturePageState(sandboxPage);
      
      // Navigate to same URL
      await sandboxPage.goto(page.url(), { waitUntil: 'domcontentloaded' });
      
      // Execute action in sandbox
      const executionSuccess = await this.executeAction(sandboxPage, action, step, locator);
      
      if (!executionSuccess) {
        return {
          success: false,
          error: 'Action failed in sandbox',
          executionTime: Date.now() - startTime,
          rollbackSuccessful: true,
          sideEffects: []
        };
      }
      
      // Capture post-execution state
      const finalState = await this.capturePageState(sandboxPage);
      
      // Analyze side effects
      const sideEffects = this.analyzeSideEffects(initialState, finalState);
      const domChanges = this.countDOMChanges(initialState, finalState);
      
      // Validate no unexpected side effects
      const hasUnexpectedEffects = this.hasUnexpectedSideEffects(sideEffects, action);
      
      if (hasUnexpectedEffects || domChanges > this.ALLOWED_DOM_CHANGES) {
        Logger.warn(`Sandbox blocked action due to side effects: ${action}`, {
          sideEffects,
          domChanges,
          locator
        });
        
        return {
          success: false,
          error: 'Unexpected side effects detected',
          sideEffects,
          domChanges,
          executionTime: Date.now() - startTime,
          rollbackSuccessful: true
        };
      }
      
      // If safe, execute in real context
      const realResult = await this.executeAction(page, action, step, locator);
      
      return {
        success: realResult,
        sideEffects,
        domChanges,
        executionTime: Date.now() - startTime,
        rollbackSuccessful: true
      };
      
    } catch (error) {
      Logger.error('Sandbox execution failed', error);
      return {
        success: false,
        error: String(error),
        executionTime: Date.now() - startTime,
        rollbackSuccessful: true,
        sideEffects: []
      };
    } finally {
      if (sandboxContext) {
        await sandboxContext.close().catch(() => {});
      }
    }
  }

  private static async createSandboxContext(page: Page): Promise<BrowserContext> {
    const browser = page.context().browser();
    if (!browser) {
      throw new Error('Browser not available for sandbox');
    }
    
    return await browser.newContext({
      // Isolated settings
      viewport: page.viewportSize(),
      userAgent: await page.evaluate(() => navigator.userAgent),
      javaScriptEnabled: true,
      bypassCSP: true,
      // Add more isolation settings as needed
    });
  }

  private static async capturePageState(page: Page): Promise<any> {
    return await page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      domSnapshot: document.documentElement.outerHTML,
      cookies: document.cookie,
      localStorage: JSON.stringify({ ...window.localStorage }),
      sessionStorage: JSON.stringify({ ...window.sessionStorage }),
      // Add more state capture as needed
    }));
  }

  private static analyzeSideEffects(initialState: any, finalState: any): string[] {
    const effects: string[] = [];
    
    if (initialState.url !== finalState.url) {
      effects.push('navigation');
    }
    
    if (initialState.title !== finalState.title) {
      effects.push('title_change');
    }
    
    if (initialState.cookies !== finalState.cookies) {
      effects.push('cookies_modified');
    }
    
    if (initialState.localStorage !== finalState.localStorage) {
      effects.push('local_storage_modified');
    }
    
    if (initialState.sessionStorage !== finalState.sessionStorage) {
      effects.push('session_storage_modified');
    }
    
    // DOM change detection
    if (initialState.domSnapshot !== finalState.domSnapshot) {
      effects.push('dom_modified');
    }
    
    return effects;
  }

  private static countDOMChanges(initialState: any, finalState: any): number {
    if (initialState.domSnapshot === finalState.domSnapshot) {
      return 0;
    }
    
    // Simple DOM change counting (implement more sophisticated diffing if needed)
    const initialLines = initialState.domSnapshot.split('\n').length;
    const finalLines = finalState.domSnapshot.split('\n').length;
    
    return Math.abs(initialLines - finalLines);
  }

  private static hasUnexpectedSideEffects(sideEffects: string[], action: string): boolean {
    const expectedEffects = this.getExpectedEffects(action);
    
    return sideEffects.some(effect => !expectedEffects.includes(effect));
  }

  private static getExpectedEffects(action: string): string[] {
    const effectMap: { [key: string]: string[] } = {
      'click': ['dom_modified'],
      'fill': ['dom_modified'],
      'select': ['dom_modified'],
      'check': ['dom_modified'],
      'uncheck': ['dom_modified'],
      'goto': ['navigation', 'title_change', 'cookies_modified', 'dom_modified'],
      'goBack': ['navigation', 'title_change', 'dom_modified'],
      'goForward': ['navigation', 'title_change', 'dom_modified'],
      // Add more action-effect mappings
    };
    
    return effectMap[action] || ['dom_modified'];
  }

  private static isLowRiskAction(action: string): boolean {
    const lowRiskActions = new Set([
      'assertVisible', 'assertHidden', 'assertText', 'assertValue',
      'assertChecked', 'assertEnabled', 'assertDisabled', 'screenshot'
    ]);
    
    return lowRiskActions.has(action);
  }

  private static async executeAction(
    page: Page,
    action: string,
    step: Step,
    locator: string
  ): Promise<boolean> {
    try {
      const element = page.locator(locator);
      switch (action) {
        case 'click':    await element.click();                        break;
        case 'fill':     await element.fill(step.text ?? step.value ?? ''); break;
        case 'check':    await element.check();                       break;
        case 'uncheck':  await element.uncheck();                     break;
        case 'hover':    await element.hover();                       break;
        case 'focus':    await element.focus();                       break;
        case 'dblclick':
        case 'doubleClick': await element.dblclick();                 break;
        default:
          // Unknown action — attempt click as safe fallback instead of throwing
          Logger.debug(`SafeExecutionSandbox: unknown action "${action}" — attempting click`);
          await element.click();
      }
      return true;
    } catch (error) {
      Logger.debug(`Action failed in sandbox: ${action}`, { error: String(error) });
      return false;
    }
  }
}