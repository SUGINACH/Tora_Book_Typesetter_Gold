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
        if (node.type === 'fn-line' || node.type === 'fn-block') {
            totalNoteH += node.rect ? node.rect.h : 0;
            if (node.type === 'fn-line') noteLineCount++;
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

/* 1.10 — מועמד מול סופי (פער גובה) */
function auditCandidateVsFinalHeight(model, issues) {
    if (!model.pages) return;
    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;
        const blocks = el.querySelectorAll('.block-2col');
        blocks.forEach((blk, bi) => {
            const recordedRH = parseFloat(blk.getAttribute('data-layout-balance-rh'));
            const recordedLH = parseFloat(blk.getAttribute('data-layout-balance-lh'));
            if (isNaN(recordedRH) || isNaN(recordedLH)) return;

            const rC = blk.querySelector('.right-col');
            const lC = blk.querySelector('.left-col');
            if (!rC || !lC) return;
            const actualRH = Math.round(rC.scrollHeight);
            const actualLH = Math.round(lC.scrollHeight);

            const diffR = Math.abs(actualRH - recordedRH);
            const diffL = Math.abs(actualLH - recordedLH);
            const maxDiff = Math.max(diffR, diffL);

            if (maxDiff > 5) {
                issues.push({
                    kind: 'candidate-vs-final',
                    severity: maxDiff > 20 ? 'medium' : 'low',
                    pageIdx: page.idx,
                    location: `page ${page.label} block ${bi + 1}`,
                    recordedRH, recordedLH, actualRH, actualLH,
                    diffR: Math.round(diffR), diffL: Math.round(diffL),
                    message: `פער בין גובה מועמד לסופי: R=${recordedRH}→${actualRH} (Δ${Math.round(diffR)}), L=${recordedLH}→${actualLH} (Δ${Math.round(diffL)})`
                });
            }
        });
    }
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
                issues.push({
                    kind: 'tofu',
                    severity: 'high',
                    pageIdx: 0,
                    location: 'global',
                    suspectCount,
                    fontFamily: fontStr,
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
                    issues.push({
                        kind: 'note-marker-line-break',
                        severity: 'low',
                        pageIdx: getPageIdxSafe(node),
                        location: describePathSafe(node),
                        message: `סמן הערה בסוף שורה — נראה כאילו הסמן "נשאר לבד"`
                    });
                }
            }
        }
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
    auditCandidateVsFinalHeight,
    auditTofu,
    auditNoteMarkerLineBreak
});

console.log('[audit-expansion] נטען. 8 בדיקות חדשות זמינות.');

})();
