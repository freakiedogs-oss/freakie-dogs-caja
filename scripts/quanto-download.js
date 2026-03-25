/**
 * quanto-download.js
 * GitHub Actions script: descarga DTEs de QUANTO y los procesa en Supabase
 *
 * Variables de entorno requeridas:
 *   FIREBASE_API_KEY      - API key de Firebase de QUANTO
 *   FIREBASE_REFRESH_TOKEN - Refresh token del usuario freakiedogs@gmail.com
 *   QUANTO_UID            - UID de Firebase del usuario
 *   SUPABASE_URL          - URL del proyecto Supabase
 *   SUPABASE_ANON_KEY     - Anon key de Supabase
 *   FECHA                 - (opcional) Fecha a procesar YYYY-MM-DD, default: ayer CST
 */

const { chromium } = require('playwright');
const fs = require('fs');
const JSZip = require('jszip');

const {
  FIREBASE_API_KEY,
  FIREBASE_REFRESH_TOKEN,
  QUANTO_UID,
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  FECHA
} = process.env;

// ââ Helpers âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

function getYesterdayCST() {
  const nowCST = new Date(Date.now() - 6 * 3600 * 1000); // UTC-6 (CST El Salvador)
  const ayer  = new Date(nowCST.getTime() - 24 * 3600 * 1000);
  const yyyy  = ayer.getUTCFullYear();
  const mm    = String(ayer.getUTCMonth() + 1).padStart(2, '0');
  const dd    = String(ayer.getUTCDate()).padStart(2, '0');
  const meses = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
  return {
    fecha:    `${yyyy}-${mm}-${dd}`,
    ariaLabel: `${meses[ayer.getUTCMonth()]} ${ayer.getUTCDate()}, ${yyyy}`,
    month:    ayer.getUTCMonth(),  // 0-based
    year:     yyyy
  };
}

async function refreshFirebaseToken(refreshToken, apiKey) {
  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`
    }
  );
  const data = await res.json();
  if (!data.id_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
  console.log('â Token refrescado');
  return { idToken: data.id_token, newRefreshToken: data.refresh_token };
}

async function injectFirebaseAuth(page, uid, idToken, newRefreshToken, apiKey) {
  await page.evaluate(({ uid, idToken, newRefreshToken, apiKey }) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('firebaseLocalStorageDb', 1);
      req.onupgradeneeded = (e) => {
        e.target.result.createObjectStore('firebaseLocalStorage', { keyPath: 'fbase_key' });
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        const tx = db.transaction('firebaseLocalStorage', 'readwrite');
        const store = tx.objectStore('firebaseLocalStorage');
        store.put({
          fbase_key: `firebase:authUser:${apiKey}:[DEFAULT]`,
          value: {
            uid,
            email: 'freakiedogs@gmail.com',
            apiKey,
            appName: '[DEFAULT]',
            authDomain: 'admin.quantopos.com',
            stsTokenManager: {
              apiKey,
              refreshToken: newRefreshToken,
              accessToken: idToken,
              expirationTime: Date.now() + 3600000
            },
            redirectEventId: null
          }
        });
        tx.oncomplete = () => resolve();
        tx.onerror = (e) => reject(e.target.error);
      };
      req.onerror = (e) => reject(e.target.error);
    });
  }, { uid, idToken, newRefreshToken, apiKey });
}

async function navigateWithRouter(page, path) {
  await page.evaluate((p) => {
    window.history.pushState({}, '', p);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
  await page.waitForTimeout(3000);
}

async function setDateRangeFilter(page, ariaLabel, targetMonth, targetYear) {
  // Find and click the date range button/input to open the picker
  const meses = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];

  // Try to find a date range picker element
  const pickerOpened = await page.evaluate(() => {
    // Look for date-related buttons or inputs
    const candidates = [
      ...document.querySelectorAll('ion-datetime'),
      ...document.querySelectorAll('[class*="date"]'),
      ...document.querySelectorAll('ion-button[fill="outline"]'),
    ];
    // Click the first visible one that looks date-related
    for (const el of candidates) {
      const text = el.textContent || '';
      if (text.match(/\d{1,2}\/\d{1,2}\/\d{4}/) || el.tagName === 'ION-DATETIME') {
        el.click();
        return true;
      }
    }
    return false;
  });

  await page.waitForTimeout(1500);

  // Look for the calendar popup and navigate to the correct month if needed
  // Then click the target day twice (start + end)
  const clicked = await page.evaluate((ariaLabel) => {
    // Find calendar day with matching aria-label
    const dayBtn = document.querySelector(`[aria-label="${ariaLabel}"]`);
    if (!dayBtn) return false;
    dayBtn.click();
    setTimeout(() => dayBtn.click(), 300); // second click = end date
    return true;
  }, ariaLabel);

  if (!clicked) {
    console.warn(`â ï¸  No se encontrÃ³ el botÃ³n para fecha: ${ariaLabel}`);
    return false;
  }

  await page.waitForTimeout(1000);

  // Click confirm/apply button if present
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll('ion-button, button')];
    const confirmBtn = btns.find(b => {
      const t = b.textContent.trim().toLowerCase();
      return t === 'ok' || t === 'apply' || t === 'confirm' || t === 'aceptar' || t === 'aplicar';
    });
    if (confirmBtn) confirmBtn.click();
  });

  await page.waitForTimeout(2000);
  return true;
}

async function downloadAndCapture(page, buttonText) {
  // Intercept blob before clicking
  await page.evaluate(() => {
    window._capturedBlobs = {};
    const orig = URL.createObjectURL;
    URL.createObjectURL = function(blob) {
      const url = orig.call(URL, blob);
      const tag = blob.type && blob.type.includes('zip') ? 'zip' : 'other';
      blob.arrayBuffer().then(buf => {
        window._capturedBlobs[tag] = Array.from(new Uint8Array(buf));
      });
      return url;
    };
  });

  // Also set up Playwright download listener as fallback
  const downloadPromise = page.waitForEvent('download', { timeout: 20000 }).catch(() => null);

  // Click the button
  const clicked = await page.evaluate((text) => {
    const btns = [...document.querySelectorAll('ion-button, button')];
    const btn = btns.find(b => b.textContent.includes(text));
    if (btn) { btn.click(); return true; }
    return false;
  }, buttonText);

  if (!clicked) {
    console.warn(`â ï¸  BotÃ³n "${buttonText}" no encontrado`);
    return null;
  }

  // Try Playwright download first
  const download = await downloadPromise;
  if (download) {
    const zipPath = await download.path();
    console.log(`ð¥ ZIP descargado (Playwright): ${fs.statSync(zipPath).size} bytes`);
    return fs.readFileSync(zipPath);
  }

  // Fallback: wait for blob capture
  await page.waitForTimeout(3000);
  const blobData = await page.evaluate(() => window._capturedBlobs);
  if (blobData && blobData.zip && blobData.zip.length > 0) {
    console.log(`ð¥ ZIP capturado (blob): ${blobData.zip.length} bytes`);
    return Buffer.from(blobData.zip);
  }

  return null;
}

async function processDTEs(zipBuffer, supabaseUrl, supabaseKey) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const jsonFiles = Object.keys(zip.files).filter(f => f.endsWith('.json') && !zip.files[f].dir);
  console.log(`ð¦ ZIP contiene ${jsonFiles.length} archivos JSON`);

  let processed = 0, errors = 0, skipped = 0;
  const BATCH = 20;

  for (let i = 0; i < jsonFiles.length; i += BATCH) {
    const batch = jsonFiles.slice(i, i + BATCH);
    await Promise.all(batch.map(async (fname) => {
      try {
        const content = JSON.parse(await zip.files[fname].async('string'));
        const res = await fetch(`${supabaseUrl}/rest/v1/rpc/procesar_dte_json`, {
          method: 'POST',
          headers: {
            'apikey': supabaseKey,
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ p_dte: content })
        });
        if (res.status === 200 || res.status === 201) {
          processed++;
        } else if (res.status === 409) {
          skipped++; // duplicate
        } else {
          const err = await res.text();
          console.warn(`  â ${fname}: ${res.status} ${err.substring(0, 80)}`);
          errors++;
        }
      } catch (e) {
        console.warn(`  â ${fname}: ${e.message}`);
        errors++;
      }
    }));

    const done = Math.min(i + BATCH, jsonFiles.length);
    console.log(`  Progreso: ${done}/${jsonFiles.length} (â${processed} â­ï¸${skipped} â${errors})`);
  }

  return { total: jsonFiles.length, processed, skipped, errors };
}

// ââ Main âââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ

async function main() {
  // Validate env vars
  for (const [k, v] of Object.entries({ FIREBASE_API_KEY, FIREBASE_REFRESH_TOKEN, QUANTO_UID, SUPABASE_URL, SUPABASE_ANON_KEY })) {
    if (!v) throw new Error(`Missing env var: ${k}`);
  }

  const dateInfo = getYesterdayCST();
  const targetDate = FECHA || dateInfo.fecha;
  const [yr, mo, dy] = targetDate.split('-').map(Number);
  const meses = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
  const ariaLabel = `${meses[mo-1]} ${dy}, ${yr}`;

  console.log(`\nð Quanto Daily Download â ${targetDate}`);
  console.log(`   Aria label buscado: "${ariaLabel}"\n`);

  // 1. Refresh token
  const { idToken, newRefreshToken } = await refreshFirebaseToken(FIREBASE_REFRESH_TOKEN, FIREBASE_API_KEY);

  // 2. Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  // Optional: capture console logs for debugging
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('  [browser error]', msg.text().substring(0, 100));
  });

  try {
    // 3. Open QUANTO and inject auth
    console.log('ð Abriendo admin.quantopos.com...');
    await page.goto('https://admin.quantopos.com', { waitUntil: 'domcontentloaded', timeout: 30000 });

    console.log('ð Inyectando auth en IndexedDB...');
    await injectFirebaseAuth(page, QUANTO_UID, idToken, newRefreshToken, FIREBASE_API_KEY);

    // 4. Reload to pick up auth
    console.log('ð Recargando con auth...');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(4000);

    const domCount = await page.evaluate(() => document.querySelectorAll('*').length);
    console.log(`   DOM elements: ${domCount}`);
    if (domCount < 100) throw new Error('App no cargÃ³ correctamente despuÃ©s de inyectar auth');

    // 5. Navigate to /my-orders
    console.log('ð Navegando a /my-orders...');
    await navigateWithRouter(page, '/my-orders');

    const domAfterNav = await page.evaluate(() => document.querySelectorAll('*').length);
    console.log(`   DOM elements despuÃ©s de nav: ${domAfterNav}`);

    // 6. Set date filter
    console.log(`ð Configurando filtro de fecha: ${ariaLabel}...`);
    await setDateRangeFilter(page, ariaLabel, mo - 1, yr);

    // Wait for orders to load
    await page.waitForTimeout(3000);

    // 7. Download ZIP of DTEs
    console.log('â¬ï¸  Descargando ZIP de DTEs...');
    const zipBuffer = await downloadAndCapture(page, 'Descargar archivos JSON');

    if (!zipBuffer || zipBuffer.length < 100) {
      throw new Error('ZIP no descargado o vacÃ­o');
    }

    // 8. Process DTEs into Supabase
    console.log('\nâï¸  Procesando DTEs en Supabase...');
    const result = await processDTEs(zipBuffer, SUPABASE_URL, SUPABASE_ANON_KEY);

    console.log(`\nâ COMPLETADO â ${targetDate}`);
    console.log(`   Total:    ${result.total} DTEs`);
    console.log(`   Nuevos:   ${result.processed}`);
    console.log(`   Duplicados: ${result.skipped}`);
    console.log(`   Errores:  ${result.errors}`);

  } finally {
    await browser.close();
  }
}

main().catch(e => {
  console.error('\nâ Error fatal:', e.message);
  console.error(e.stack);
  process.exit(1);
});
