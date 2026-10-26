/* ==========================================================================
   step-by-step-audit.js — בדיקה גיאומממטרית שלב-אחר-שלב
   --------------------------------------------------------------------------
   מטרה: לבודד פרק עם בעיות גיאומממטריות, לעמד אותו לבד, ולהריץ
   בדיקה גיאומממטרית אחרי כל שלב של פונקציית העימוד — כדי לזהות
   בדיוק באיזה שלב הבעיה נוצרת או מתוקנת.

   שלבי העימוד הנבדקים:
   1. after-initial-layout — אחרי הלולאה הראשית (מילוי עמודים)
   2. after-cross-paragraph-parens — אחרי עיטוף סוגריים חוצי פסקאות
   3. after-rebalance2 — אחרי rebalance גלובלי
   4. after-page-height — אחרי page-height adjustment

   שימוש:
     node step-by-step-audit.js [CHAPTER_NUM]
     node step-by-step-audit.js 9           # פרק 9
     node step-by-step-audit.js             # ברירת מחדל: פרק 9

   דרוש: שרת HTTP על פורט 8765 + very_long_test_text.txt
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

(async () => {
  console.log(`[step-by-step-audit] פרק ${CHAPTER_NUM}\n`);

  const text = fs.readFileSync(TEST_TEXT_PATH, 'utf8');
  const chapters = splitTextIntoChapters(text);
  if (CHAPTER_NUM < 1 || CHAPTER_NUM > chapters.length) {
    console.error(`טעות: CHAPTER_NUM=${CHAPTER_NUM} לא בטווח 1..${chapters.length}`);
    process.exit(2);
  }
  const ch = chapters[CHAPTER_NUM - 1];
  console.log(`כותרת: "${ch.title.slice(0, 60)}"`);
  console.log(`אורך: ${ch.text.length} chars\n`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
  await page.waitForFunction(() => !!document.querySelector('iframe#render-frame'), { timeout: 15000 });
  await page.waitForTimeout(3000);
  const iframe = page.frame({ name: 'render-frame' }) || page.frames().find((f) => f !== page.mainFrame());

  // הפעל מצב step-by-step audit ב-iframe
  await iframe.evaluate(() => {
    window.__stepByStepAudit = true;
  });

  // שלח טקסט + הגדרות
  const settings = await page.evaluate(() => {
    if (typeof collectAllSettingsForRenderer === 'function') return collectAllSettingsForRenderer();
    return {};
  });

  const renderResult = await page.evaluate(async ({ chapterText, settings }) => {
    return await new Promise((res, rej) => {
      const f = document.querySelector('iframe#render-frame');
      const h = (e) => {
        if (e.data?.type === 'render-done') { window.removeEventListener('message', h); clearTimeout(timer); res({ pageCount: e.data.pageCount || 0 }); }
        else if (e.data?.type === 'render-error') { window.removeEventListener('message', h); clearTimeout(timer); rej(new Error(e.data.error)); }
      };
      window.addEventListener('message', h);
      const timer = setTimeout(() => { window.removeEventListener('message', h); rej(new Error('timeout')); }, 180000);
      f.contentWindow.postMessage({ type: 'typeset', text: chapterText, settings }, '*');
    });
  }, { chapterText: ch.text, settings });

  await page.waitForTimeout(500);

  // קרא את ה-checkpoints
  const checkpoints = await iframe.evaluate(() => window.__auditCheckpoints || []);

  console.log(`עמודים: ${renderResult.pageCount}`);
  console.log(`Checkpoints: ${checkpoints.length}\n`);

  // נתח כל checkpoint
  console.log('=== ניתוח שלב-אחר-שלב ===\n');

  for (const cp of checkpoints) {
    console.log(`--- ${cp.stage} ---`);
    console.log(`  summary: ${JSON.stringify(cp.summary)}`);
    if (cp.issues.length === 0) {
      console.log(`  issues: (none)`);
    } else {
      // קבץ לפי kind
      const byKind = {};
      for (const iss of cp.issues) {
        if (!byKind[iss.kind]) byKind[iss.kind] = [];
        byKind[iss.kind].push(iss);
      }
      for (const [kind, issues] of Object.entries(byKind)) {
        const sevCount = {};
        for (const i of issues) { sevCount[i.severity] = (sevCount[i.severity] || 0) + 1; }
        console.log(`  ${kind}: ${issues.length} (${JSON.stringify(sevCount)})`);
        // הצג עד 3 דוגמאות
        for (const i of issues.slice(0, 3)) {
          console.log(`    [${i.severity}] page ${((i.pageIdx ?? -1) >= 0 ? i.pageIdx + 1 : '?')}: ${i.message}`);
        }
        if (issues.length > 3) console.log(`    ... ועוד ${issues.length - 3}`);
      }
    }
    console.log('');
  }

  // ניתוח התפתחות בעיות — איזה בעיה מתייקה/נעלמת
  console.log('=== התפתחות בעיות לפי kind ===\n');
  const allKinds = new Set();
  for (const cp of checkpoints) {
    for (const iss of cp.issues) allKinds.add(iss.kind);
  }

  console.log('kind'.padEnd(25) + checkpoints.map(cp => cp.stage.slice(0, 20).padEnd(22)).join(''));
  for (const kind of allKinds) {
    let row = kind.padEnd(25);
    for (const cp of checkpoints) {
      const count = cp.issues.filter(i => i.kind === kind).length;
      row += String(count).padEnd(22);
    }
    console.log(row);
  }

  // סיכום — באיזה שלב נוצרה כל בעיה high
  console.log('\n=== בעיות high — מתי נוצרו ===\n');
  for (const cp of checkpoints) {
    const highIssues = cp.issues.filter(i => i.severity === 'high');
    if (highIssues.length > 0) {
      console.log(`${cp.stage}: ${highIssues.length} high`);
      for (const i of highIssues) {
        console.log(`  ${i.kind} page ${((i.pageIdx ?? -1) >= 0 ? i.pageIdx + 1 : '?')}: ${i.message}`);
      }
    }
  }

  // השוואה: בעיות בתחילית (initial layout) מול סוף (final)
  if (checkpoints.length >= 2) {
    const first = checkpoints[0];
    const last = checkpoints[checkpoints.length - 1];
    console.log('\n=== השוואת התחלה → סוף ===\n');
    console.log(`התחלה (${first.stage}): total=${first.summary.total}, high=${first.summary.high}, med=${first.summary.medium}, low=${first.summary.low}`);
    console.log(`סוף    (${last.stage}): total=${last.summary.total}, high=${last.summary.high}, med=${last.summary.medium}, low=${last.summary.low}`);

    // בעיות שנעלמו
    const firstKinds = new Set(first.issues.map(i => i.kind));
    const lastKinds = new Set(last.issues.map(i => i.kind));
    const disappeared = [...firstKinds].filter(k => !lastKinds.has(k));
    const appeared = [...lastKinds].filter(k => !firstKinds.has(k));
    if (disappeared.length > 0) console.log(`נעלמו: ${disappeared.join(', ')}`);
    if (appeared.length > 0) console.log(`נוצרו: ${appeared.join(', ')}`);
  }

  await browser.close();
})().catch(e => { console.error('שגיאה:', e.message); process.exit(1); });
