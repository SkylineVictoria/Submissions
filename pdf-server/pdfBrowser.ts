import { chromium, type Browser, type Page } from 'playwright';
import { BROWSER_RESTART_AFTER_JOBS } from './pdfConstants.js';
import { logMemory } from './pdfMemory.js';

const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--hide-scrollbars',
  '--mute-audio',
  '--no-first-run',
  '--no-zygote',
  '--font-render-hinting=none',
  '--disable-software-rasterizer',
];

let browserPromise: Promise<Browser> | null = null;
let jobsSinceBrowserLaunch = 0;
let renderQueue: Promise<void> = Promise.resolve();
let queueDepth = 0;

export interface PdfJobMeta {
  jobId: string;
  label: string;
}

export function createPdfJobId(prefix = 'pdf'): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  const pending = browserPromise;
  browserPromise = null;
  jobsSinceBrowserLaunch = 0;
  try {
    const browser = await pending;
    if (browser.isConnected()) {
      await browser.close();
    }
  } catch {
    /* ignore */
  }
  logMemory('browser-closed');
}

async function launchBrowser(): Promise<Browser> {
  logMemory('browser-launching');
  const browser = await chromium.launch({
    headless: true,
    args: CHROMIUM_ARGS,
  });
  browser.on('disconnected', () => {
    browserPromise = null;
    jobsSinceBrowserLaunch = 0;
  });
  jobsSinceBrowserLaunch = 0;
  logMemory('browser-launched');
  return browser;
}

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise;
    if (existing.isConnected()) return existing;
    browserPromise = null;
  }
  browserPromise = launchBrowser();
  return browserPromise;
}

async function maybeRestartBrowserAfterJob(): Promise<void> {
  jobsSinceBrowserLaunch += 1;
  if (jobsSinceBrowserLaunch >= BROWSER_RESTART_AFTER_JOBS) {
    console.log(`[PDF] restarting browser after ${jobsSinceBrowserLaunch} jobs`);
    await closeBrowser();
  }
}

function enqueueRender<T>(task: () => Promise<T>): Promise<T> {
  queueDepth += 1;
  if (queueDepth > 1) {
    console.log(`[PDF] job queued (depth ${queueDepth})`);
  }
  const run = renderQueue.then(task, task);
  renderQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run.finally(() => {
    queueDepth = Math.max(0, queueDepth - 1);
  });
}

/**
 * Run exactly one PDF render at a time; reuse browser; restart periodically.
 */
export async function runPdfJob<T>(meta: PdfJobMeta, fn: (page: Page) => Promise<T>): Promise<T> {
  const started = Date.now();
  return enqueueRender(async () => {
    console.log(`[PDF] job started ${meta.jobId} ${meta.label}`);
    logMemory(`${meta.jobId} job-start`);
    let page: Page | null = null;
    try {
      logMemory(`${meta.jobId} before-browser`);
      const browser = await getBrowser();
      page = await browser.newPage();
      logMemory(`${meta.jobId} after-newPage`);
      const result = await fn(page);
      console.log(`[PDF] job completed ${meta.jobId} ${meta.label} ${Date.now() - started}ms`);
      return result;
    } catch (err) {
      console.error(`[PDF] job failed ${meta.jobId} ${meta.label}`, err);
      if (page) {
        const browser = page.context().browser();
        if (browser && !browser.isConnected()) {
          browserPromise = null;
        }
      }
      throw err;
    } finally {
      if (page) {
        await page.close().catch(() => undefined);
        logMemory(`${meta.jobId} after-page-close`);
      }
      await maybeRestartBrowserAfterJob();
      logMemory(`${meta.jobId} job-end`);
    }
  });
}

/** Wait for #pdf-ready, images, and fonts — do not use networkidle. */
export async function preparePageForPrint(page: Page): Promise<void> {
  await page.waitForSelector('#pdf-ready', { state: 'attached', timeout: 10_000 }).catch(() => undefined);
  await page.evaluate(() => {
    return Promise.all(
      Array.from(document.images).map(
        (img) =>
          new Promise<void>((resolve) => {
            if (img.complete) resolve();
            else {
              img.onload = () => resolve();
              img.onerror = () => resolve();
            }
          })
      )
    );
  });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    document.getElementById('pdf-ready')?.setAttribute('data-print-ready', '1');
  });
}
