/* ==========================================================================
   test-chapters-enhanced.js — בדיקת טווח פרקים למערכת העימוד התורנית
   --------------------------------------------------------------------------
   שימוש:
     node test-chapters-enhanced.js START END [LABEL]
   דוגמא:
     node test-chapters-enhanced.js 1 5 batch-1-5
     node test-chapters-enhanced.js 35 35 focus-ch35

   מה הסקריפט עושה:
   1. פותח very_long_test_text.txt ומפצל אותו ל-79 פרקים לפי סמני "כותרת 2 מספר N"
   2. מפעיל דפדפן Chromium (headless), טוען את index.html מ-http://localhost:8765
   3. לכל פרק בטווח [START, END]:
      a. מזריק את הטקסט של הפרק ל-#raw-input
      b. שולח הודעת 'typeset' ל-iframe (render-frame)
      c. ממתין ל-'render-done' עם pageCount
      d. שולח 'geom-audit' ל-iframe
      e. ממתין ל-'geom-audit-result' עם {summary, issues, stats}
      f. שומר תוצאה ל-../Tora_Book_Typesetter_Gold/scripts/chapter-results/chapter-N.json
   4. רענון browser כל 5 פרקים (מונע דליפות זיכרון)
   5. מדפיס טבלת סיכום בסוף

   דרוש: שרת HTTP על פורט 8765 (Python: python3 -m http.server 8765)
   ========================================================================== */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/index.html';
const TEST_TEXT_PATH = process.env.TEST_TEXT_PATH || path.join(__dirname, '..', 'very_long_test_text.txt');
const RESULTS_DIR = process.env.RESULTS_DIR || path.join(__dirname, 'chapter-results');

// [תיקון — C1] הפחתת תדירות רענון מ-5 ל-3 פרקים כדי למנוע קריסות דפדפן אינטרמיטנטיות
// (פרקים 5, 71, 75 דווחו כבעייתיים ב-SESSION_HANDOFF). רענון תכוף יותר משחרר זיכרון
// ומונע הצטברות GC שיכולה לגרום ל-timeout/crash.
const RESTART_EVERY_N_CHAPTERS = 3;
const TYPESCRIPT_TIMEOUT_MS = 180000; // 3 דקות לפרק (פרקים ענקיים לוקחים זמן)
const GEOM_AUDIT_TIMEOUT_MS = 30000;

// ============================================================================
// CLI args
// ============================================================================
const argv = process.argv.slice(2);
if (argv.length < 2) {
  console.error('Usage: node test-chapters-enhanced.js START END [LABEL]');
  console.error('  START — מספר פרק התחלתי (1-based, לפי סדר הופעת H2)');
  console.error('  END   — מספר פרק סופי (כולל)');
  console.error('  LABEL — תווית לקובץ הסיכום (אופציונלי, ברירת מחדל: "batch-START-END")');
  process.exit(2);
}
const START = parseInt(argv[0], 10);
const END = parseInt(argv[1], 10);
const LABEL = argv[2] || `batch-${START}-${END}`;

if (!Number.isInteger(START) || !Number.isInteger(END) || START < 1 || END < START) {
  console.error('טעות: START ו-END חייבים להיות מספרים שלמים, START>=1, END>=START');
  process.exit(2);
}

// ============================================================================
// 1. פיצול הטקסט לפרקים לפי סמני H2
// ============================================================================
function splitTextIntoChapters(text) {
  const lines = text.split('\n');
  const chapters = [];
  let currentChapter = null;
  let currentStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // סמן פרק: "כותרת 2 מספר X" (H2 = chapter start)
    const m = line.match(/^כותרת 2 מספר\s+\d+/);
    if (m) {
      if (currentChapter !== null) {
        currentChapter.text = lines.slice(currentStartLine, i).join('\n');
        currentChapter.endLine = i - 1;
        chapters.push(currentChapter);
      }
      currentChapter = {
        chapterNum: chapters.length + 1,
        startLine: i,
        endLine: null,
        title: line.trim(),
        text: null,
      };
      currentStartLine = i;
    }
  }
  // אחרון
  if (currentChapter !== null) {
    currentChapter.text = lines.slice(currentStartLine).join('\n');
    currentChapter.endLine = lines.length - 1;
    chapters.push(currentChapter);
  }
  return chapters;
}

console.log(`[test-chapters-enhanced] טוען טקסט מ-${TEST_TEXT_PATH}`);
const testText = fs.readFileSync(TEST_TEXT_PATH, 'utf8');
console.log(`[test-chapters-enhanced] אורך טקסט: ${testText.length} chars`);
const chapters = splitTextIntoChapters(testText);
console.log(`[test-chapters-enhanced] זוהו ${chapters.length} פרקים (לפי H2 markers)`);

if (END > chapters.length) {
  console.error(`טעות: END=${END} גדול ממספר הפרקים הכולל (${chapters.length})`);
  process.exit(2);
}

// ודא שתיקיית תוצאות קיימת
if (!fs.existsSync(RESULTS_DIR)) {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
}

// ============================================================================
// 2. הרצת בדיקות
// ============================================================================
(async () => {
  let browser = null;
  let page = null;
  const results = [];

  async function launchBrowser() {
    if (browser) await browser.close();
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1400, height: 1000 },
    });
    page = await context.newPage();

    // רישום page errors
    page.on('pageerror', (err) => {
      console.error(`  [page-error] ${err.message}`);
    });

    console.log(`[test-chapters-enhanced] טוען ${BASE_URL}`);
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });

    // המתנה ל-iframe להיות מוכן
    await page.waitForFunction(
      () => !!document.querySelector('iframe#render-frame'),
      { timeout: 15000 }
    );

    // המתנה להודעת renderer-ready
    await page.waitForFunction(
      () => window.__rendererReady === true || document.querySelector('iframe#render-frame')?.contentWindow,
      { timeout: 15000 }
    ).catch(() => {});

    // המתנה נוספת לטעינת גופנים
    await page.waitForTimeout(3000);
  }

  // פונקציית עזר: שולחת postMessage ל-iframe ומחזירה את התשובה
  // מאזינה גם לסוגי שגיאה: ${responseType}-error ו-error-גנרי
  async function sendIframeMessage(requestType, payload, responseType, timeoutMs) {
    return await page.evaluate(
      async ({ requestType, payload, responseType, timeoutMs }) => {
        const iframe = document.querySelector('iframe#render-frame');
        if (!iframe || !iframe.contentWindow) {
          throw new Error('iframe not found');
        }
        // סוגי תשובה אפשריים: הרגיל + שגיאות
        const okTypes = new Set([responseType]);
        const errorTypes = new Set([
          responseType + '-error',
          responseType.replace(/-result$/, '-error'),
          'render-error',
          'geom-error',
        ]);
        return await new Promise((resolve, reject) => {
          const handler = (e) => {
            const msg = e.data;
            if (!msg || !msg.type) return;
            if (okTypes.has(msg.type)) {
              window.removeEventListener('message', handler);
              clearTimeout(timer);
              resolve(msg);
            } else if (errorTypes.has(msg.type)) {
              window.removeEventListener('message', handler);
              clearTimeout(timer);
              const errMsg = msg.error || msg.stack || ('unknown ' + msg.type);
              reject(new Error(`iframe error (${msg.type}): ${errMsg}`));
            }
          };
          window.addEventListener('message', handler);
          const timer = setTimeout(() => {
            window.removeEventListener('message', handler);
            reject(new Error(`timeout waiting for ${responseType} (${timeoutMs}ms)`));
          }, timeoutMs);

          const fullMsg = { type: requestType, ...payload };
          iframe.contentWindow.postMessage(fullMsg, '*');
        });
      },
      { requestType, payload, responseType, timeoutMs }
    );
  }

  // פונקציית עזר: מזריק טקסט ל-#raw-input
  async function injectText(text) {
    await page.evaluate((t) => {
      const el = document.getElementById('raw-input');
      if (!el) throw new Error('#raw-input not found');
      // raw-input הוא contenteditable — לכן innerText (לא value)
      // אבל הקוד ב-renderer-bridge.js בודק 'value' in el — אז נסה שתי דרכים
      if ('value' in el && typeof el.value === 'string') {
        // textarea/input
        const nativeSetter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value'
        );
        if (nativeSetter && nativeSetter.set) {
          nativeSetter.set.call(el, t);
        } else {
          el.value = t;
        }
      } else {
        // contenteditable
        el.innerText = t;
        el.dispatchEvent(new InputEvent('input', { bubbles: true, data: t }));
      }
    }, text);
  }

  for (let chapterNum = START; chapterNum <= END; chapterNum++) {
    const idx = chapterNum - 1;
    const chapter = chapters[idx];

    // רענן browser כל N פרקים (למניעת דליפות זיכרון)
    if ((chapterNum - START) > 0 && (chapterNum - START) % RESTART_EVERY_N_CHAPTERS === 0) {
      console.log(`\n[test-chapters-enhanced] רענון browser (כל ${RESTART_EVERY_N_CHAPTERS} פרקים)...`);
      try {
        await launchBrowser();
      } catch (e) {
        console.error(`  שגיאה ברענון: ${e.message}`);
        continue;
      }
    } else if (browser === null) {
      await launchBrowser();
    }

    const chapterLen = chapter.text.length;
    const lineCount = chapter.text.split('\n').length;
    console.log(`\n[test-chapters-enhanced] פרק ${chapterNum}/${END}: "${chapter.title.slice(0, 60)}" (${chapterLen} chars, ${lineCount} lines)`);

    const chapterResult = {
      chapterNum,
      title: chapter.title,
      textLength: chapterLen,
      lineCount,
      startLine: chapter.startLine + 1, // 1-based
      endLine: chapter.endLine + 1,
      label: LABEL,
      timestamp: new Date().toISOString(),
      pageCount: 0,
      geomSummary: null,
      geomIssues: null,
      geomStats: null,
      highSeverityIssues: [],
      error: null,
    };

    try {
      // קבל reference ל-iframe של render-frame
      const iframe = page.frame({ name: 'render-frame' }) || page.frames().find((f) => f !== page.mainFrame());
      if (!iframe) {
        throw new Error('render-frame iframe not found');
      }

      // אסוף הגדרות מהאב — הן כוללות הגדרות עימוד, גופנים, וכו'
      // [חדש] אם ENABLE_PAGE_HEIGHT=1, הפעל את page-height לפני איסוף ההגדרות
      if (process.env.ENABLE_PAGE_HEIGHT === '1') {
        await page.evaluate((max) => {
          const cb = document.getElementById('aq-page-height');
          if (cb) cb.checked = true;
          if (max) {
            const mx = document.getElementById('aq-page-height-max');
            if (mx) mx.value = String(max);
          }
        }, process.env.PAGE_HEIGHT_MAX || '15');
      }
      const settings = await page.evaluate(() => {
        if (typeof collectAllSettingsForRenderer === 'function') {
          return collectAllSettingsForRenderer();
        }
        return {};
      });

      // שלח הודעת typeset ל-iframe עם text + settings, והמתן ל-render-done
      // נשתמש ב-window.postMessage מהאב ל-iframe
      const renderResult = await page.evaluate(
        async ({ chapterText, settings }) => {
          return await new Promise((resolve, reject) => {
            const iframe = document.querySelector('iframe#render-frame');
            if (!iframe || !iframe.contentWindow) {
              reject(new Error('iframe not found in parent'));
              return;
            }
            const handler = (e) => {
              const msg = e.data;
              if (!msg || !msg.type) return;
              if (msg.type === 'render-done') {
                window.removeEventListener('message', handler);
                clearTimeout(timer);
                resolve({ pageCount: msg.pageCount || 0 });
              } else if (msg.type === 'render-error') {
                window.removeEventListener('message', handler);
                clearTimeout(timer);
                reject(new Error(`render-error: ${msg.error}`));
              }
            };
            window.addEventListener('message', handler);
            const timer = setTimeout(() => {
              window.removeEventListener('message', handler);
              reject(new Error('timeout waiting for render-done (180s)'));
            }, 180000);
            // שלח הודעת typeset ל-iframe
            iframe.contentWindow.postMessage(
              { type: 'typeset', text: chapterText, settings: settings },
              '*'
            );
          });
        },
        { chapterText: chapter.text, settings }
      );

      chapterResult.pageCount = renderResult.pageCount || 0;
      console.log(`  ✓ עמודים: ${chapterResult.pageCount}`);

      // המתנה קצרה ל-stabilization
      await page.waitForTimeout(500);

      // חישוב גיאומטריה דרך window.__geomAudit ב-iframe
      const geomResult = await iframe.evaluate(() => {
        return new Promise((resolve, reject) => {
          if (!window.__geomAudit) {
            reject(new Error('window.__geomAudit not available in iframe'));
            return;
          }
          try {
            const model = window.__geomAudit.extract();
            const audit = window.__geomAudit.audit(model);
            resolve({
              summary: audit.summary,
              issues: audit.issues,
              stats: model.stats,
            });
          } catch (e) {
            reject(e);
          }
        });
      });

      chapterResult.geomSummary = geomResult.summary;
      chapterResult.geomIssues = geomResult.issues;
      chapterResult.geomStats = geomResult.stats;

      const s = geomResult.summary || {};
      console.log(`  ✓ גיאוממטריה: total=${s.total || 0}, high=${s.high || 0}, medium=${s.medium || 0}, low=${s.low || 0}`);

      // שמור רק high severity להדפסה
      if (geomResult.issues) {
        chapterResult.highSeverityIssues = geomResult.issues.filter((i) => i.severity === 'high');
      }
    } catch (err) {
      chapterResult.error = err.message;
      console.error(`  ✗ שגיאה: ${err.message}`);
    }

    results.push(chapterResult);

    // שמור קובץ תוצאה לפרק
    const resultPath = path.join(RESULTS_DIR, `chapter-${String(chapterNum).padStart(2, '0')}.json`);
    fs.writeFileSync(resultPath, JSON.stringify(chapterResult, null, 2));
  }

  if (browser) await browser.close();

  // ============================================================================
  // 3. סיכום
  // ============================================================================
  console.log('\n\n========== סיכום ==========\n');
  console.log('פרק | עמודים | total | high | med | low | הערה');
  console.log('-----|--------|-------|------|-----|-----|------');
  let totalHigh = 0;
  let totalMed = 0;
  let totalLow = 0;
  let totalChaptersWithErrors = 0;
  for (const r of results) {
    const s = r.geomSummary || { total: 0, high: 0, medium: 0, low: 0 };
    const note = r.error ? `שגיאה: ${r.error.slice(0, 30)}` : (r.highSeverityIssues.length > 0 ? `${r.highSeverityIssues.length} high issues` : 'OK');
    console.log(
      `${String(r.chapterNum).padStart(4)} | ${String(r.pageCount).padStart(6)} | ${String(s.total || 0).padStart(5)} | ${String(s.high || 0).padStart(4)} | ${String(s.medium || 0).padStart(3)} | ${String(s.low || 0).padStart(3)} | ${note}`
    );
    totalHigh += s.high || 0;
    totalMed += s.medium || 0;
    totalLow += s.low || 0;
    if (r.error) totalChaptersWithErrors++;
  }

  console.log('\nסה"כ:');
  console.log(`  high:   ${totalHigh}`);
  console.log(`  medium: ${totalMed}`);
  console.log(`  low:    ${totalLow}`);
  console.log(`  פרקים עם שגיאות runtime: ${totalChaptersWithErrors}/${results.length}`);

  // שמור סיכום מצטבר
  const summaryPath = path.join(RESULTS_DIR, `${LABEL}-summary.json`);
  const summary = {
    label: LABEL,
    startChapter: START,
    endChapter: END,
    timestamp: new Date().toISOString(),
    totals: { high: totalHigh, medium: totalMed, low: totalLow, errors: totalChaptersWithErrors },
    chapters: results.map((r) => ({
      chapterNum: r.chapterNum,
      title: r.title,
      pageCount: r.pageCount,
      summary: r.geomSummary,
      error: r.error,
    })),
  };
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nסיכום נשמר: ${summaryPath}`);

  // קוד יציאה: 1 אם יש high severity מעל סף
  process.exit(totalHigh > 0 ? 1 : 0);
})();
