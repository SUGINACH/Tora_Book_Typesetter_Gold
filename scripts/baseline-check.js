/* ==========================================================================
   baseline-check.js — בדיקת baseline למערכת העימוד התורנית
   --------------------------------------------------------------------------
   מטרה: לוודא שהמערכת עולה, נטענת, ומסוגלת לעבד טקסט קצר ללא שגיאות.
   אינו מחליף את regression-test.js המלא — רק ספגט כניסה בסיסי.

   שימוש:
     node /home/z/my-project/scripts/baseline-check.js
   דרוש: שרת HTTP על פורט 8765 שמשרת את שורש הפרויקט
   ========================================================================== */

const { chromium } = require('playwright');

const BASE_URL = 'http://localhost:8765/index.html';
const SHORT_TEXT = `פרק נאשון

זוהי פסקת פתיחה נאשונה הכוללת מספר מילים כדי לבדוק שהעימוד עובד. אנחנו רוצים לראות שהמערכת מסוגלת לפרסר טקסט לעמודים ללא שגיאות. זוהי פסקה נוספת כדי שיהיה מספיק תוכן למלא לפחות עמוד אחד.

עוד פסקה כאן עם תוכן כלשהו. אנחנו רוצים לוודא שהעימוד מתבצע, הטורים מתאזנים, ואין שגיאות בקונסול. גם כדי לראות שגופנים נטענים כראוי.

# כותרת נאשית

פסקה תחת כותרת. המערכת צריכה לטפל בכותרות ובפסקאות יחד. בואו נראה אם זה עובד.

## כותרת משנה

עוד פסקה תחת כותרת משנה. המערכת צריכה לזהות את רמות הכותרות השונות ולטפל בהן בהתאם.

### כותרת משנה נוספת

פסקה אחרונה לבדיקה. מקווים שהכל עובד כשורה ואין שגיאות.`;

const TIMEOUT_MS = 60000;

(async () => {
  let browser;
  let exitCode = 0;

  try {
    console.log('[baseline-check] מפעיל דפדפן Chromium...');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1000 },
    });
    const page = await context.newPage();

    // איסוף שגיאות קונסול
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', (err) => {
      pageErrors.push(err.message);
    });

    console.log('[baseline-check] טוען את index.html...');
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: TIMEOUT_MS });

    // המתנה ל-iframe להיות מוכן
    console.log('[baseline-check] ממתין ל-renderer iframe...');
    await page.waitForFunction(
      () => {
        return window.document.querySelector('iframe#renderer-frame') !== null;
      },
      { timeout: 15000 }
    ).catch(() => {
      // fallback: לחפש כל iframe
      return page.waitForFunction(
        () => window.document.querySelector('iframe') !== null,
        { timeout: 5000 }
      );
    });

    // המתנה נוספת לטעינת גופנים
    console.log('[baseline-check] ממתין לטעינת גופנים (3s)...');
    await page.waitForTimeout(3000);

    // בדיקה שה-iframe מגיב
    const iframeInfo = await page.evaluate(() => {
      const iframe = document.querySelector('iframe#renderer-frame') ||
                     document.querySelector('iframe');
      if (!iframe) return { found: false };
      try {
        const doc = iframe.contentDocument;
        return {
          found: true,
          hasDoc: !!doc,
          readyState: doc ? doc.readyState : 'n/a',
          hasContent: doc ? !!doc.body : false,
        };
      } catch (e) {
        return { found: true, error: e.message };
      }
    });
    console.log('[baseline-check] iframe info:', iframeInfo);

    // רישום הודעות מ-iframe
    page.on('message', (msg) => {
      console.log('[iframe msg]', msg.type || '(unknown)');
    });

    // הזרקת טקסט קצר לעורך
    console.log('[baseline-check] מזריק טקסט קצר לעורך...');
    const injectResult = await page.evaluate((text) => {
      const candidates = [
        '#editor-textarea',
        '#text-editor',
        '[contenteditable="true"]',
        'textarea',
      ];
      let editor = null;
      for (const sel of candidates) {
        editor = document.querySelector(sel);
        if (editor) break;
      }
      if (!editor) {
        return { ok: false, reason: 'editor not found', candidates_tried: candidates };
      }
      const tag = editor.tagName.toLowerCase();
      if (tag === 'textarea' || tag === 'input') {
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        )?.value || Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.value;
        if (nativeSetter) nativeSetter.call(editor, text);
        else editor.value = text;
        editor.dispatchEvent(new Event('input', { bubbles: true }));
        editor.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        editor.textContent = text;
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, data: text }));
      }
      return { ok: true, tag, id: editor.id };
    }, SHORT_TEXT);
    console.log('[baseline-check] תוצאת הזרקה:', injectResult);

    if (!injectResult.ok) {
      console.log('[baseline-check] לא הצלחתי להזריק טקסט — מנסה דרך ישירה ל-iframe...');
      // fallback: שליחת הודעה ישירות ל-iframe
      await page.evaluate((text) => {
        const iframe = document.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
          iframe.contentWindow.postMessage(
            { type: 'set-text', text: text },
            '*'
          );
        }
      }, SHORT_TEXT);
    }

    // הפעלת עימוד
    await page.waitForTimeout(500);
    console.log('[baseline-check] מפעיל typesetDocument()...');
    const result = await page.evaluate(() => {
      try {
        if (typeof typesetDocument === 'function') {
          typesetDocument();
          return { ok: true, msg: 'typesetDocument() called' };
        }
        return { ok: false, msg: 'typesetDocument not a function' };
      } catch (e) {
        return { ok: false, msg: e.message };
      }
    });
    console.log('[baseline-check] תוצאת הפעלה:', result);

    // המתנה לסיום עימוד
    console.log('[baseline-check] ממתין לסיום עימוד (10s timeout)...');
    await page.waitForTimeout(10000);

    // בדיקת מספר עמודים ב-iframe
    const stats = await page.evaluate(() => {
      const iframe = document.querySelector('iframe#renderer-frame') ||
                     document.querySelector('iframe');
      if (!iframe || !iframe.contentDocument) {
        return { iframe: false };
      }
      const doc = iframe.contentDocument;
      const pages = doc.querySelectorAll('.page, .a4-page, [data-page]');
      const blocks = doc.querySelectorAll('.block-2col, .block');
      const cols = doc.querySelectorAll('.right-col, .left-col');
      const bodyText = (doc.body?.innerText || '').slice(0, 200);
      return {
        iframe: true,
        pageCount: pages.length,
        blockCount: blocks.length,
        colCount: cols.length,
        bodyTextPreview: bodyText,
        hasContent: bodyText.length > 0,
      };
    });
    console.log('[baseline-check] סטטיסטיקות:', JSON.stringify(stats, null, 2));

    // דוח שגיאות
    console.log('');
    console.log('=== דוח שגיאות ===');
    console.log(`Console errors: ${consoleErrors.length}`);
    consoleErrors.slice(0, 10).forEach((e, i) => console.log(`  [${i + 1}] ${e}`));
    console.log(`Page errors: ${pageErrors.length}`);
    pageErrors.slice(0, 10).forEach((e, i) => console.log(`  [${i + 1}] ${e}`));

    // החלטת הצלחה/כישלון
    if (pageErrors.length > 0) {
      exitCode = 1;
      console.log('\n[baseline-check] ✗ נכשל: שגיאות page-error התגלו');
    } else if (!stats.iframe) {
      exitCode = 1;
      console.log('\n[baseline-check] ✗ נכשל: iframe לא זמין');
    } else if (stats.pageCount === 0) {
      exitCode = 1;
      console.log('\n[baseline-check] ✗ נכשל: לא נוצרו עמודים ב-iframe');
    } else {
      console.log(`\n[baseline-check] ✓ עבר: נוצרו ${stats.pageCount} עמודים, ${stats.blockCount} בלוקים`);
    }
  } catch (err) {
    console.error('[baseline-check] שגיאה:', err.message);
    console.error(err.stack);
    exitCode = 2;
  } finally {
    if (browser) await browser.close();
    process.exit(exitCode);
  }
})();
