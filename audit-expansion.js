/* ==========================================================================
   audit-expansion.js — בדיקות גיאומממטריות חדשות (AUDIT_EXPANSION_PLAN פריט 1)
   --------------------------------------------------------------------------
   12 בדיקות חדשות שמזהות בעיות שה-audit הקודם לא תפס.
   נטען אחרי geometry-audit.js ומוסיף פונקציות ל-window.__geomAudit.
   ========================================================================== */

(function() {

/* 1.1 — כותרת בתחתית טור עם < 2 שורות אחריה (B3 / clubpenalties) */
function auditHeadingEscort(node, issues) {
    if (!node.children || node.children.length === 0) return;
    // רק טורים (column)
    if (node.type !== 'column' && node.type !== 'single-wide-col') {
        for (const c of node.children) auditHeadingEscort(c, issues);
        return;
    }
    const kids = node.children;
    for (let i = 0; i < kids.length; i++) {
        const kid = kids[i];
        if (kid.type === 'h4' || kid.type === 'h5' || kid.type === 'h6' || kid.type === 'h3') {
            const isLast = (i === kids.length - 1);
            const next = isLast ? null : kids[i + 1];
            const nextLines = next ? (next.lines || []).length || 0 : 0;

            if (isLast) {
                // כותרת בסוף טור בלי טקסט אחריה
                issues.push({
                    kind: 'heading-escort',
                    severity: 'high',
                    pageIdx: getPageIdxSafe(kid),
                    location: describePathSafe(kid),
                    headingLevel: kid.type,
                    childRect: kid.rect ? { x: Math.round(kid.rect.x), y: Math.round(kid.rect.y), w: Math.round(kid.rect.w), h: Math.round(kid.rect.h) } : null,
                    message: `כותרת ${kid.type} בסוף טור ללא טקסט אחריה — הכותרת "נשארה לבד"`
                });
            } else if (nextLines <= 1) {
                // פחות מ-2 שורות אחרי הכותרת
                issues.push({
                    kind: 'heading-escort',
                    severity: 'medium',
                    pageIdx: getPageIdxSafe(kid),
                    location: describePathSafe(kid),
                    headingLevel: kid.type,
                    nextLines: nextLines,
                    childRect: kid.rect ? { x: Math.round(kid.rect.x), y: Math.round(kid.rect.y), w: Math.round(kid.rect.w), h: Math.round(kid.rect.h) } : null,
                    message: `כותרת ${kid.type} עם ${nextLines} שורות בלבד אחריה — מומלץ ≥2 שורות (clubpenalties)`
                });
            } else if (nextLines === 2) {
                // בדיוק 2 שורות — אזהרה
                issues.push({
                    kind: 'heading-escort',
                    severity: 'low',
                    pageIdx: getPageIdxSafe(kid),
                    location: describePathSafe(kid),
                    headingLevel: kid.type,
                    nextLines: nextLines,
                    childRect: kid.rect ? { x: Math.round(kid.rect.x), y: Math.round(kid.rect.y), w: Math.round(kid.rect.w), h: Math.round(kid.rect.h) } : null,
                    message: `כותרת ${kid.type} עם 2 שורות אחריה — בגבול (clubpenalties)`
                });
            }
        }
    }
}

/* 1.4 — בלוק עם כותרת H3 בלבד (ללא טקסט גוף אחריה) — כותרת אלמנה
   [תיקון — הערת משתמש] multiple-blocks אינה בעיה! זרימת הטקסט הטבעית היא:
   עמוד → בלוק 1 → טור ימני ← טור שמאלי ← כותרת ← בלוק 2 → טור ימני ← טור שמאלי ← עמוד הבא.
   אין שום פגם בשני בלוקים באותו עמוד.
   אבל אם בלוק מכיל רק כותרת H3 רוחבית בלי טקסט גוף — זו כותרת אלמנה! */
function auditOrphanH3Block(page, issues) {
    function findBlocks(node) {
        const blocks = [];
        if (node.type === 'block-2col' || node.type === 'block-single-col' || node.type === 'block-h3-span') {
            blocks.push(node);
        }
        for (const c of (node.children || [])) {
            blocks.push(...findBlocks(c));
        }
        return blocks;
    }
    const blocks = [];
    for (const c of (page.children || [])) blocks.push(...findBlocks(c));

    for (const block of blocks) {
        // [תיקון] block-h3-span מכיל רק H3 רוחבית — זה תקין! הטקסט בא בבלוק הבא.
        // רק block-2col או block-single-col עם כותרת בלבד היא בעיה.
        if (block.type === 'block-h3-span') continue;
        // בדוק אם הבלוק מכיל רק כותרות (ללא פסקאות טקסט)
        function hasParagraph(n) {
            if (n.type === 'p-cut' || n.type === 'p-end') return true;
            return (n.children || []).some(hasParagraph);
        }
        const hasText = hasParagraph(block);
        if (!hasText) {
            // בלוק עם כותרת בלבד — כותרת אלמנה
            const headingTypes = (block.children || []).map(c => c.type).filter(t => t && t.startsWith('h'));
            issues.push({
                kind: 'orphan-heading-block',
                severity: 'medium',
                pageIdx: page.idx,
                location: `page ${page.label}`,
                blockType: block.type,
                headingTypes,
                childRect: block.rect ? { x: Math.round(block.rect.x), y: Math.round(block.rect.y), w: Math.round(block.rect.w), h: Math.round(block.rect.h) } : null,
                message: `בלוק ${block.type} בעמוד ${page.label} מכיל רק כותרת (${headingTypes.join(', ')}) ללא טקסט גוף — כותרת אלמנה`
            });
        }
    }
}

/* 1.5 — הערה שארוכה מעמוד (footnote overflow)
   [תיקון — כלל עבודה] סף 15px — מתעלם מחריגות קטנות שאינן נראות לעין.
   ה-engine מתיר חריגה קטנת באזור ההערות לצורכי עיגול והכלה. */
function auditFootnoteOverflow(page, issues) {
    const wrapper = page.children[0];
    if (!wrapper) return;
    const fnArea = (wrapper.children || []).find(c => c.type === 'footnote-area');
    if (!fnArea) return;

    // סכום גובה כל note-line
    let totalNoteH = 0;
    let noteLineCount = 0;
    function sumNotes(node) {
        // [תיקון — Task fix-footnote-overflow-ch9] לא מוסיפים את fn-block.rect.h,
        // כי הוא מכיל כבר את כל ילדיו מסוג fn-line (bounding box). הוספה של fn-block
        // גורמת לסכום כפול — fn-block.h + sum(fn-line.h) — ולדיווחי false-positive של
        // footnote-overflow. רוצים למדוד רק את סכום גובה ה-fn-line (השורות בפועל).
        if (node.type === 'fn-line') {
            totalNoteH += node.rect ? node.rect.h : 0;
            noteLineCount++;
        }
        for (const c of (node.children || [])) sumNotes(c);
    }
    sumNotes(fnArea);

    const fnAreaH = fnArea.rect ? fnArea.rect.h : 0;
    const overflow = totalNoteH - fnAreaH;
    // [כלל עבודה] סף 15px — אל תדווח על חריגות שאינן נראות לעין
    if (overflow > 15) {
        issues.push({
            kind: 'footnote-overflow',
            severity: overflow > 30 ? 'high' : 'medium',
            pageIdx: page.idx,
            location: `page ${page.label}`,
            noteLines: noteLineCount,
            totalNoteH: Math.round(totalNoteH),
            fnAreaH: Math.round(fnAreaH),
            overflow: Math.round(overflow),
            childRect: fnArea.rect ? { x: Math.round(fnArea.rect.x), y: Math.round(fnArea.rect.y), w: Math.round(fnArea.rect.w), h: Math.round(fnArea.rect.h) } : null,
            message: `הערות שוליים חורגות מאזור ההערות: ${Math.round(overflow)}px (${noteLineCount} שורות, גובה ${Math.round(totalNoteH)}px באזור ${Math.round(fnAreaH)}px)`
        });
    }
}

/* 1.6 — ריבועים במקום רווחים (U+E000 — Private Use Area) */
function auditPrivateUseCharacters(node, issues) {
    if (!node.text) return;
    const puaChars = [];
    for (let i = 0; i < node.text.length; i++) {
        const code = node.text.charCodeAt(i);
        if (code >= 0xE000 && code <= 0xF8FF) {
            puaChars.push({ char: node.text[i], code: 'U+' + code.toString(16).toUpperCase().padStart(4, '0') });
        }
    }
    if (puaChars.length > 0) {
        issues.push({
            kind: 'private-use-chars',
            severity: 'high',
            pageIdx: getPageIdxSafe(node),
            location: describePathSafe(node),
            chars: puaChars.slice(0, 5),
            count: puaChars.length,
            childRect: node.rect ? { x: Math.round(node.rect.x), y: Math.round(node.rect.y), w: Math.round(node.rect.w), h: Math.round(node.rect.h) } : null,
            message: `נמצאו ${puaChars.length} תווי Private Use Area (U+E000-F8FF) — עלולים להיות מוצגים כריבועים`
        });
    }
    for (const c of (node.children || [])) auditPrivateUseCharacters(c, issues);
}

/* 1.9 — גופן לא נטען (fallback detection) */
function auditFontNotLoaded(model, issues) {
    if (!model.pages || model.pages.length === 0) return;
    const fontBody = document.getElementById('font-body')?.value;
    if (!fontBody) return;

    // בדוק טעינת גופן באמצעות document.fonts.check()
    try {
        // נסה כמה גדלים נפוצים
        const sizes = ['12px', '16px', '10pt'];
        let loaded = false;
        for (const sz of sizes) {
            // fontBody יכול להכיל מספר גופנים מופרדים בפסיק — קח את הראשון
            const primaryFont = fontBody.split(',')[0].replace(/['"]/g, '').trim();
            if (document.fonts.check(`${sz} "${primaryFont}"`) || document.fonts.check(`${sz} ${primaryFont}`)) {
                loaded = true;
                break;
            }
        }
        if (!loaded) {
            // בדוק גם עם document.fonts.status
            const status = document.fonts.status;
            if (status !== 'loaded') {
                issues.push({
                    kind: 'font-not-loaded',
                    severity: 'high',
                    pageIdx: 0,
                    location: 'global',
                    setting: 'font-body',
                    expected: fontBody,
                    actual: `fonts.status=${status}`,
                    message: `גופן הגוף (${fontBody}) אינו נטען — document.fonts.status=${status}. הדפדפן משתמש בגופן חלופי עם מדדים שונים`
                });
            }
        }
    } catch(e) { /* ignore — document.fonts עלול לא להיות זמין */ }
}

/* 1.10 — מועמד מול סופי (פער גובה)
   [תיקון 2026-10-28 — נקודה 1 ממשתמש] הסבר:
   candidate-vs-final אינו בעיה עצמאית — זו אינדיקציה למציאת מקור בעיות.
   ה-engine מודד מועמדים עם isDryRun=true (placeholder 'א' קבוע) והרינדור הסופי
   משתמש ב-marker אמיתי (גימטריה ברוחב משתנה). הפער הוא approximation noise.
   כל 60 ה-cases ב-79 פרקים הראו איזון מצוין (Δ ≤ 3px בין טורים).
   פתרון: לא לדווח כבעיה נפרדת. נשאיר את הפונקציה אבל לא נדחוף issues.
   מי שרוצה את המידע יכול לקרוא data-layout-balance-rh/lh attributes ישירות
   מה-DOM. הסף הקודם (>25 / >50) הוסר לחלוטין.
*/
function auditCandidateVsFinalHeight(model, issues) {
    // [נקודה 1 ממשתמש — 2026-10-28] אינו בעיה עצמאית — אינדיקציה בלבד.
    // לא מדווחים עוד על candidate-vs-final כבעיה. הפונקציה נשמרת כ-no-op לתאימות
    // לאחור (קריאות קיימות ב-geometry-audit.js).
    // אם רוצים לראות את המידע, אפשר לקרוא data-layout-balance-rh/lh מ-attributes.
    return;
}

/* 1.8 — טופו (תווים שלא קיימים בגופן) — בדיקת רוחב תווים */
function auditTofu(model, issues) {
    if (!model.pages || model.pages.length === 0) return;
    // קח פסקה ראשונה ובדוק רוחב תווים
    const firstPage = model.pages[0];
    const el = window.__geomAudit?.findDom?.(firstPage);
    if (!el) return;
    const firstP = el.querySelector('.main-column p, .single-wide-col p');
    if (!firstP) return;

    try {
        const fontStr = getComputedStyle(firstP).fontFamily;
        const text = firstP.textContent || '';
        if (text.length < 2) return;

        // השתמש ב-Canvas API למדידת רוחב תווים
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.font = getComputedStyle(firstP).fontSize + ' ' + fontStr;

        // מדוד תו רגיל מול ריבוע
        const normalChar = text[0];
        const tofuChar = '\u25A1'; // □

        const normalW = ctx.measureText(normalChar).width;
        const tofuW = ctx.measureText(tofuChar).width;

        // אם הרוחב של תו רגיל שווה לרוחב של ריבוע, ייתכן שהתו לא בגופן
        // (הדפדפן מציג אותו כריבוע באותו רוחב)
        if (normalW > 0 && Math.abs(normalW - tofuW) < 0.5) {
            // בדוק עוד תווים
            let suspectCount = 0;
            for (let i = 0; i < Math.min(text.length, 100); i++) {
                const w = ctx.measureText(text[i]).width;
                if (w > 0 && Math.abs(w - tofuW) < 0.5) suspectCount++;
            }
            if (suspectCount > 5) {
                const bc = document.getElementById('book-container');
                const bcRect = bc ? bc.getBoundingClientRect() : { left: 0, top: 0 };
                const pRect = firstP.getBoundingClientRect();
                issues.push({
                    kind: 'tofu',
                    severity: 'high',
                    pageIdx: 0,
                    location: 'global',
                    suspectCount,
                    fontFamily: fontStr,
                    childRect: { x: Math.round(pRect.left - bcRect.left), y: Math.round(pRect.top - bcRect.top), w: Math.round(pRect.width), h: Math.round(pRect.height) },
                    message: `אפשרות לטופו: ${suspectCount} מתוך 100 תווים בעלי רוחב זהה לריבוע (□) — ייתכן שהגופן (${fontStr}) לא תומך בתווים אלו`
                });
            }
        }
    } catch(e) { /* ignore */ }
}

/* 1.7 — שבירת שורה אחרי סמן הערה */
function auditNoteMarkerLineBreak(node, issues) {
    if (!node.text) {
        for (const c of (node.children || [])) auditNoteMarkerLineBreak(c, issues);
        return;
    }
    // רק פסקאות
    if (node.type !== 'p-cut' && node.type !== 'p-end') return;

    const el = window.__geomAudit?.findDom?.(node);
    if (!el) return;

    const markers = el.querySelectorAll('.note-marker');
    for (const marker of markers) {
        const r = marker.getBoundingClientRect();
        // בדוק אם יש טקסט אחרי ה-marker באותה שורה
        const range = document.createRange();
        range.selectNodeContents(el);
        const rects = Array.from(range.getClientRects()).filter(rr => rr.width > 0.5 && rr.height > 0.5);
        // מצא שורה שה-marker בה
        const markerLine = rects.find(rr => Math.abs(rr.top - r.top) < 5);
        if (markerLine) {
            // בדוק אם יש טקסט אחרי ה-marker באותה שורה
            const textAfterMarker = rects.filter(rr =>
                Math.abs(rr.top - r.top) < 5 && rr.left > r.right - 2
            );
            if (textAfterMarker.length === 0) {
                // ה-marker בסוף שורה — בדוק אם יש שורה אחריו
                const nextLine = rects.find(rr => rr.top > r.bottom - 1);
                if (nextLine) {
                    const bc = document.getElementById('book-container');
                    const bcRect = bc ? bc.getBoundingClientRect() : { left: 0, top: 0 };
                    issues.push({
                        kind: 'note-marker-line-break',
                        severity: 'low',
                        pageIdx: getPageIdxSafe(node),
                        location: describePathSafe(node),
                    childRect: { x: Math.round(r.left - bcRect.left), y: Math.round(r.top - bcRect.top), w: Math.round(r.width), h: Math.round(r.height) },
                        message: `סמן הערה בסוף שורה — נראה כאילו הסמן "נשאר לבד"`
                    });
                }
            }
        }
    }
}

/* 1.11 — עמודה ריקה בבלוק 2-טורים (empty-column)
   דיווח כשבלוק .block-2col מכיל עמודה (right-col או left-col) ריקה לחלוטין או כמעט ריקה.
   סיבות אפשריות:
   1. balanceColumns נקראת כשיש רק פסקה אחת קצרה (לא יכולה להתפצל לפי getSplitRules minFirst/minLast).
      המועמד היחיד הוא {i: 1, l: 0} — כל הפריט ל-rCol, lCol ריק.
   2. ה-engine בחר מועמד {i: items.length, l: 0} שמכניס הכל ל-right.
   חומרה: HIGH — בלוק 2-טורים עם עמודה ריקה הוא פגם חמור בעימוד.
*/
function auditEmptyColumn(model, issues) {
    if (!model.pages) return;
    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;
        const blocks = el.querySelectorAll('.block-2col');
        blocks.forEach((blk, bi) => {
            const rC = blk.querySelector('.right-col');
            const lC = blk.querySelector('.left-col');
            if (!rC || !lC) return; // לא בלוק 2-טורים תקין

            const rChildren = rC.children.length;
            const lChildren = lC.children.length;
            const rH = Math.round(rC.scrollHeight);
            const lH = Math.round(lC.scrollHeight);

            // דלג על בלוקים ריקים לחלוטין (אין תוכן בכלל — לא נקראת balanceColumns)
            if (rChildren === 0 && lChildren === 0) return;

            const bc = document.getElementById('book-container');
            const bcRect = bc ? bc.getBoundingClientRect() : { left: 0, top: 0 };
            const blkRect = blk.getBoundingClientRect();

            // מקרה 1: עמודה אחת ריקה לחלוטין (0 ילדים), השנייה עם תוכן
            if (rChildren === 0 || lChildren === 0) {
                const emptyCol = rChildren === 0 ? 'right' : 'left';
                const otherH = rChildren === 0 ? lH : rH;
                issues.push({
                    kind: 'empty-column',
                    severity: 'high',
                    pageIdx: page.idx,
                    location: `page ${page.label} block ${bi + 1} (${emptyCol}-col empty)`,
                    emptyColumn: emptyCol,
                    rightChildren: rChildren,
                    leftChildren: lChildren,
                    rightHeight: rH,
                    leftHeight: lH,
                    childRect: { x: Math.round(blkRect.left - bcRect.left), y: Math.round(blkRect.top - bcRect.top), w: Math.round(blkRect.width), h: Math.round(blkRect.height) },
                    message: `בלוק 2-טורים עם עמודה ${emptyCol === 'right' ? 'ימנית' : 'שמאלית'} ריקה לחלוטין — ${rChildren} פריטים בימין (H=${rH}px), ${lChildren} בשמאל (H=${lH}px). זה באג: ה-engine הכניס את כל התוכן לטור אחד.`
                });
                return;
            }

            // מקרה 2: עמודה עם ילדים אבל scrollHeight קטן מאוד (כנראה ריקה בפועל — רק margin/padding)
            // סף: 10px — מתחת לזה זה חשוד
            const EMPTY_THRESHOLD = 10;
            if (rH < EMPTY_THRESHOLD || lH < EMPTY_THRESHOLD) {
                const emptyCol = rH < EMPTY_THRESHOLD ? 'right' : 'left';
                issues.push({
                    kind: 'empty-column',
                    severity: 'high',
                    pageIdx: page.idx,
                    location: `page ${page.label} block ${bi + 1} (${emptyCol}-col near-empty H=${rH < EMPTY_THRESHOLD ? rH : lH}px)`,
                    emptyColumn: emptyCol,
                    rightChildren: rChildren,
                    leftChildren: lChildren,
                    rightHeight: rH,
                    leftHeight: lH,
                    childRect: { x: Math.round(blkRect.left - bcRect.left), y: Math.round(blkRect.top - bcRect.top), w: Math.round(blkRect.width), h: Math.round(blkRect.height) },
                    message: `בלוק 2-טורים עם עמודה ${emptyCol === 'right' ? 'ימנית' : 'שמאלית'} כמעט ריקה (scrollHeight=${rH < EMPTY_THRESHOLD ? rH : lH}px) — חשד לתוכן שלא הוקצה כראוי.`
                });
            }
        });
    }
}

/* 1.12 — מספר חלונות מילה ראשונה בטור (multiple-first-word-window)
   דיווח כשטור (.right-col / .left-col) מכיל יותר מאלמנט אחד עם class `first-word-window`.
   כלל: רק הפסקה הראשונה בכל טור צריכה לקבל first-word-window.
   ה-engine מטפל בזה ב-fixDropWordInColumns שנקראת בסוף balanceColumns.
   סיבות אפשריות לכשלון:
   1. balanceColumns לא נקראה (Branch 4 ב-engine — רק justifyColumnVertically).
   2. fixDropWordInColumns נקראה אבל לא תפסה את כל ה-windows (למשל nested).
   3. פסקה מפוצלת p-cut קיבלה first-word-window גם בחלק השני.
   חומרה: HIGH — first-word-window על פסקה אמצעית גורם ל-float:right שמשבש את הטור.
*/
function auditMultipleFirstWordWindow(model, issues) {
    if (!model.pages) return;
    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;
        const blocks = el.querySelectorAll('.block-2col');
        blocks.forEach((blk, bi) => {
            const cols = blk.querySelectorAll('.right-col, .left-col');
            cols.forEach(col => {
                const colName = col.classList.contains('right-col') ? 'right' : 'left';
                const windows = col.querySelectorAll('p > .first-word-window');
                if (windows.length <= 1) return;

                // אסוף מידע על כל window: איזה פסקה, איזה טקסט, מיקום
                const pInfos = [];
                windows.forEach((w, i) => {
                    const p = w.closest('p');
                    if (p) {
                        const pText = (p.textContent || '').slice(0, 30).replace(/\s+/g, ' ');
                        const pIdx = Array.prototype.indexOf.call(col.querySelectorAll('p'), p);
                        pInfos.push(`p${pIdx >= 0 ? pIdx + 1 : '?'}: "${pText}..."`);
                    }
                });

                const bc = document.getElementById('book-container');
                const bcRect = bc ? bc.getBoundingClientRect() : { left: 0, top: 0 };
                const colRect = col.getBoundingClientRect();
                issues.push({
                    kind: 'multiple-first-word-window',
                    severity: 'high',
                    pageIdx: page.idx,
                    location: `page ${page.label} block ${bi + 1} ${colName}-col (${windows.length} windows)`,
                    windowCount: windows.length,
                    column: colName,
                    paragraphs: pInfos,
                    childRect: { x: Math.round(colRect.left - bcRect.left), y: Math.round(colRect.top - bcRect.top), w: Math.round(colRect.width), h: Math.round(colRect.height) },
                    message: `טור ${colName === 'right' ? 'ימני' : 'שמאלי'} מכיל ${windows.length} חלונות מילה ראשונה (first-word-window) — רק הפסקה הראשונה בטור צריכה לקבל window. ייתכן ש-fixDropWordInColumns לא רצה על הבלוק הזה. פסקאות: ${pInfos.join(' | ')}`
                });
            });
        });
    }
}

/* 1.13 — שורה אחרונה דלילה בטור (sparse-line-in-column)
   דיווח כשהשורה האחרונה של טור (כל פסקה שמסתיימת בתחתית הטור) דלילה.
   הבדיקה הקיימת 'sparse-line' (ב-geometry-audit.js) בודקת רק את ה-p-cut הימני
   ב-balanceColumns. הבדיקה הזו מרחיבה לכל פסקה שמסתיימת בתחתית טור.
   סיבה נפוצה: השורה האחרונה מכילה טקסט מוסגר () שיוצר רוחב קטן.
   חומרה: MEDIUM אם השורה האחרונה דלילה מ-30% מרוחב הטור, LOW אם 30-50%.
*/
function auditSparseLineInColumn(model, issues) {
    if (!model.pages) return;
    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;
        const blocks = el.querySelectorAll('.block-2col');
        blocks.forEach((blk, bi) => {
            const cols = blk.querySelectorAll('.right-col, .left-col');
            cols.forEach(col => {
                const colName = col.classList.contains('right-col') ? 'right' : 'left';
                // קח את הילד האחרון (פסקה או כותרת) של הטור
                const children = Array.from(col.children);
                if (children.length === 0) return;
                const lastChild = children[children.length - 1];
                if (lastChild.tagName !== 'P') return; // כותרת בסוף טור נתפסת ע"י heading-escort

                // קבל את רוחב הטור
                const colWidth = col.getBoundingClientRect().width;
                if (!colWidth || colWidth < 50) return;

                try {
                    const range = document.createRange();
                    range.selectNodeContents(lastChild);
                    const rects = Array.from(range.getClientRects())
                        .filter(r => r.width > 0.5 && r.height > 0.5);
                    if (rects.length < 2) return; // שורה אחת — לא ניתן לדווח

                    // אחד שורות לפי top
                    const map = new Map();
                    for (const r of rects) {
                        const k = Math.round(r.top * 2) / 2;
                        if (!map.has(k)) map.set(k, { l: r.left, r: r.right, t: r.top, b: r.bottom });
                        const e = map.get(k);
                        e.l = Math.min(e.l, r.left);
                        e.r = Math.max(e.r, r.right);
                        e.t = Math.min(e.t, r.top);
                        e.b = Math.max(e.b, r.bottom);
                    }
                    const lines = Array.from(map.values()).sort((a, b) => a.t - b.t);
                    const lastLine = lines[lines.length - 1];
                    const firstLine = lines[0];
                    const lastW = lastLine.r - lastLine.l;
                    const firstW = firstLine.r - firstLine.l;
                    const ratio = lastW / colWidth;

                    // דליל: ratio < 50% מרוחב הטור (לא רק מהשורה הראשונה — יותר קפדני)
                    // נעשה זאת רק אם יש 2+ שורות (לא שורה בודדת)
                    if (lines.length >= 2 && ratio < 0.5) {
                        const bc = document.getElementById('book-container');
                        const bcRect = bc ? bc.getBoundingClientRect() : { left: 0, top: 0 };
                        const colRect = col.getBoundingClientRect();
                        const pText = (lastChild.textContent || '').slice(0, 50).replace(/\s+/g, ' ');
                        const severity = ratio < 0.3 ? 'medium' : 'low';
                        // בדוק אם השורה האחרונה מכילה סוגריים
                        const hasParens = /\([^)]*\)/.test((lastChild.textContent || '').slice(-50));

                        issues.push({
                            kind: 'sparse-line-in-column',
                            severity: severity,
                            pageIdx: page.idx,
                            location: `page ${page.label} block ${bi + 1} ${colName}-col (last line)`,
                            column: colName,
                            lineCount: lines.length,
                            lastLineWidth: Math.round(lastW),
                            columnWidth: Math.round(colWidth),
                            ratio: Math.round(ratio * 100) / 100,
                            hasParens: hasParens,
                            childRect: { x: Math.round(colRect.left - bcRect.left), y: Math.round(colRect.top - bcRect.top), w: Math.round(colRect.width), h: Math.round(colRect.height) },
                            message: `שורה אחרונה דלילה בטור ${colName === 'right' ? 'ימני' : 'שמאלי'}: ${Math.round(lastW)}px מתוך ${Math.round(colWidth)}px (${Math.round(ratio*100)}%). פסקה אחרונה: "${pText}...". ${hasParens ? 'מכילה סוגריים () — ייתכן שזה גורם לדלילות.' : ''}`
                        });
                    }
                } catch (e) { /* ignore — getClientRects עלול להיכשל */ }
            });
        });
    }
}

/* הלפרים — משתמשים בפונקציות הקיימות מ-geometry-audit.js דרך API ציבורי */
function getPageIdxSafe(node) {
    try {
        if (window.__geomAudit && typeof window.__geomAudit.getPageIdx === 'function') {
            return window.__geomAudit.getPageIdx(node);
        }
    } catch(e) {}
    return -1;
}
function describePathSafe(node) {
    try {
        if (window.__geomAudit && typeof window.__geomAudit.describePath === 'function') {
            return window.__geomAudit.describePath(node);
        }
    } catch(e) {}
    return node ? (node.type || 'unknown') : 'unknown';
}

/* רישום ב-API הציבורי */
window.__geomAudit = window.__geomAudit || {};
Object.assign(window.__geomAudit, {
    auditHeadingEscort,
    auditOrphanH3Block,
    auditFootnoteOverflow,
    auditPrivateUseCharacters,
    auditFontNotLoaded,
    auditCandidateVsFinalHeight,  // [נקודה 1] כעת no-op — מידע בלבד
    auditTofu,
    auditNoteMarkerLineBreak,
    auditEmptyColumn,
    auditMultipleFirstWordWindow,
    auditSparseLineInColumn
});

console.log('[audit-expansion] נטען. 11 בדיקות חדשות זמינות.');

})();
