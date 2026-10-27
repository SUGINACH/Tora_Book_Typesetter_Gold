/* ==========================================================================
   editing-recommendations.js — מערכת המלצות עריכה לפתרון בעיות עימוד
   --------------------------------------------------------------------------
   ארכיטקטורה: identifyIssues → proposeEdits → reportRecommendations
   --------------------------------------------------------------------------
   מטרה: להמליץ על עריכה קלה (הוספת/הסרת מילה, חלוקת/מיזוג פסקה) לפתרון
   בעיות עימוד שלא ניתנות לפתרון אלגוריתמי בלבד.

   סוגי בעיות והמלצות:
   - imbalance: הוסף/הסר מילה כדי לשנות מספר שורות בטור
   - sparse-line: הוסף מילה כדי למלא את השורה האחרונה
   - page-underfill: הוסף תוכן או מזג פסקאות כדי למלא את העמוד
   - containment: הסר מילה כדי למנוע גלישה מ-body-flow
   - widow-orphan: הוסף/הסר מילה כדי למנוע שורה בודדת

   שימוש:
     node editing-recommendations.js [CHAPTER_NUM]
     node editing-recommendations.js 9        # פרק 9
     node editing-recommendations.js          # ברירת מחדל: פרק 9
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

// ── proposeEdits: עבור כל בעיה, הצע עריכה רלוונטית ──────────────────────
function proposeEdits(issues, chapterNum) {
    const recommendations = [];

    for (const iss of issues) {
        const page = (iss.pageIdx != null && iss.pageIdx >= 0) ? iss.pageIdx + 1 : '?';
        const kind = iss.kind;
        const sev = iss.severity;
        const msg = iss.message || '';
        const id = iss.issueData || {};

        let recommendation = null;

        switch (kind) {
            case 'imbalance': {
                const diff = id.diff || 0;
                const rightH = id.rightH || 0;
                const leftH = id.leftH || 0;
                const taller = rightH > leftH ? 'ימין' : 'שמאל';
                const shorter = rightH > leftH ? 'שמאל' : 'ימין';
                recommendation = {
                    kind,
                    severity: sev,
                    page,
                    issue: msg,
                    action: 'הוסף או הסר מילה אחת',
                    target: `בפסקה האחרונה של טור ${taller}`,
                    reason: `כדי לשנות את מספר השורות ולאזן את הטורים (פער=${diff}px, ${taller}=${rightH}px ${shorter}=${leftH}px)`,
                    expectedImpact: `הפחתת הפער ב-${Math.round(Math.abs(diff)/2)}px (שורה אחת ≈ 21px)`,
                    priority: sev === 'high' ? 'גבוהה' : (sev === 'medium' ? 'בינונית' : 'נמוכה')
                };
                break;
            }
            case 'sparse-line': {
                const lastW = id.lastW || 0;
                const firstW = id.firstW || 0;
                const pText = id.pText || '';
                recommendation = {
                    kind,
                    severity: sev,
                    page,
                    issue: msg,
                    action: 'הוסף מילה אחת בסוף הפסקה',
                    target: `בפסקה: "${pText.slice(0, 40)}..."`,
                    reason: `כדי למלא את השורה האחרונה (רוחב אחרון=${lastW}px, ראשון=${firstW}px)`,
                    expectedImpact: `מילוי השורה האחרונה מ-${lastW}px ל-${Math.round(firstW * 0.7)}px+`,
                    priority: 'נמוכה'
                };
                break;
            }
            case 'page-underfill': {
                const fillRatio = (id.childRect && id.childRect.w) ? 0 : 0;
                const match = msg.match(/(\d+)%/);
                const ratio = match ? parseInt(match[1]) : 0;
                recommendation = {
                    kind,
                    severity: sev,
                    page,
                    issue: msg,
                    action: ratio < 70 ? 'הוסף תוכן או מזג פסקאות' : 'הוסף משפט קצר בסוף הפסקה האחרונה',
                    target: `בעמוד ${page}`,
                    reason: `כדי למלא את העמוד (מילוי=${ratio}%)`,
                    expectedImpact: `העלאת המילוי מ-${ratio}% ל-${Math.min(ratio + 10, 90)}%+`,
                    priority: sev === 'high' ? 'גבוהה' : 'נמוכה'
                };
                break;
            }
            case 'containment': {
                const match = msg.match(/"bottom":(\d+\.?\d*)/);
                const overflow = match ? parseFloat(match[1]) : 0;
                recommendation = {
                    kind,
                    severity: sev,
                    page,
                    issue: msg,
                    action: overflow > 40 ? 'חלק את הפסקה לשתי פסקאות' : 'הסר מילה אחת מהפסקה הארוכה',
                    target: `בבלוק שגולש בעמוד ${page}`,
                    reason: `כדי להקטין את הגלישה (overflow=${overflow}px)`,
                    expectedImpact: `הפחתת הגלישה ב-${Math.round(overflow)}px`,
                    priority: sev === 'high' ? 'גבוהה' : (sev === 'medium' ? 'בינונית' : 'נמוכה')
                };
                break;
            }
            case 'containment-rounding':
                // גלישת עיגול פיקסלים — אין צורך בעריכה
                continue;
            case 'settings-verification':
                // בעיית הגדרות — לא ניתנת לפתרון ע"י עריכת טקסט
                continue;
            case 'widow-orphan':
                recommendation = {
                    kind,
                    severity: sev,
                    page,
                    issue: msg,
                    action: 'הוסף או הסר מילה בפסקה שלפני תחילת הטור',
                    target: `בעמוד ${page}`,
                    reason: 'כדי למנוע שורה בודדת בתחילת/סוף הטור',
                    expectedImpact: 'הזזת שורה בין הטורים',
                    priority: sev === 'high' ? 'גבוהה' : 'בינונית'
                };
                break;
            default:
                continue;
        }

        if (recommendation) {
            recommendations.push(recommendation);
        }
    }

    return recommendations;
}

// ── reportRecommendations: הדפסת המלצות בפורמט קריא ────────────────────
function reportRecommendations(recommendations, chapterNum, chapterTitle) {
    console.log('═'.repeat(70));
    console.log(`  המלצות עריכה — פרק ${chapterNum}: "${chapterTitle.slice(0, 50)}"`);
    console.log('═'.repeat(70));

    if (recommendations.length === 0) {
        console.log('\n  ✓ אין המלצות עריכה — העימוד תקין!');
        console.log('');
        return;
    }

    // סנן רק המלצות עם priority בינונית או גבוהה (דלג על נמוכות)
    const actionable = recommendations.filter(r => r.priority !== 'נמוכה');
    const low = recommendations.filter(r => r.priority === 'נמוכה');

    if (actionable.length > 0) {
        console.log(`\n  המלצות בעדיפות גבוהה/בינונית (${actionable.length}):`);
        console.log('  ' + '─'.repeat(66));
        for (const r of actionable) {
            console.log(`\n  [${r.priority}] עמוד ${r.page} — ${r.kind}`);
            console.log(`    בעיה: ${r.issue}`);
            console.log(`    פעולה: ${r.action}`);
            console.log(`    יעד: ${r.target}`);
            console.log(`    סיבה: ${r.reason}`);
            console.log(`    השפעה צפויה: ${r.expectedImpact}`);
        }
    }

    if (low.length > 0) {
        console.log(`\n  המלצות בעדיפות נמוכה (${low.length}):`);
        console.log('  ' + '─'.repeat(66));
        for (const r of low.slice(0, 5)) {
            console.log(`  • עמוד ${r.page} — ${r.action} (${r.reason})`);
        }
        if (low.length > 5) console.log(`  ... ועוד ${low.length - 5} המלצות נמוכות`);
    }

    console.log('\n  ' + '═'.repeat(66));
    console.log(`  סה"כ: ${recommendations.length} המלצות (${actionable.length} בעדיפות גבוהה/בינונית, ${low.length} נמוכות)`);
    console.log('');
}

(async () => {
    console.log(`[editing-recommendations] פרק ${CHAPTER_NUM}\n`);

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

    // Run geometry audit
    const auditResult = await iframe.evaluate(() => {
        if (!window.__geomAudit) return { issues: [], summary: {} };
        const model = window.__geomAudit.extract();
        const audit = window.__geomAudit.audit(model);
        // Enrich issues with issueData (same as __runAuditCheckpoint)
        return {
            issues: audit.issues.map(i => ({
                kind: i.kind,
                severity: i.severity,
                pageIdx: i.pageIdx,
                message: (i.message || '').slice(0, 200),
                issueData: {
                    childType: i.childType || null,
                    childRect: i.childRect || null,
                    location: i.location || null,
                    lastW: i.lastW != null ? i.lastW : null,
                    firstW: i.firstW != null ? i.firstW : null,
                    pText: i.pText || null,
                    rightH: i.rightH != null ? i.rightH : null,
                    leftH: i.leftH != null ? i.leftH : null,
                    diff: i.diff != null ? i.diff : null,
                    overflow: i.overflow || null,
                    fillRatio: i.fillRatio != null ? i.fillRatio : null,
                }
            })),
            summary: audit.summary
        };
    });

    console.log(`עמודים: ${renderResult.pageCount}`);
    console.log(`בעיות גיאומממטריות: ${auditResult.summary.total || 0} (high=${auditResult.summary.high || 0}, med=${auditResult.summary.medium || 0}, low=${auditResult.summary.low || 0})\n`);

    // Propose edits
    const recommendations = proposeEdits(auditResult.issues, CHAPTER_NUM);

    // Report
    reportRecommendations(recommendations, CHAPTER_NUM, ch.title);

    await browser.close();
})().catch(e => { console.error('שגיאה:', e.message); process.exit(1); });
