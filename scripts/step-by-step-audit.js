/* ==========================================================================
   step-by-step-audit.js — בדיקה גיאוממטרית שלב-אחר-שלב (עם delta-tracking + causality)
   --------------------------------------------------------------------------
   מטרה: לבודד פרק עם בעיות גיאוממטריות, לעמוד אותו לבד, ולהריץ בדיקה
   גיאוממטרית אחרי כל שלב של פונקציית העימוד — כדי לזהות בדיוק באיזה שלב
   הבעיה נוצרת, מתוקנת, או שהונעה פתרון מלחוץ.

   שלבי העימוד הנבדקים (checkpoints):
   1. after-initial-layout       — אחרי הלולאה הראשית (מילוי עמודים)
   2. after-cross-paragraph-parens — אחרי עיטוף סוגריים חוצי פסקאות
   3. after-rebalance2            — אחרי rebalance גלובלי
   4. after-page-height            — אחרי page-height adjustment

   שימוש:
     node step-by-step-audit.js [CHAPTER_NUM] [OPTIONS]
     node step-by-step-audit.js 9                 # פרק 9, פלט מלא
     node step-by-step-audit.js 35 --deltas-only  # פרק 35, רק delta בין שלבים
     node step-by-step-audit.js 9 --causality     # פרק 9, סיווג סיבתיות
     node step-by-step-audit.js 9 --json out.json # שמירת JSON מלא
     node step-by-step-audit.js 9 --no-typography # דלג על computed style
     node step-by-step-audit.js 9 --verbose       # פלט מלא כולל children

   אפשרויות:
     --causality          הדפס סיווג סיבתיות (7 קטגוריות) לכל בעיה
     --deltas-only        הדפס רק את ה-delta בין checkpoints (added/removed/changed)
     --no-typography      דלג על computed typography (מהיר יותר)
     --no-line-rects      דלג על lineRects (מהיר יותר, אבל פחות אבחון widow/orphan)
     --verbose            פלט מלא — כולל children, lineRects, typography
     --json <FILE>        שמור checkpoints מלא ל-JSON
     --summary-only       הדפס רק summary לכל checkpoint (מהיר)
     --per-page-checkpoints / --ppc  הפעל checkpoint אחרי כל עמוד בלולאה הראשית
                                     (איטי יותר, אבל מאפשר אבחון מדויק של מתי נוצרת כל בעיה)

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

// ── parse CLI ──────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let CHAPTER_NUM = 9;
const FLAGS = {
    causality: false, deltasOnly: false, noTypography: false,
    noLineRects: false, verbose: false, summaryOnly: false,
    perPageCheckpoints: false, jsonOut: null
};
for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (/^\d+$/.test(a)) CHAPTER_NUM = parseInt(a, 10);
    else if (a === '--causality') FLAGS.causality = true;
    else if (a === '--deltas-only') FLAGS.deltasOnly = true;
    else if (a === '--no-typography') FLAGS.noTypography = true;
    else if (a === '--no-line-rects') FLAGS.noLineRects = true;
    else if (a === '--verbose' || a === '-v') FLAGS.verbose = true;
    else if (a === '--summary-only') FLAGS.summaryOnly = true;
    else if (a === '--per-page-checkpoints' || a === '--ppc') FLAGS.perPageCheckpoints = true;
    else if (a === '--json') FLAGS.jsonOut = argv[++i];
}

// ── issue-specific reading patterns ─────────────────────────────────────────
// לכל kind של בעיה, רשימת השדות החשובים שיש לבדוק ב-checkpoints
const ISSUE_PATTERNS = {
    'widow-orphan': {
        label: 'אלמנה/יתום',
        fields: ['tokenId', 'dataAttrs (data-is-cont)', 'lineCount', 'lineRects',
                 'typography.lineHeight', 'pageMetrics.bodyFlow.bottom'],
        note: 'בדוק: האם lineCount=1? האם data-is-cont=true? מתי נוסף ה-p-cut/p-end? האם tryReclaimOrphanTail פעל?'
    },
    'imbalance': {
        label: 'טורים לא מאוזנים',
        fields: ['problemElement.rect.h', 'children heights (R vs L)',
                 'pageMetrics.twoColumnBlocks', 'pageDelta.changed (rect.h changes)'],
        note: 'בדוק: מה היה גובה הטורים בכל checkpoint? מתי נוצר הפער? האם balanceColumns פעל אחרי שינוי?'
    },
    'containment': {
        label: 'חריגה ממבנה עוטף',
        fields: ['problemElement.rect.bottom', 'pageMetrics.bodyFlow.bottom',
                 'problemElement.rect.h', 'pageDelta.changed'],
        note: 'בדוק: האם problemElement.bottom > bodyFlow.bottom? מתי נוספו אלמנטים שגורמים ל-overflow? האם אלמנט חדש הוסיף גובה?'
    },
    'page-overflow': {
        label: 'חריגה מגובה עמוד',
        fields: ['problemElement.rect.bottom', 'pageMetrics.page.h',
                 'pageMetrics.bodyFlow.bottom', 'pageMetrics.footnoteArea.bottom',
                 'pageDelta.added (new elements that consumed space)'],
        note: 'בדוק: האם problemElement.bottom > page.h? האם footnote-area חרג? האם אלמנט חדש דחף תוכן?'
    },
    'sparse-last-line': {
        label: 'שורה אחרונה דלילה',
        fields: ['problemElement.lineCount', 'problemElement.lineRects[last]',
                 'pageMetrics.bodyFlow.bottom'],
        note: 'בדוק: האם השורה האחרונה < 50% מרוחב הטור? האם יש מילה בודדת? מאיפה הגיעה המילה?'
    },
    'page-underfill': {
        label: 'עמוד דליל',
        fields: ['pageMetrics.bodyFlow.bottom', 'pageMetrics.page.h',
                 'pageDelta.removed (content shifted to next page)'],
        note: 'בדוק: האם bodyFlow.bottom < page.h - 50%? האם תוכן הועבר לעמוד הבא? האם יש h2-title/h2-spacer שמתחיל עמוד חדש?'
    },
    'block-gap': {
        label: 'מרווח גדול בין בלוקים',
        fields: ['pageElements (rects sorted by y)', 'pageDelta.added (gap created when?)',
                 'pageMetrics.bodyFlow.bottom'],
        note: 'בדוק: מתי נוצר ה-gap? האם אלמנט הוסר בין שני בלוקים? האם heading-spacing גדול מדי?'
    },
    'overflow-to-footnote': {
        label: 'תוכן באזור הערות שוליים',
        fields: ['problemElement.rect.x', 'pageMetrics.bodyFlow (right edge)',
                 'pageDelta.added (side-notes added)'],
        note: 'בדוק: האם טקסט גולש ימינה לאזור הערות השוליים? האם totalFlowH לא הופעל?'
    },
    'fn-containment': {
        label: 'הערת שוליים חורגת',
        fields: ['problemElement.rect.bottom', 'pageMetrics.footnoteArea.bottom',
                 'pageMetrics.noteLines', 'pageDelta.added (note-lines)'],
        note: 'בדוק: האם note-lines חרגו מ-footnote-area? האם נדרש פיצול הערות?'
    }
};

// ── causality classification ────────────────────────────────────────────────
// 7 קטגוריות סיבתיות (מבוסס על מודל ה-parallel-step-by-step-audit-23)
function classifyCausality(issue, checkpoints) {
    const kind = issue.kind;
    const pageIdx = issue.pageIdx;
    // אסוף את הופעת הבעיה בכל checkpoint
    const appearances = checkpoints.map((cp, idx) => {
        const matches = cp.issues.filter(i =>
            i.kind === kind &&
            (i.pageIdx === pageIdx || (pageIdx < 0 && i.pageIdx < 0))
        );
        return { idx, stage: cp.stage, pageCount: cp.pageCount, present: matches.length > 0, count: matches.length };
    });
    // מצא first-appearance
    const firstApp = appearances.find(a => a.present);
    if (!firstApp) {
        return {
            category: 'never-appeared',
            label: 'מעולם לא הופיעה',
            appearances,
            note: 'הבעיה לא הופיעה באף checkpoint. אולי נגרמת רק בריצה המלאה, או שהיא בעיה חבויה.'
        };
    }
    // מצא last-known-good (אחרון שלא הייתה הבעיה לפני firstApp)
    const lastGoodIdx = firstApp.idx - 1;
    const lastGood = lastGoodIdx >= 0 ? appearances[lastGoodIdx] : null;

    // [תיקון — ppc] בדוק האם הבעיה נעלמה אחרי firstApp (תיקון ע"י שלב מאוחר יותר)
    const laterAppearances = appearances.slice(firstApp.idx + 1);
    const afterFirst = laterAppearances.find(a => !a.present);
    if (afterFirst) {
        // הבעיה נעלמה — בדוק אם חזרה
        const afterDisappearance = appearances.slice(afterFirst.idx + 1);
        const reappeared = afterDisappearance.find(a => a.present);
        if (reappeared) {
            return {
                category: 'correction-reverted',
                label: `בוטל פתרון — הופיע (${firstApp.stage}) → נעלמה (${afterFirst.stage}) → חזרה (${reappeared.stage})`,
                appearances,
                firstApp, lastGood, fixed: afterFirst, reappeared,
                note: `השלב ${afterFirst.stage} תיקן את הבעיה, אך ${reappeared.stage} ביטל את התיקון. זהו קונפליקט בין שלבים.`
            };
        }
        return {
            category: 'fixed-by-stage',
            label: `תוקנה ע"י ${afterFirst.stage}`,
            appearances,
            firstApp, lastGood, fixed: afterFirst,
            note: `הבעיה נוצרה ב-${firstApp.stage} ותוקנה ב-${afterFirst.stage}.`
        };
    }
    // הבעיה הופיעה ולא נעלמה — עכשיו סווג לפי סוג הופעה
    // מקרה 1: "לא יכלה להופיע קודם" — העמוד לא היה קיים
    if (lastGood) {
        if (pageIdx >= lastGood.pageCount) {
            return {
                category: 'couldnt-appear-before',
                label: 'לא יכלה להופיע קודם — העמוד לא היה קיים',
                appearances,
                firstApp, lastGood,
                note: `העמוד ${pageIdx + 1} לא היה קיים ב-${lastGood.stage} (pageCount=${lastGood.pageCount}). הבעיה נוצרה יחד עם העמוד ב-${firstApp.stage}.`
            };
        }
        // מקרה 2: "נוצרה ע"י שלב" — העמוד היה קיים, הבעיה לא הייתה, ואז הופיעה
        return {
            category: 'created-by-stage',
            label: `נוצרה ע"י ${firstApp.stage}`,
            appearances,
            firstApp, lastGood,
            note: `העמוד היה קיים ב-${lastGood.stage} ללא הבעיה. הבעיה נוצרה ב-${firstApp.stage}. זוהי רגרסיה של השלב ${firstApp.stage}.`
        };
    }
    // firstApp הוא checkpoint 0 — אין "אחרון תקין", הבעיה נוצרה בשלב הראשון
    return {
        category: 'created-at-first-checkpoint',
        label: `נוצרה ב-${firstApp.stage} (השלב הראשון)`,
        appearances,
        firstApp,
        note: `הבעיה הופיעה ב-checkpoint הראשון (${firstApp.stage}). לא ניתן לדעת אם היא נוצרה בלולאה הראשית או קודם לכן. יש להוסיף checkpoint per-page בתוך הלולאה.`
    };
}

// ── helpers ────────────────────────────────────────────────────────────────
function fmtRect(r) {
    if (!r) return '∅';
    return `y=${r.y ?? '?'} h=${r.h ?? '?'} bottom=${r.bottom ?? '?'}`;
}
function fmtElement(el, verbose = false) {
    if (!el) return '∅';
    const parts = [
        `${el.type || el.role || '?'}`,
        el.tokenId ? `tok=${el.tokenId}` : '',
        el.rect ? fmtRect(el.rect) : '',
        (el.text || '').slice(0, 30)
    ].filter(Boolean);
    let s = parts.join(' | ');
    if (verbose) {
        if (el.lineRects?.length) s += `\n    lineRects: ${el.lineRects.length} lines`;
        if (el.typography) s += `\n    font: ${el.typography.fontFamily} ${el.typography.fontSize}/${el.typography.lineHeight}`;
        if (el.dataAttrs && Object.keys(el.dataAttrs).length) {
            s += `\n    attrs: ${JSON.stringify(el.dataAttrs)}`;
        }
    }
    return s;
}

(async () => {
    console.log(`[step-by-step-audit] פרק ${CHAPTER_NUM}`);
    if (FLAGS.causality) console.log('  מצב: causality classification');
    if (FLAGS.deltasOnly) console.log('  מצב: deltas-only');
    if (FLAGS.noTypography) console.log('  מצב: ללא typography');
    if (FLAGS.noLineRects) console.log('  מצב: ללא lineRects');
    if (FLAGS.verbose) console.log('  מצב: verbose');
    if (FLAGS.perPageCheckpoints) console.log('  מצב: per-page-checkpoints (איטי יותר, אבחון מדויק יותר)');
    if (FLAGS.jsonOut) console.log(`  JSON output: ${FLAGS.jsonOut}`);
    console.log('');

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
    await iframe.evaluate((opts) => {
        window.__stepByStepAudit = true;
        window.__stepByStepAuditOpts = opts;
        // [חדש — per-page-checkpoints] מפעיל checkpoint אחרי כל עמוד בלולאה הראשית
        // כדי לאפשר אבחון מדויק של בעיות שנוצרות בתוך הלולאה.
        if (opts.perPageCheckpoints) {
            window.__stepByStepAuditPerPage = true;
        }
    }, { noTypography: FLAGS.noTypography, noLineRects: FLAGS.noLineRects, perPageCheckpoints: FLAGS.perPageCheckpoints });

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

    if (FLAGS.jsonOut) {
        fs.writeFileSync(FLAGS.jsonOut, JSON.stringify(checkpoints, null, 2), 'utf8');
        console.log(`JSON נשמר: ${FLAGS.jsonOut}\n`);
    }

    if (FLAGS.summaryOnly) {
        for (const cp of checkpoints) {
            console.log(`${cp.stage}: total=${cp.summary.total} high=${cp.summary.high} med=${cp.summary.medium} low=${cp.summary.low}`);
        }
        await browser.close();
        return;
    }

    // ── 1. ניתוח כל checkpoint ────────────────────────────────────────────
    if (!FLAGS.deltasOnly) {
        console.log('=== ניתוח שלב-אחר-שלב ===\n');
        for (const cp of checkpoints) {
            console.log(`--- ${cp.stage} ---`);
            console.log(`  pageCount=${cp.pageCount}  summary=${JSON.stringify(cp.summary)}`);
            if (cp.issues.length === 0) {
                console.log(`  issues: (none)`);
            } else {
                const byKind = {};
                for (const iss of cp.issues) {
                    if (!byKind[iss.kind]) byKind[iss.kind] = [];
                    byKind[iss.kind].push(iss);
                }
                for (const [kind, issues] of Object.entries(byKind)) {
                    const sevCount = {};
                    for (const i of issues) { sevCount[i.severity] = (sevCount[i.severity] || 0) + 1; }
                    console.log(`  ${kind}: ${issues.length} (${JSON.stringify(sevCount)})`);
                    if (FLAGS.verbose) {
                        for (const i of issues.slice(0, 5)) {
                            console.log(`    [${i.severity}] page ${((i.pageIdx ?? -1) >= 0 ? i.pageIdx + 1 : '?')}: ${i.message}`);
                            if (i.problemElement) {
                                console.log(`      PROBLEM: ${fmtElement(i.problemElement, true)}`);
                            }
                            if (i.pageMetrics) {
                                const m = i.pageMetrics;
                                console.log(`      METRICS: bodyFlow.bottom=${m.bodyFlow?.bottom ?? '?'} footnoteArea.bottom=${m.footnoteArea?.bottom ?? '?'} twoColBlocks=${m.twoColumnBlocks} bodyParas=${m.bodyParagraphs} noteLines=${m.noteLines}`);
                            }
                            if (i.pageDelta) {
                                const d = i.pageDelta;
                                console.log(`      DELTA: +${d.added.length} -${d.removed.length} ~${d.changed.length}`);
                                if (FLAGS.verbose && d.added.length) {
                                    console.log(`      ADDED:`);
                                    for (const a of d.added.slice(0, 5)) console.log(`        ${fmtElement(a)}`);
                                }
                                if (FLAGS.verbose && d.changed.length) {
                                    console.log(`      CHANGED:`);
                                    for (const c of d.changed.slice(0, 5)) {
                                        console.log(`        ${c.sig}`);
                                        console.log(`          before: ${fmtRect(c.before.rect)}`);
                                        console.log(`          after:  ${fmtRect(c.after.rect)}`);
                                    }
                                }
                            }
                        }
                        if (issues.length > 5) console.log(`    ... ועוד ${issues.length - 5}`);
                    } else {
                        // דליל — הצג עד 3 דוגמאות
                        for (const i of issues.slice(0, 3)) {
                            console.log(`    [${i.severity}] page ${((i.pageIdx ?? -1) >= 0 ? i.pageIdx + 1 : '?')}: ${i.message}`);
                        }
                        if (issues.length > 3) console.log(`    ... ועוד ${issues.length - 3}`);
                    }
                }
            }
            console.log('');
        }
    }

    // ── 2. טבלת התפתחות ──────────────────────────────────────────────────
    if (!FLAGS.deltasOnly) {
        console.log('=== התפתחות בעיות לפי kind ===\n');
        const allKinds = new Set();
        for (const cp of checkpoints) {
            for (const iss of cp.issues) allKinds.add(iss.kind);
        }
        console.log('kind'.padEnd(25) + checkpoints.map(cp => cp.stage.slice(0, 22).padEnd(22)).join(''));
        for (const kind of allKinds) {
            let row = kind.padEnd(25);
            for (const cp of checkpoints) {
                const count = cp.issues.filter(i => i.kind === kind).length;
                row += String(count).padEnd(22);
            }
            console.log(row);
        }
        console.log('');
        // שורת pageCount
        let pcRow = 'pageCount'.padEnd(25);
        for (const cp of checkpoints) pcRow += String(cp.pageCount).padEnd(22);
        console.log(pcRow + '\n');
    }

    // ── 3. בעיות high — מתי נוצרו ─────────────────────────────────────────
    if (!FLAGS.deltasOnly) {
        console.log('=== בעיות high — מתי נוצרו ===\n');
        let found = false;
        for (const cp of checkpoints) {
            const highIssues = cp.issues.filter(i => i.severity === 'high');
            if (highIssues.length > 0) {
                found = true;
                console.log(`${cp.stage}: ${highIssues.length} high`);
                for (const i of highIssues) {
                    console.log(`  ${i.kind} page ${((i.pageIdx ?? -1) >= 0 ? i.pageIdx + 1 : '?')}: ${i.message}`);
                }
            }
        }
        if (!found) console.log('(אין בעיות high)\n');
        else console.log('');
    }

    // ── 4. השוואת התחלה → סוף ─────────────────────────────────────────────
    if (!FLAGS.deltasOnly && checkpoints.length >= 2) {
        const first = checkpoints[0];
        const last = checkpoints[checkpoints.length - 1];
        console.log('=== השוואת התחלה → סוף ===\n');
        console.log(`התחלה (${first.stage}): total=${first.summary.total}, high=${first.summary.high}, med=${first.summary.medium}, low=${first.summary.low}`);
        console.log(`סוף    (${last.stage}): total=${last.summary.total}, high=${last.summary.high}, med=${last.summary.medium}, low=${last.summary.low}`);
        const firstKinds = new Set(first.issues.map(i => i.kind));
        const lastKinds = new Set(last.issues.map(i => i.kind));
        const disappeared = [...firstKinds].filter(k => !lastKinds.has(k));
        const appeared = [...lastKinds].filter(k => !firstKinds.has(k));
        if (disappeared.length > 0) console.log(`נעלמו: ${disappeared.join(', ')}`);
        if (appeared.length > 0) console.log(`נוצרו: ${appeared.join(', ')}`);
        console.log('');
    }

    // ── 5. deltas בין checkpoints ─────────────────────────────────────────
    console.log('=== Delta בין checkpoints (פעילות לפי עמוד) ===\n');
    for (let i = 1; i < checkpoints.length; i++) {
        const prev = checkpoints[i - 1];
        const curr = checkpoints[i];
        console.log(`--- ${prev.stage} → ${curr.stage} ---`);
        const allPages = new Set([
            ...Object.keys(prev.deltasByPage || {}).map(Number),
            ...Object.keys(curr.deltasByPage || {}).map(Number)
        ]);
        let totalAdded = 0, totalRemoved = 0, totalChanged = 0;
        let activePages = [];
        for (const pidx of allPages) {
            const d = curr.deltasByPage?.[pidx];
            if (!d) continue;
            if (d.added.length || d.removed.length || d.changed.length) {
                activePages.push({ pidx, ...d });
                totalAdded += d.added.length;
                totalRemoved += d.removed.length;
                totalChanged += d.changed.length;
            }
        }
        if (activePages.length === 0) {
            console.log('  (אין delta — אין שינוי באף עמוד)');
        } else {
            console.log(`  סה"כ: +${totalAdded} -${totalRemoved} ~${totalChanged} ב-${activePages.length} עמודים`);
            for (const ap of activePages.slice(0, 10)) {
                console.log(`  עמוד ${ap.pidx + 1}: +${ap.added.length} -${ap.removed.length} ~${ap.changed.length}`);
                if (FLAGS.verbose || FLAGS.deltasOnly) {
                    for (const a of ap.added.slice(0, 5)) {
                        console.log(`    + ${fmtElement(a)}`);
                    }
                    for (const r of ap.removed.slice(0, 5)) {
                        console.log(`    - ${fmtElement(r)}`);
                    }
                    for (const c of ap.changed.slice(0, 5)) {
                        console.log(`    ~ ${c.sig}`);
                        console.log(`        before: ${fmtRect(c.before.rect)}`);
                        console.log(`        after:  ${fmtRect(c.after.rect)}`);
                    }
                }
            }
            if (activePages.length > 10) console.log(`  ... ועוד ${activePages.length - 10} עמודים`);
        }
        console.log('');
    }

    // ── 6. סיווג סיבתיות ──────────────────────────────────────────────────
    if (FLAGS.causality) {
        console.log('=== סיווג סיבתיות לכל בעיה ===\n');
        // אסוף כל הבעיות הייחודיות (kind + pageIdx)
        const issueKeys = new Set();
        for (const cp of checkpoints) {
            for (const i of cp.issues) {
                issueKeys.add(`${i.kind}|${i.pageIdx ?? -1}`);
            }
        }
        if (issueKeys.size === 0) {
            console.log('(אין בעיות לסווג)\n');
        }
        for (const key of issueKeys) {
            const [kind, pageIdxStr] = key.split('|');
            const pageIdx = parseInt(pageIdxStr, 10);
            // בחר נציג מה-checkpoint האחרון שבו הבעיה מופיעה
            let representative = null;
            for (let i = checkpoints.length - 1; i >= 0; i--) {
                const found = checkpoints[i].issues.find(iss =>
                    iss.kind === kind && (iss.pageIdx ?? -1) === pageIdx);
                if (found) { representative = { cp: checkpoints[i], issue: found }; break; }
            }
            if (!representative) continue;
            const cls = classifyCausality(representative.issue, checkpoints);
            const issueLabel = ISSUE_PATTERNS[kind]?.label || kind;
            console.log(`[${issueLabel}] page ${pageIdx >= 0 ? pageIdx + 1 : '?'} — ${cls.label}`);
            console.log(`  category: ${cls.category}`);
            console.log(`  note: ${cls.note}`);
            if (FLAGS.verbose && ISSUE_PATTERNS[kind]) {
                console.log(`  fields to inspect: ${ISSUE_PATTERNS[kind].fields.join(', ')}`);
                console.log(`  pattern note: ${ISSUE_PATTERNS[kind].note}`);
            }
            // הדפס appearances table
            const appRow = '    ' + cls.appearances.map(a =>
                `${a.stage.slice(0, 18)}:${a.present ? '✓' : '✗'}${a.count ? `(${a.count})` : ''}`
            ).join('  ');
            console.log(appRow);
            console.log('');
        }
    }

    // ── 7. issue-specific reading patterns ─────────────────────────────────
    if (FLAGS.verbose && !FLAGS.deltasOnly) {
        console.log('=== Issue-specific reading patterns ===\n');
        const presentKinds = new Set();
        for (const cp of checkpoints) for (const i of cp.issues) presentKinds.add(i.kind);
        for (const kind of presentKinds) {
            const p = ISSUE_PATTERNS[kind];
            if (!p) continue;
            console.log(`[${p.label}] kind=${kind}`);
            console.log(`  שדות חשובים: ${p.fields.join(', ')}`);
            console.log(`  הנחיית אבחון: ${p.note}`);
            console.log('');
        }
    }

    await browser.close();
})().catch(e => { console.error('שגיאה:', e.message); process.exit(1); });
