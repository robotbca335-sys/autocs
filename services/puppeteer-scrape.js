// ============================================================
// PUPPETEER SCRAPE SERVICE - Automasi DOM bonussmb.com
// Replika logika bg-secure.js automateForm()
// and bg-queue.js injectedSingle()
// Membutuhkan Chrome/Chromium terinstall (puppeteer-core)
// ============================================================

let puppeteer;
try { puppeteer = require('puppeteer-core'); } catch (_) { puppeteer = null; }

const BONUS_URL = 'https://bonussmb.com/tickets?page=1&limit=500';
const HISTORY_URL = 'https://bonussmb.com/history';
const DEFAULT_CHROME_PATH = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEFAULT_EXECUTOR = 'AUTO CS';

let _browser = null;
let _scrapeState = { connected: false, ready: false, error: null };

async function ensureBrowser(executablePath, headless = true) {
  if (_browser && _browser.connected) return _browser;
  if (!puppeteer) throw new Error('puppeteer-core tidak terinstall. Jalankan: npm install puppeteer-core');
  const chrome = executablePath || process.env.CHROME_PATH || DEFAULT_CHROME_PATH;
  _browser = await puppeteer.launch({
    executablePath: chrome,
    headless: headless,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--disable-gpu',
      '--window-size=1920,1080'
    ]
  });
  _scrapeState.connected = true;
  return _browser;
}

async function closeBrowser() {
  try { if (_browser) await _browser.close(); } catch (_) {}
  _browser = null;
  _scrapeState.connected = false;
  _scrapeState.ready = false;
}

function getState() { return { ..._scrapeState }; }

// --- Submit bonus ke bonussmb.com/tickets (replika automateForm dari bg-secure.js) ---
async function submitBonus(data, opts = {}) {
  const { situs = 'BANDAR80', tipe = 'SCATTER', userId, kodeTiket, betting, scatter, executor = DEFAULT_EXECUTOR } = data;
  const browser = await ensureBrowser(opts.executablePath, opts.headless !== false);
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  const result = { success: false, message: '' };

  try {
    await page.goto(BONUS_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Klik tombol buka form (tombol "+" atau "Buat Klaim Baru")
    const openBtn = await page.$('//*[@id="root"]/div/main/div/div[1]/button');
    if (openBtn) await openBtn.click();
    await page.waitForTimeout(800);

    // Situs dropdown
    const situsXpath = '//*[@id="radix-\u00abr9\u00bb"]/div[2]/form/div[1]/div[2]/div';
    await selectDropdown(page, situsXpath, situs);
    await page.waitForTimeout(100);

    // Tipe dropdown
    const tipeXpath = '//*[@id="radix-\u00abr9\u00bb"]/div[2]/form/div[2]/div[2]/div';
    await selectDropdown(page, tipeXpath, tipe);
    await page.waitForTimeout(100);

    // User ID
    await page.type('input[placeholder="User ID"]', userId || '', { delay: 30 });
    await page.waitForTimeout(100);

    // Kode Tiket
    await page.type('input[placeholder="Kode Tiket"]', kodeTiket || '', { delay: 30 });
    await page.waitForTimeout(100);

    // Betting
    const betInput = await page.$('input[type="text"][inputmode="numeric"][placeholder="#######"]');
    if (betInput) {
      await betInput.click({ clickCount: 3 });
      await page.type('input[type="text"][inputmode="numeric"][placeholder="#######"]', String(betting || ''), { delay: 30 });
    }
    await page.waitForTimeout(150);

    // Scatter dropdown
    const scatterXpath = '//*[@id="radix-\u00abr9\u00bb"]/div[2]/form/div[8]/div[2]/div/div';
    const scatterFilled = await selectDropdown(page, scatterXpath, String(scatter || ''));
    if (!scatterFilled) {
      result.message = 'Scatter tidak valid atau tidak ditemukan';
      return result;
    }

    // Save
    const saveBtn = await page.$('button[data-slot="button"]');
    if (saveBtn) await saveBtn.click();

    // Tunggu toast
    const toast = await waitForToast(page, 10000);
    result.success = true;
    result.message = toast || 'Disimpan (toast tidak terdeteksi)';
    return result;
  } catch (e) {
    result.message = 'Error: ' + e.message;
    return result;
  } finally {
    try { await page.close(); } catch (_) {}
  }
}

// --- Cek status di bonussmb.com/history (replika injectedSingle dari bg-queue.js) ---
async function checkBonusStatus(kodeTiket, opts = {}) {
  const browser = await ensureBrowser(opts.executablePath, opts.headless !== false);
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080 });
  const result = { col9: '', col10: '', status: '' };

  try {
    await page.goto(HISTORY_URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForTimeout(1500);

    // Input kode tiket ke search
    const input = await page.waitForSelector('//*[@id="root"]/div/main/div/div[3]/div[1]/div[1]/input', { timeout: 10000 });
    if (!input) return result;

    await input.click({ clickCount: 3 });
    await page.keyboard.type(kodeTiket, { delay: 30 });
    await page.waitForTimeout(800);

    // Arrow down + Enter
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(150);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);

    // Baca hasil
    const col9 = await page.$eval('//*[@id="root"]/div/main/div/div[3]/div[2]/div/table/tbody/tr/td[9]', el => el.textContent?.trim() || '');
    const col10 = await page.$eval('//*[@id="root"]/div/main/div/div[3]/div[2]/div/table/tbody/tr/td[10]', el => el.textContent?.trim() || '');

    const combined = (col9 + col10).toLowerCase();
    let status = '';
    if (combined.includes('reject')) status = 'REJECTED';
    else if (combined.includes('approve')) status = 'APPROVED';

    result.col9 = col9;
    result.col10 = col10;
    result.status = status;
    return result;
  } catch (e) {
    result.status = 'ERROR';
    result.col9 = e.message;
    return result;
  } finally {
    try { await page.close(); } catch (_) {}
  }
}

// --- Helper: pilih dropdown via XPath (replika clickArrowDownAndSelect) ---
async function selectDropdown(page, xpath, value) {
  try {
    const container = await page.waitForSelector(xpath, { timeout: 3000 });
    if (!container) return false;

    const ctrl = await container.$('div[role="combobox"], div > div');
    if (!ctrl) return false;

    await ctrl.click();
    await page.waitForTimeout(80);

    const inner = await ctrl.$('input, [role="combobox"]');
    if (inner) {
      await inner.focus();
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(120);
    } else {
      await ctrl.press('ArrowDown');
      await page.waitForTimeout(120);
    }

    // Tunggu options muncul
    const opts = await page.$$eval('[role="option"]', els => els.filter(e => e.offsetParent !== null).map(e => e.textContent.trim()));
    if (!opts.length) return false;

    // Cari match
    const matchIdx = opts.findIndex(o => o.toLowerCase() === String(value).toLowerCase());
    if (matchIdx >= 0) {
      await page.$$eval('[role="option"]', (els, idx) => els.filter(e => e.offsetParent !== null)[idx]?.click(), matchIdx);
      await page.waitForTimeout(100);
      return true;
    }

    // Fallback: klik pertama
    await page.$$eval('[role="option"]', els => { const o = els.filter(e => e.offsetParent !== null)[0]; if (o) o.click(); });
    await page.waitForTimeout(100);
    return true;
  } catch (_) {
    return false;
  }
}

// --- Helper: tunggu toast notification ---
async function waitForToast(page, timeout = 8000) {
  const start = Date.now();
  let lastContent = '';
  while (Date.now() - start < timeout) {
    try {
      const section = await page.$('section[aria-label="Notifications alt+T"][tabindex="-1"][aria-live="polite"]');
      if (section) {
        const text = await section.evaluate(el => el.textContent?.trim() || '');
        if (text && text !== lastContent) {
          lastContent = text;
          await page.waitForTimeout(100);
          const finalText = await section.evaluate(el => el.textContent?.trim() || '');
          if (finalText) return finalText;
        }
      }
    } catch (_) {}
    await page.waitForTimeout(200);
  }
  return null;
}

module.exports = {
  submitBonus, checkBonusStatus, closeBrowser, getState,
  ensureBrowser, BONUS_URL, HISTORY_URL
};