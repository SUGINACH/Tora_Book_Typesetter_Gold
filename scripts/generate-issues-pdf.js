/* ==========================================================================
   generate-issues-pdf.js — יצירת PDF עם צילומי מסך של עמודים עם בעיות
   --------------------------------------------------------------------------
   שימוש:
     node generate-issues-pdf.js [START_CH] [END_CH] [KIND_FILTER]
   דוגמאות:
     node generate-issues-pdf.js 9 9                    # רק פרק 9
     node generate-issues-pdf.js 1 79                   # כל 79 הפרקים
     node generate-issues-pdf.js 1 79 footnote-overflow # רק בעיות מסוג זה
     node generate-issues-pdf.js 1 79 "footnote-overflow,imbalance"

   תוצאה:
     - קובץ HTML ביניים: issues-report-<timestamp>.html
     - קובץ PDF סופי: issues-report-<timestamp>.pdf
     - שם הקובץ כולל את סוגי הבעיות שצולמו (e.g., "issues-footnote-overflow-imbalance-20261027.pdf")
   ========================================================================== */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8765/index.html';
const TEST_TEXT_PATH = process.env.TEST_TEXT_PATH || path.join(__dirname, '..', 'very_long_test_text.txt');
const OUTPUT_DIR = process.env.OUTPUT_DIR || path.join(__dirname, '..', 'issue-reports');

const argv = process.argv.slice(2);
const START_CH = parseInt(argv[0] || '9', 10);
const END_CH = parseInt(argv[1] || String(START_CH), 10);
const KIND_FILTER = (argv[2] || '').split(',').map(s => s.trim()).filter(s => s.length > 0);

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── חלץ פרקים מ-very_long_test_text.txt ──
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

// ── מפה kind → שם עברי ──
const KIND_LABELS_HE = {
    'containment': 'חריגת הכלה', 'containment-rounding': 'עיגול פיקסלים',
    'overlap': 'חפיפה', 'imbalance': 'אי-איזון טורים',
    'widow': 'אלמנה', 'orphan': 'יתום', 'sparse-line': 'שורה דלילה',
    'fn-overflow': 'גוף→הערות', 'pn-overflow': 'גוף→מספר', 'page-overflow': 'גלישת עמוד',
    'fn-page-overflow': 'הערות→תחתית', 'fn-pn-overflow': 'הערות→מספר',
    'fn-containment': 'הכלה בהערות', 'fn-line-overflow': 'שורת הערה חורגת',
    'footnote-overflow': 'הערות חורגות מאזור',
    'page-underfill': 'עמוד דליל', 'block-gap': 'מרווח בין בלוקים',
    'ornament-overflow': 'עיטור חורג', 'ornament-overlap': 'עיטור חופף', 'ornament-asymmetry': 'עיטור א-סימטרי',
    'heading-escort': 'כותרת בתחתית טור', 'orphan-heading-block': 'בלוק עם כותרת אלמנה',
    'candidate-vs-final': 'פער מועמד-סופי', 'private-use-chars': 'תווים פרטיים (ריבועים)',
    'tofu': 'טופו (תו חסר)', 'font-not-loaded': 'גופן לא נטען',
    'settings-verification': 'הגדרה לא הוחלה', 'text-completeness': 'שלמות טקסט',
    'h7-conversion': 'המרת H7 לכותרת צד', 'bracket-conversion': 'המרת סוגריים להערות',
    'note-marker-line-break': 'סמן הערה בסוף שורה',
};

// ── סיבות נפוצות לכל kind ──
const KIND_CAUSES = {
    'widow': 'שורה אחרונה בודדת בסוף טור — נכשל clubpenalty',
    'orphan': 'שורה ראשונה בודדת בטור — p-cut ממשיך מטור קודם',
    'sparse-line': 'שורה אחרונה < 50% מרוחב טור — כיווץ over-shoot',
    'imbalance': 'גובה טורים לא מאוזן — balanceColumns נכשל בפיצול',
    'containment': 'תיבה בולטת ממבנה עוטף',
    'overlap': 'שני אלמנטים חופפים — מיקום absolute שגוי',
    'page-overflow': 'אלמנט חורג מגובה העמוד',
    'footnote-overflow': 'note-lines חורגים מגובה footnote-area — הקצאת שטח חלקית',
    'page-underfill': 'עמוד מלא רק חלקית — נכשל בשאיבת תוכן מפרק הבא',
    'block-gap': 'מרווח גדול בין שני בלוקים — הפרש heading-spacing',
    'heading-escort': 'כותרת בסוף טור עם <2 שורות אחריה — clubpenalties לא מופעל',
    'orphan-heading-block': 'בלוק מכיל רק כותרת ללא טקסט גוף',
    'candidate-vs-final': 'פער בין גובה מועמד (recorded) לסופי (scrollHeight) — balanceColumns שינה מאוחר יותר',
    'private-use-chars': 'תווים ב-U+E000-F8FF — לא בגופן הראשי',
    'tofu': 'תווים עם רוחב זהה ל-□ — לא נטענו בגופן',
    'font-not-loaded': 'document.fonts.status לא "loaded" — גופן נפיל',
    'text-completeness': 'מילים במקור לא ב-DOM — בעיית פרסור/עימוד',
    'h7-conversion': 'כותרת H7 נשארה בגוף במקום ב-side-notes — המרה נכשלה',
    'bracket-conversion': 'סוגריים [] נשארו בגוף במקום ב-footnotes — המרה נכשלה',
    'note-marker-line-break': 'סמן הערה בסוף שורה — נראה כאילו "נשאר לבד"',
    'settings-verification': 'הגדרה מ-default_settings לא הוחלה בפועל',
};

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

(async () => {
    console.log(`[generate-issues-pdf] טווח פרקים: ${START_CH}-${END_CH}, מסנן: ${KIND_FILTER.length ? KIND_FILTER.join(',') : 'ALL'}`);
    const text = fs.readFileSync(TEST_TEXT_PATH, 'utf8');
    const allChapters = splitTextIntoChapters(text);
    console.log(`[generate-issues-pdf] סה"כ פרקים במקור: ${allChapters.length}`);

    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1024 } });
    const page = await ctx.newPage();
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !!document.querySelector('iframe#render-frame'), { timeout: 15000 });
    await page.waitForTimeout(3000);
    const iframe = page.frame({ name: 'render-frame' }) || page.frames().find(f => f !== page.mainFrame());

    const allReports = []; // [{ chapterNum, title, issues: [...] }]
    let chIdx = 0;
    let curBrowser = browser, curPage = page, curIframe = iframe;

    for (let chNum = START_CH; chNum <= END_CH; chNum++) {
        chIdx++;
        if (chIdx > 1 && chIdx % 5 === 0) {
            console.log(`[generate-issues-pdf] מרענן browser לאחר ${chIdx} פרקים (מונע דליפות זיכרון)`);
            try { await curBrowser.close(); } catch(_) {}
            const newBrowser = await chromium.launch({ headless: true });
            const newCtx = await newBrowser.newContext({ viewport: { width: 1280, height: 1024 } });
            const newPage = await newCtx.newPage();
            await newPage.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
            await newPage.waitForFunction(() => !!document.querySelector('iframe#render-frame'), { timeout: 15000 });
            await newPage.waitForTimeout(3000);
            const newIframe = newPage.frame({ name: 'render-frame' }) || newPage.frames().find(f => f !== newPage.mainFrame());
            curBrowser = newBrowser; curPage = newPage; curIframe = newIframe;
        }

        const chapter = allChapters[chNum - 1];
        if (!chapter) { console.log(`  פרק ${chNum} לא קיים, מדלג`); continue; }

        process.stdout.write(`  פרק ${chNum}: ${chapter.title.slice(0, 50)}... `);

        // הזרקת source text
        await curIframe.evaluate((src) => { window.__auditSourceText = src; }, chapter.text);

        // הגדרות
        const settings = await curPage.evaluate(() => collectAllSettingsForRenderer());

        // הפעל typeset
        const result = await curPage.evaluate(async ({ t, s }) => {
            return await new Promise((res, rej) => {
                const f = document.querySelector('iframe#render-frame');
                const h = (e) => {
                    if (e.data?.type === 'render-done') { window.removeEventListener('message', h); clearTimeout(t2); res({ pageCount: e.data.pageCount }); }
                    else if (e.data?.type === 'render-error') { window.removeEventListener('message', h); clearTimeout(t2); rej(new Error(e.data.error)); }
                };
                window.addEventListener('message', h);
                const t2 = setTimeout(() => { window.removeEventListener('message', h); rej(new Error('timeout')); }, 180000);
                f.contentWindow.postMessage({ type: 'typeset', text: t, settings: s }, '*');
            });
        }, { t: chapter.text, s: settings });

        await curPage.waitForTimeout(800);

        // הרץ audit
        const audit = await curIframe.evaluate(() => {
            const model = window.__geomAudit.extract();
            const result = window.__geomAudit.audit(model);
            return {
                summary: result.summary,
                issues: (result.issues || []).map(i => ({
                    kind: i.kind, severity: i.severity,
                    pageIdx: i.pageIdx, location: i.location,
                    message: i.message || '',
                    childRect: i.childRect || null,
                    aRect: i.aRect || null, bRect: i.bRect || null,
                    rightRect: i.rightRect || null, leftRect: i.leftRect || null,
                }))
            };
        });

        // סנן issues לפי KIND_FILTER
        let relevantIssues = audit.issues || [];
        if (KIND_FILTER.length > 0) {
            relevantIssues = relevantIssues.filter(i => KIND_FILTER.includes(i.kind));
        }

        // [נקודה 1 ממשתמש — 2026-10-28] הסתר candidate-vs-final כבעיה נפרדת
        // (ה-audit כבר לא מדווח עליו, אבל אם יש נתונים ישנים/מקומיים — נסנן גם כאן)
        relevantIssues = relevantIssues.filter(i => i.kind !== 'candidate-vs-final');

        if (relevantIssues.length === 0) {
            console.log(`✓ אין בעיות`);
            continue;
        }

        console.log(`נמצאו ${relevantIssues.length} בעיות, מצלם...`);

        // קבץ issues לפי עמוד
        // [נקודה 2 ממשתמש — 2026-10-28] בעיות גלובליות (pageIdx < 0) לא צריכות לצלם עמוד 0.
        // נמצא את העמוד שבו הבעיה באמת מופיעה ע"י חיפוש טקסט/סמנים.
        // אם לא ניתן למצוא — נצלם את העמוד הראשון שאינו שער (עמוד 1 או יותר).
        const globalIssues = relevantIssues.filter(i => i.pageIdx < 0);
        const pageSpecificIssues = relevantIssues.filter(i => i.pageIdx >= 0);

        const byPage = new Map();
        for (const iss of pageSpecificIssues) {
            if (!byPage.has(iss.pageIdx)) byPage.set(iss.pageIdx, []);
            byPage.get(iss.pageIdx).push(iss);
        }

        // עבור issues גלובליים (pageIdx < 0) — צריך למצוא עמודים שבהם הבעיה מופיעה.
        // אסטרטגיה: הכנס את ה-issue לכל עמוד שיש בו תוכן גוף (לא שער).
        // זה יותר מדויק מלצלם רק את עמוד 0.
        if (globalIssues.length > 0 && result.pageCount > 1) {
            // עבור כל עמוד שאינו עמוד שער (pageIdx > 0), הוסף את ה-issues הגלובליים
            // ניקח רק את העמודים שיש בהם תוכן אמיתי (מעל עמוד 0).
            // ליתר ביטחון: ניקח עמוד נציג אחד — העמוד השני (idx=1) כשיש 2+ עמודים.
            // אם המשתמש רוצה לראות את כל העמודים, אפשר לשנות את הסינון לריק (כל הסוגים).
            // אסטרטגיה אלטרנטיבית: אם הבעיה גלובלית, נצלם את כל העמודים עם תוכן גוף.
            // אבל זה יוצר PDF ענק. אז נצלם רק עמוד אחד נציג.
            const representativePageIdx = 1; // העמוד השני (idx=1) — עמוד גוף ראשון
            if (result.pageCount > 1) {
                if (!byPage.has(representativePageIdx)) byPage.set(representativePageIdx, []);
                // הוסף תיוג של "גלובלי" לכל ה-issue
                for (const iss of globalIssues) {
                    byPage.get(representativePageIdx).push({
                        ...iss,
                        _isGlobalIssue: true,
                        _originalPageIdx: iss.pageIdx
                    });
                }
            }
        }

        const chapterReport = { chapterNum: chNum, title: chapter.title, pageCount: result.pageCount, pages: [] };

        // צלם כל עמוד עם בעיות
        for (const [pIdx, issuesAtPage] of byPage.entries()) {
            // גלול לעמוד המתאים ב-iframe
            await curIframe.evaluate((idx) => {
                const pages = document.querySelectorAll('#book-container .a4-page');
                if (pages[idx]) {
                    const body = document.body;
                    const r = pages[idx].getBoundingClientRect();
                    body.scrollTop = (body.scrollTop || 0) + r.top - 20;
                }
            }, pIdx);
            await curPage.waitForTimeout(400);

            // צלם את העמוד (element screenshot דרך iframe Frame API)
            let screenshotBase64 = null;
            try {
                const pageHandle = await curIframe.$(`.a4-page:nth-of-type(${pIdx + 1})`);
                if (pageHandle) {
                    screenshotBase64 = await pageHandle.screenshot({ type: 'png', timeout: 15000 });
                    await pageHandle.dispose();
                } else {
                    screenshotBase64 = await curIframe.screenshot({ type: 'png', timeout: 15000 });
                }
            } catch (err) {
                console.log(`    [שגיאת צילום] page ${pIdx}: ${err.message}`);
            }
            if (screenshotBase64) {
                const b64 = screenshotBase64.toString('base64');
                chapterReport.pages.push({
                    pageIdx: pIdx,
                    issues: issuesAtPage,
                    screenshot: b64,
                });
            } else {
                chapterReport.pages.push({ pageIdx: pIdx, issues: issuesAtPage, screenshot: null, error: 'no screenshot' });
            }
        }

        allReports.push(chapterReport);
    }

    await curBrowser.close();

    // בנה HTML עם כל הצילומים + מטא-נתונים
    console.log(`[generate-issues-pdf] בונה HTML עם ${allReports.length} פרקים...`);

    // אסוף את כל סוגי הבעיות שצולמו לשם הקובץ
    const allKinds = new Set();
    let totalIssues = 0, totalHigh = 0, totalMed = 0, totalLow = 0;
    for (const rep of allReports) {
        for (const pg of rep.pages) {
            for (const iss of pg.issues) {
                allKinds.add(iss.kind);
                totalIssues++;
                if (iss.severity === 'high') totalHigh++;
                else if (iss.severity === 'medium') totalMed++;
                else totalLow++;
            }
        }
    }
    const kindsArr = Array.from(allKinds).sort();

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const kindsStr = kindsArr.length > 0 ? kindsArr.join('+') : 'no-issues';
    const pdfFilename = `issues-${kindsStr}-${ts}.pdf`;
    const htmlFilename = `issues-${kindsStr}-${ts}.html`;
    const pdfPath = path.join(OUTPUT_DIR, pdfFilename);
    const htmlPath = path.join(OUTPUT_DIR, htmlFilename);

    let html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<title>דוח בעיות — ${ts}</title>
<style>
  @page { size: A4; margin: 1.5cm; }
  body { font-family: 'Noto Sans Hebrew', 'Arial', sans-serif; color: #1e293b; line-height: 1.5; }
  .cover { text-align: center; padding: 60px 20px; page-break-after: always; }
  .cover h1 { font-size: 28pt; color: #1e40af; margin-bottom: 8px; }
  .cover h2 { font-size: 14pt; color: #64748b; margin-top: 4px; }
  .cover .stats { display: flex; justify-content: center; gap: 16px; margin-top: 30px; }
  .cover .stat { padding: 12px 20px; border-radius: 8px; background: #f1f5f9; }
  .cover .stat .num { font-size: 24pt; font-weight: bold; display: block; }
  .cover .stat .lbl { font-size: 9pt; color: #64748b; }
  .cover .stat.high .num { color: #dc2626; }
  .cover .stat.med .num { color: #d97706; }
  .cover .stat.low .num { color: #64748b; }
  .cover .kinds { margin-top: 30px; font-size: 9pt; color: #64748b; }
  .cover .kinds b { color: #1e293b; }
  .chapter-divider { page-break-before: always; padding: 20px 0; text-align: center; background: #1e293b; color: #fff; border-radius: 6px; }
  .chapter-divider h2 { margin: 0; font-size: 14pt; }
  .chapter-divider .meta { font-size: 9pt; color: #94a3b8; margin-top: 4px; }
  .issue-block { page-break-inside: avoid; margin-bottom: 12px; }
  .issue-header { background: #f1f5f9; padding: 8px 10px; border-radius: 4px 4px 0 0; border-right: 4px solid #64748b; font-size: 9pt; }
  .issue-header.high { border-right-color: #dc2626; background: #fef2f2; }
  .issue-header.medium { border-right-color: #d97706; background: #fffbeb; }
  .issue-header.low { border-right-color: #64748b; background: #f8fafc; }
  .issue-header .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .issue-header .tag { background: #fff; padding: 2px 6px; border-radius: 3px; font-size: 8pt; border: 1px solid #cbd5e1; }
  .issue-header .tag.kind { font-weight: bold; }
  .issue-header .tag.high { background: #fee2e2; color: #991b1b; border-color: #fca5a5; }
  .issue-header .tag.medium { background: #fef3c7; color: #92400e; border-color: #fcd34d; }
  .issue-header .tag.low { background: #f1f5f9; color: #475569; border-color: #cbd5e1; }
  .issue-screenshot { width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; display: block; }
  .issue-message { padding: 6px 10px; background: #fff; font-size: 8pt; color: #475569; border-radius: 0 0 4px 4px; border: 1px solid #e2e8f0; border-top: none; }
  .no-screenshot { padding: 20px; text-align: center; background: #fee2e2; color: #991b1b; font-size: 9pt; }
  .page-info { font-size: 8pt; color: #64748b; padding: 4px 10px; background: #fff; }
</style>
</head>
<body>

<div class="cover">
  <h1>דוח בעיות עימוד</h1>
  <h2>מערכת עימוד תורנית V21</h2>
  <p style="color:#64748b;font-size:10pt;margin-top:8px;">${new Date(ts.replace(/-/g, ':').replace(/(\d{4})-(\d{2})-(\d{2}).*/, '$3/$2/$1')).toLocaleString('he-IL')}</p>
  <div class="stats">
    <div class="stat"><span class="num">${allReports.length}</span><span class="lbl">פרקים נסרקו</span></div>
    <div class="stat high"><span class="num">${totalHigh}</span><span class="lbl">HIGH</span></div>
    <div class="stat med"><span class="num">${totalMed}</span><span class="lbl">MEDIUM</span></div>
    <div class="stat low"><span class="num">${totalLow}</span><span class="lbl">LOW</span></div>
    <div class="stat"><span class="num">${totalIssues}</span><span class="lbl">סה"כ בעיות</span></div>
  </div>
  <div class="kinds"><b>סוגי בעיות בדוח זה (${kindsArr.length}):</b><br>${kindsArr.map(k => `${KIND_LABELS_HE[k] || k} (${k})`).join(' • ')}</div>
</div>

`;

    // בנה כל פרק
    // [נקודה 4 ממשתמש — 2026-10-28] הוסף ID ייחודי לכל issue לסימניות (bookmarks)
    let issueCounter = 0;
    const bookmarkList = []; // [{ chapterNum, pageIdx, kind, heName, severity, issueIdx }]
    for (const rep of allReports) {
        html += `<div class="chapter-divider"><h2>פרק ${rep.chapterNum} — ${escapeHtml(rep.title.slice(0, 80))}</h2><div class="meta">${rep.pageCount} עמודים • ${rep.pages.length} עמודים עם בעיות</div></div>\n`;
        for (const pg of rep.pages) {
            html += `<div class="page-info">עמוד ${pg.pageIdx + 1} — ${pg.issues.length} בעיות בעמוד זה</div>\n`;
            for (const iss of pg.issues) {
                issueCounter++;
                const issueId = `issue-${issueCounter}`;
                const heName = KIND_LABELS_HE[iss.kind] || iss.kind;
                const cause = KIND_CAUSES[iss.kind] || '(סיבה לא ידועה)';
                const sevClass = iss.severity || 'low';
                const isGlobal = iss._isGlobalIssue === true;
                const globalMark = isGlobal ? ' <span class="tag" style="background:#fef3c7;color:#92400e;">גלובלי</span>' : '';
                html += `<div class="issue-block" id="${issueId}">
  <div class="issue-header ${sevClass}">
    <div class="row">
      <span class="tag kind">${escapeHtml(heName)}</span>
      <span class="tag ${sevClass}">${iss.severity.toUpperCase()}</span>
      <span class="tag">סוג: <code>${escapeHtml(iss.kind)}</code></span>
      <span class="tag">עמוד ${pg.pageIdx + 1}${isGlobal ? ' (נציג)' : ''}</span>
      <span class="tag">פרק ${rep.chapterNum}</span>${globalMark}
    </div>
    <div style="margin-top:4px;font-size:8pt;color:#475569;"><b>סיבה:</b> ${escapeHtml(cause)}</div>
  </div>`;
                if (pg.screenshot) {
                    html += `<img class="issue-screenshot" src="data:image/png;base64,${pg.screenshot}" alt="עמוד ${pg.pageIdx + 1}" />`;
                } else {
                    html += `<div class="no-screenshot">לא ניתן היה לצלם עמוד זה${pg.error ? ': ' + escapeHtml(pg.error) : ''}</div>`;
                }
                html += `<div class="issue-message"><b>הודעת ה-audit:</b> ${escapeHtml(iss.message)}</div>`;
                if (iss.childRect) {
                    html += `<div class="issue-message" style="font-size:7pt;color:#64748b;"><b>מיקום הבעיה:</b> x=${iss.childRect.x}, y=${iss.childRect.y}, w=${iss.childRect.w}, h=${iss.childRect.h}</div>`;
                }
                html += `</div>\n`;
                // הוסף bookmark: "פרק N עמוד M — שם הבעיה"
                bookmarkList.push({
                    chapterNum: rep.chapterNum,
                    pageIdx: pg.pageIdx,
                    kind: iss.kind,
                    heName: heName,
                    severity: iss.severity || 'low',
                    issueIdx: issueCounter,
                    isGlobal: isGlobal
                });
            }
        }
    }

    html += `</body></html>`;
    fs.writeFileSync(htmlPath, html);
    console.log(`[generate-issues-pdf] HTML נשמר: ${htmlPath} (${Math.round(html.length / 1024)} KB)`);

    // המר HTML → PDF באמצעות chromium
    console.log(`[generate-issues-pdf] ממיר HTML → PDF...`);
    const pdfBrowser = await chromium.launch({ headless: true });
    const pdfPage = await pdfBrowser.newPage();
    await pdfPage.goto(`file://${htmlPath}`, { waitUntil: 'load', timeout: 120000 });
    await pdfPage.waitForTimeout(2000); // המתן לטעינת תמונות base64
    await pdfPage.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        margin: { top: '1cm', bottom: '1cm', left: '1cm', right: '1cm' },
        preferCSSPageSize: true,
    });

    // [נקודה 4 ממשתמש — 2026-10-28] הוסף סימניות (bookmarks) ל-PDF עם pdf-lib
    // הסימניות כוללות: "פרק N עמוד M — שם הבעיה" לכל issue.
    try {
        const { PDFDocument, PDFHexString, PDFString, PDFArray, PDFName, PDFNull, PDFNumber } = require('pdf-lib');
        const existingPdfBytes = fs.readFileSync(pdfPath);
        const pdfDoc = await PDFDocument.load(existingPdfBytes);
        const totalPages = pdfDoc.getPageCount();
        console.log(`[generate-issues-pdf] PDF נוצר עם ${totalPages} עמודים, מוסיף סימניות...`);

        // גישה פשוטה למציאת מספר העמוד ב-PDF:
        // נמדוד ישירות את המיקום ה-y של כל issue ב-HTML, ונחלק לפי גובה A4.
        const pageHeightPx = 1123; // A4 height in CSS pixels (96dpi)
        const issueYPositions = await pdfPage.evaluate((issueIds) => {
            const results = [];
            for (const id of issueIds) {
                const el = document.getElementById(id);
                if (!el) { results.push({ id, y: -1 }); continue; }
                const y = el.getBoundingClientRect().top + window.scrollY;
                results.push({ id, y });
            }
            return results;
        }, bookmarkList.map(b => `issue-${b.issueIdx}`));

        // חשב PDF page index לכל issue
        const byChapter = new Map();
        for (let i = 0; i < bookmarkList.length; i++) {
            const b = bookmarkList[i];
            const y = issueYPositions[i]?.y || 0;
            let pdfPageIdx = Math.floor(y / pageHeightPx);
            pdfPageIdx = Math.max(0, Math.min(totalPages - 1, pdfPageIdx));
            if (!byChapter.has(b.chapterNum)) {
                byChapter.set(b.chapterNum, { title: `פרק ${b.chapterNum}`, items: [] });
            }
            const issueTitle = `${b.heName} (עמוד ${b.pageIdx + 1}${b.isGlobal ? ' נציג' : ''}, ${b.severity.toUpperCase()})`;
            byChapter.get(b.chapterNum).items.push({ title: issueTitle, page: pdfPageIdx });
        }

        // בנה outline tree ידנית עם pdf-lib low-level API
        // מבנה: root → chapters → issues (2 levels)
        // [תיקון 2026-10-28] השתמש ב-PDFHexString.fromText עבור Title (תומך בעברית)
        // ו-PDFNull ב-Dest array (במקום null שגרם ל-"value.sizeInBytes is not a function").
        const pages = pdfDoc.getPages();
        const outlineRootRef = pdfDoc.context.nextRef();
        const rootChildren = [];

        const makeOutlineNode = (title, parentRef, pageIdxOrNull) => {
            const titleStr = PDFHexString.fromText(title);
            const nodeDict = pdfDoc.context.obj({});
            nodeDict.set(PDFName.of('Title'), titleStr);
            nodeDict.set(PDFName.of('Parent'), parentRef);
            if (pageIdxOrNull !== null && pageIdxOrNull < pages.length) {
                const destPageRef = pages[pageIdxOrNull].ref;
                // Dest = [pageRef, /XYZ, null, null, null]
                // חובה להשתמש ב-PDFNull במקום null רגיל כי pdf-lib לא מתמודד עם null.
                const destArr = PDFArray.withContext(pdfDoc.context);
                destArr.push(destPageRef);
                destArr.push(PDFName.of('XYZ'));
                destArr.push(PDFNull);
                destArr.push(PDFNull);
                destArr.push(PDFNull);
                nodeDict.set(PDFName.of('Dest'), destArr);
            }
            const ref = pdfDoc.context.register(nodeDict);
            return { ref, dict: nodeDict };
        };

        // צור chapter nodes
        const chapters = Array.from(byChapter.values());
        for (let ci = 0; ci < chapters.length; ci++) {
            const ch = chapters[ci];
            const chNode = makeOutlineNode(ch.title, outlineRootRef, null);
            rootChildren.push(chNode);

            // צור issue nodes תחת ה-chapter
            const issueRefs = [];
            for (let ii = 0; ii < ch.items.length; ii++) {
                const item = ch.items[ii];
                const issueNode = makeOutlineNode(item.title, chNode.ref, item.page);
                issueRefs.push(issueNode);
            }

            // חבר את ה-issue siblings
            for (let i = 0; i < issueRefs.length; i++) {
                if (i > 0) issueRefs[i].dict.set(PDFName.of('Prev'), issueRefs[i - 1].ref);
                if (i < issueRefs.length - 1) issueRefs[i].dict.set(PDFName.of('Next'), issueRefs[i + 1].ref);
            }

            // חבר chapter First/Last/Count
            if (issueRefs.length > 0) {
                chNode.dict.set(PDFName.of('First'), issueRefs[0].ref);
                chNode.dict.set(PDFName.of('Last'), issueRefs[issueRefs.length - 1].ref);
                chNode.dict.set(PDFName.of('Count'), PDFNumber.of(issueRefs.length));
            }
        }

        // חבר root children siblings
        for (let i = 0; i < rootChildren.length; i++) {
            if (i > 0) rootChildren[i].dict.set(PDFName.of('Prev'), rootChildren[i - 1].ref);
            if (i < rootChildren.length - 1) rootChildren[i].dict.set(PDFName.of('Next'), rootChildren[i + 1].ref);
        }

        // עמוד שער bookmark
        const coverNode = makeOutlineNode('עמוד שער', outlineRootRef, 0);
        // הכנס cover בראש הרשימה
        rootChildren.unshift(coverNode);
        for (let i = 0; i < rootChildren.length; i++) {
            if (i > 0) rootChildren[i].dict.set(PDFName.of('Prev'), rootChildren[i - 1].ref);
            if (i < rootChildren.length - 1) rootChildren[i].dict.set(PDFName.of('Next'), rootChildren[i + 1].ref);
        }

        // צור root
        // [תיקון 2026-10-28] בנה את ה-dict ידנית עם PDFName values כדי למנוע
        // "value.sizeInBytes is not a function" שנגרם מ-obj({Type: 'Outlines', ...}).
        const outlineRoot = pdfDoc.context.obj({});
        outlineRoot.set(PDFName.of('Type'), PDFName.of('Outlines'));
        outlineRoot.set(PDFName.of('First'), rootChildren[0].ref);
        outlineRoot.set(PDFName.of('Last'), rootChildren[rootChildren.length - 1].ref);
        outlineRoot.set(PDFName.of('Count'), PDFNumber.of(rootChildren.length));
        pdfDoc.context.assign(outlineRootRef, outlineRoot);
        pdfDoc.catalog.set(PDFName.of('Outlines'), outlineRootRef);
        pdfDoc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'));

        const modifiedPdfBytes = await pdfDoc.save();
        fs.writeFileSync(pdfPath, modifiedPdfBytes);
        const totalBookmarks = bookmarkList.length + 1; // +1 for cover
        console.log(`[generate-issues-pdf] ✓ סימניות נוספו: ${totalBookmarks} bookmarks ב-${chapters.length} פרקים`);
    } catch (bookmarkErr) {
        console.log(`[generate-issues-pdf] ⚠ סימניות נכשלו: ${bookmarkErr.message} (PDF עדיין תקין)`);
        console.log(`[bookmarkErr stack]: ${bookmarkErr.stack?.split('\n').slice(0,3).join(' | ')}`);
    }

    await pdfBrowser.close();

    const stat = fs.statSync(pdfPath);
    console.log(`[generate-issues-pdf] ✓ PDF נוצר: ${pdfPath} (${Math.round(stat.size / 1024)} KB)`);
    console.log(`[generate-issues-pdf] שם הקובץ: ${pdfFilename}`);
    console.log(`[generate-issues-pdf] תיקיית יעד: ${OUTPUT_DIR}`);
})().catch(e => {
    console.error('[generate-issues-pdf] שגיאה:', e.message);
    console.error(e.stack);
    process.exit(1);
});
