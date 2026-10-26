/* ==========================================================================
   determinism-test.js — בדיקת יציבות (determinism) של מנוע העימוד
   --------------------------------------------------------------------------
   מטרה עיקרית: וידוא ששינויי קוד (שלא נועדו להשפיע על העימוד) אכן לא משפיעים.
   
   תרחיש שימוש:
   1. מפתח משנה קוד ב-typesetter.js / geometry-audit.js / style.css
      (למשל: הוספת פונקציה חדשה, שינוי comment, רפקטורינג)
   2. לפני ה-commit, מריץ determinism-test כדי לוודא שהשינוי לא השפיע על העימוד
   3. אם התוצאות זהות לפני ואחרי — השינוי בטוח
   4. אם יש הבדל — השינוי השפיע בטעות על העימוד

   אופן פעולה:
   - מריץ את אותו פרק N פעמים (עם browser חדש כל פעם)
   - משווה pageCount ו-summary (high/medium/low)
   - אם יש הבדל — יש non-determinism

   שימוש:
     node determinism-test.js [CHAPTER_NUM] [RUNS]
     node determinism-test.js 9 5      # פרק 9, 5 ריצות
     node determinism-test.js           # ברירת מחדל: פרק 9, 3 ריצות

   השוואת baseline (לודאי ששינויי קוד לא משפיעים):
     # לפני השינוי — שמור baseline:
     node determinism-test.js 9 3 > baseline.txt
     
     # בצע את השינוי בקוד
     
     # אחרי השינוי — השווה:
     node determinism-test.js 9 3 > after.txt
     diff baseline.txt after.txt

   דרוש: שרת HTTP על פורט 8765 + טקסט בדיקה very_long_test_text.txt
   ========================================================================== */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/index.html';
const TEST_TEXT_PATH = process.env.TEST_TEXT_PATH || path.join(__dirname, '..', 'very_long_test_text.txt');

function splitTextIntoChapters(text) {
  const lines = text.split('\n');
  const chapters = [];
  let cur = null, curStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (/^כותרת 2 מספר/.test(lines[i])) {
      if (cur) { cur.text = lines.slice(curStart, i).join('\n'); chapters.push(cur); }
      cur = { chapterNum: chapters.length + 1, startLine: i, text: null, title: lines[i].trim() };
      curStart = i;
    }
  }
  if (cur) { cur.text = lines.slice(curStart).join('\n'); chapters.push(cur); }
  return chapters;
}

const argv = process.argv.slice(2);
const CHAPTER_NUM = parseInt(argv[0] || '9', 10);
const RUNS = parseInt(argv[1] || '3', 10);

(async () => {
  console.log(`[determinism-test] פרק ${CHAPTER_NUM}, ${RUNS} ריצות\n`);

  const text = fs.readFileSync(TEST_TEXT_PATH, 'utf8');
  const chapters = splitTextIntoChapters(text);
  if (CHAPTER_NUM < 1 || CHAPTER_NUM > chapters.length) {
    console.error(`טעות: CHAPTER_NUM=${CHAPTER_NUM} לא בטווח 1..${chapters.length}`);
    process.exit(2);
  }
  const ch = chapters[CHAPTER_NUM - 1];
  console.log(`פרק ${CHAPTER_NUM}: "${ch.title.slice(0, 60)}"`);
  console.log(`אורך: ${ch.text.length} chars\n`);

  const results = [];

  for (let run = 1; run <= RUNS; run++) {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !!document.querySelector('iframe#render-frame'), { timeout: 15000 });
    await page.waitForTimeout(3000);
    const iframe = page.frame({ name: 'render-frame' }) || page.frames().find((f) => f !== page.mainFrame());

    // typeset
    let pageCount, geomSummary;
    try {
      const renderResult = await page.evaluate(async ({ chapterText }) => {
        return await new Promise((res, rej) => {
          const f = document.querySelector('iframe#render-frame');
          const h = (e) => {
            if (e.data?.type === 'render-done') { window.removeEventListener('message', h); clearTimeout(timer); res({ pageCount: e.data.pageCount || 0 }); }
            else if (e.data?.type === 'render-error') { window.removeEventListener('message', h); clearTimeout(timer); rej(new Error(e.data.error)); }
          };
          window.addEventListener('message', h);
          const timer = setTimeout(() => { window.removeEventListener('message', h); rej(new Error('timeout')); }, 180000);
          const s = (typeof collectAllSettingsForRenderer === 'function') ? collectAllSettingsForRenderer() : {};
          f.contentWindow.postMessage({ type: 'typeset', text: chapterText, settings: s }, '*');
        });
      }, { chapterText: ch.text });
      pageCount = renderResult.pageCount;
      await page.waitForTimeout(500);

      geomSummary = await iframe.evaluate(() => {
        if (!window.__geomAudit) return null;
        const model = window.__geomAudit.extract();
        const audit = window.__geomAudit.audit(model);
        return audit.summary;
      });
    } catch (e) {
      console.log(`Run ${run}: ERROR — ${e.message}`);
      results.push({ run, error: e.message });
      await browser.close();
      continue;
    }

    console.log(`Run ${run}/${RUNS}: pages=${pageCount}, summary=${JSON.stringify(geomSummary)}`);
    results.push({ run, pageCount, summary: geomSummary });
    await browser.close();
  }

  // Compare results
  console.log('\n=== השוואת תוצאות ===');
  const pageCounts = results.filter(r => r.pageCount).map(r => r.pageCount);
  const summaries = results.filter(r => r.summary).map(r => JSON.stringify(r.summary));

  const uniquePages = new Set(pageCounts);
  const uniqueSummaries = new Set(summaries);

  console.log(`pageCounts: ${pageCounts.join(', ')}`);
  console.log(`unique page counts: ${uniquePages.size}`);
  console.log(`unique summaries: ${uniqueSummaries.size}`);

  if (uniquePages.size === 1 && uniqueSummaries.size === 1) {
    console.log('\n✓ יציב (deterministic) — כל הריצות זהות');
    process.exit(0);
  } else {
    console.log('\n✗ לא יציב (non-deterministic) — יש הבדלים בין ריצות');
    if (uniquePages.size > 1) console.log('  ⚠ מספר עמודים שונה');
    if (uniqueSummaries.size > 1) console.log('  ⚠ summary שונה');
    process.exit(1);
  }
})().catch(e => { console.error('שגיאה:', e.message); process.exit(2); });
