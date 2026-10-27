/* ==========================================================================
   audit-text-integrity.js — בדיקות שלמות טקסט והמרות (פריטים 2+3)
   --------------------------------------------------------------------------
   פריט 2: בדיקת שלמות טקסט — כל טקסט הגוף מהמקור חייב להיות ב-DOM
   פריט 3.4: וידוא המרת H7 לכותרת צד (side-note)
   פריט 3.5: וידוא המרת [] להערות שוליים (footnotes)
   ========================================================================== */

(function() {

/* ── פרסור מקור ───────────────────────────────────────────────────────── */

const STYLE_MARKER_RE = /^(שם הספר|נושא|נושא מפורט|פרטי מהדורא|שם המחבר|מקום ושנת|שמירת זכויות|פרטי הוצאה|פרטי קשר|פרטים נוספים)\s*-/;
const HEADING_RE = /^כותרת\s+([0-7])\s+מספר\s+/;
const BRACKET_RE = /\[([^\]]*)\]/g; // סוגריים מרובעות עם תוכן

function parseSourceText(rawText) {
    const lines = rawText.split('\n');
    const result = {
        bodyWords: [],         // מילים מטקסט הגוף (אחרי הסרת markers + brackets)
        h7Texts: [],           // טקסט של כותרות H7 (צריך להיות ב-side-notes)
        bracketContents: [],   // תוכן [...] שצריך להיות ב-footnotes
        headingTexts: {},      // טקסט כותרות לפי רמה
    };
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // דלג על מזהי סגנון
        if (STYLE_MARKER_RE.test(trimmed)) continue;
        // כותרות
        const headingMatch = trimmed.match(HEADING_RE);
        if (headingMatch) {
            const level = parseInt(headingMatch[1], 10);
            // חלץ את טקסט הכותרת (אחרי "כותרת N מספר M - ")
            const titleText = trimmed.replace(HEADING_RE, '').replace(/^.*?-\s*/, '').trim();
            if (!result.headingTexts[level]) result.headingTexts[level] = [];
            result.headingTexts[level].push(titleText);
            if (level === 7) {
                result.h7Texts.push(titleText);
            }
            continue;
        }
        // טקסט גוף — הסר סוגריים מרובעות
        let bodyText = trimmed;
        let m;
        while ((m = BRACKET_RE.exec(trimmed)) !== null) {
            result.bracketContents.push(m[1].trim());
        }
        bodyText = bodyText.replace(BRACKET_RE, ' ');
        // נורמליזציה: הסר ניקוד/טעמים, נורמליזציה רווחים
        bodyText = normalizeText(bodyText);
        // חלק למילים
        const words = bodyText.split(/\s+/).filter(w => w.length > 0);
        result.bodyWords.push(...words);
    }
    return result;
}

function normalizeText(text) {
    // הסר ניקוד וטעמים (U+0591-U+05C7, U+05F3-U+05F4)
    text = text.replace(/[\u0591-\u05C7\u05F3\u05F4]/g, '');
    // [תיקון טוקניזציה] נרמל את רווחים לפני/אחרי סימני פיסוק כדי למנוע הבדלי חלוקה
    // בין מקור ("בראשונה)" + ".") ל-DOM ("בראשונה).")
    // נתון: הוסף רווח לפני סוגריים סגירה ונקודה כדי שיהיו טוקנים נפרדים
    text = text.replace(/\s*([\)\}])/g, ' $1');  // רווח לפני סגירת סוגריים
    text = text.replace(/\s*([.])/g, ' $1');       // רווח לפני נקודה
    text = text.replace(/\s*([,;:])/g, ' $1');    // רווח לפני פסיק/נקודה-פסיק/נקודה-תוים
    // נורמליזציה רווחים
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

/* ── פריט 2: בדיקת שלמות טקסט ─────────────────────────────────────── */

function auditTextCompleteness(model, sourceText, issues) {
    if (!sourceText || !model.pages || model.pages.length === 0) return;
    const parsed = parseSourceText(sourceText);

    // אסוף טקסט מה-DOM
    const domWords = [];
    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;
        // אסוף מ-<p> ב-main-column ו-single-wide-col (גוף הטקסט)
        const ps = el.querySelectorAll('.main-column p, .single-wide-col p');
        for (const p of ps) {
            // התעלם מ-.note-marker (סמני הערות), אבל כלול .paren-text (טקסט מוסגר עדיין טקסט גוף)
            let text = '';
            for (const child of p.childNodes) {
                if (child.nodeType === 3) { // text node
                    text += child.textContent;
                } else if (child.nodeType === 1) { // element
                    if (child.classList?.contains('note-marker')) continue; // דלג על סמני הערות
                    text += child.textContent || '';
                }
            }
            text = normalizeText(text);
            const words = text.split(/\s+/).filter(w => w.length > 0);
            domWords.push(...words);
        }
    }

    // השוואה כ-multiset (סדר לא חשוב)
    const sourceMap = new Map();
    for (const w of parsed.bodyWords) {
        sourceMap.set(w, (sourceMap.get(w) || 0) + 1);
    }
    const domMap = new Map();
    for (const w of domWords) {
        domMap.set(w, (domMap.get(w) || 0) + 1);
    }

    // מילים חסרות (במקור אבל לא ב-DOM)
    const missing = [];
    for (const [word, count] of sourceMap) {
        const domCount = domMap.get(word) || 0;
        if (domCount < count) {
            missing.push({ word, sourceCount: count, domCount, deficit: count - domCount });
        }
    }
    // מילים עודפות (ב-DOM אבל לא במקור)
    const extra = [];
    for (const [word, count] of domMap) {
        const sourceCount = sourceMap.get(word) || 0;
        if (sourceCount < count) {
            extra.push({ word, domCount: count, sourceCount, excess: count - sourceCount });
        }
    }

    if (missing.length > 0) {
        const totalMissing = missing.reduce((a, m) => a + m.deficit, 0);
        // [תיקון 2026-10-28 — הערת משתמש] אל תדווח גלובלית (pageIdx=-1)!
        // מצא את העמוד הראשון שאינו שער — שם תצולם הבעיה.
        let firstNonSpecialPage = -1;
        for (let i = 0; i < model.pages.length; i++) {
            const cls = model.pages[i].cls || '';
            const isSpecial = cls.includes('blank-page') || cls.includes('sub-shaar-page') ||
                              cls.includes('main-shaar-page') || cls.includes('back-shaar-page') ||
                              cls.includes('toc-page');
            if (!isSpecial) { firstNonSpecialPage = i; break; }
        }
        issues.push({
            kind: 'text-completeness',
            // [כלל — החלטת משתמש] היעלמות מילים היא תמיד high, אפילו מילה אחת!
            // טקסט תורני — כל מילה קריטית. שום מילה לא אמורה להיעלם בעימוד.
            severity: 'high',
            pageIdx: firstNonSpecialPage >= 0 ? firstNonSpecialPage : 0,
            location: firstNonSpecialPage >= 0 ? `page ${model.pages[firstNonSpecialPage].label}` : 'global',
            missingWords: missing.slice(0, 20),
            totalMissing,
            message: `${totalMissing} מילים חסרות ב-DOM (קיימות במקור אבל לא בעמודים המרונדרים) — ייתכן שטקסט הלך לאיבוד בעימוד`
        });
    }
    if (extra.length > 5) {
        const totalExtra = extra.reduce((a, e) => a + e.excess, 0);
        let firstNonSpecialPage = -1;
        for (let i = 0; i < model.pages.length; i++) {
            const cls = model.pages[i].cls || '';
            const isSpecial = cls.includes('blank-page') || cls.includes('sub-shaar-page') ||
                              cls.includes('main-shaar-page') || cls.includes('back-shaar-page') ||
                              cls.includes('toc-page');
            if (!isSpecial) { firstNonSpecialPage = i; break; }
        }
        issues.push({
            kind: 'text-completeness',
            severity: totalExtra > 20 ? 'medium' : 'low',
            pageIdx: firstNonSpecialPage >= 0 ? firstNonSpecialPage : 0,
            location: firstNonSpecialPage >= 0 ? `page ${model.pages[firstNonSpecialPage].label}` : 'global',
            extraWords: extra.slice(0, 10),
            totalExtra,
            message: `${totalExtra} מילים עודפות ב-DOM (לא במקור) — ייתכן שטקסט מזהה סגנון לא סונן`
        });
    }
}

/* ── פריט 3.4: וידוא המרת H7 לכותרת צד ────────────────────────────── */

function auditH7ToSideNote(model, sourceText, issues) {
    if (!sourceText || !model.pages || model.pages.length === 0) return;
    const parsed = parseSourceText(sourceText);
    if (parsed.h7Texts.length === 0) return;

    // [תיקון 2026-10-28 — הערת משתמש — גישה חדשה לפי עמוד]
    // הגישה הישנה: חיפשה טקסט H7 בכל ה-DOM גלובלית → false positive כשהטקסט
    // מופיע גם בגוף כציטוט גמרא. גם דיווחה גלובלית (pageIdx=-1) וה-PDF צילם עמוד ראשון.
    //
    // הגישה החדשה: לכל עמוד, בצע שתי בדיקות:
    // א. לכל פסקה עם data-side-note, בדוק שה-side-note-anchor עם data-for-token
    //    התואם נמצא באותו עמוד. אם לא — דווח על העמוד הספציפי.
    // ב. בדוק אם יש פסקה שמתחילה ב"כותרת 7" — זה אומר שה-H7 לא הומר כלל
    //    (הכשל קרה לפני ההמרה, והפסקה הגיעה כטקסט גוף במקום כותרת צד).

    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;

        const bc = document.getElementById('book-container');
        const bcRect = bc ? bc.getBoundingClientRect() : { left: 0, top: 0 };

        // בדיקה א: פסקה עם data-side-note אבל בלי side-note-anchor באותו עמוד
        const psWithSideNote = el.querySelectorAll('p[data-side-note]');
        if (psWithSideNote.length > 0) {
            const sideNoteTokens = new Set();
            el.querySelectorAll('.side-note-anchor').forEach(sn => {
                const tid = sn.getAttribute('data-for-token');
                if (tid) sideNoteTokens.add(tid);
            });

            for (const p of psWithSideNote) {
                const tokenId = p.getAttribute('data-token-id');
                const sideNoteText = p.getAttribute('data-side-note') || '';
                if (!tokenId) continue;

                if (!sideNoteTokens.has(tokenId)) {
                    const pRect = p.getBoundingClientRect();
                    issues.push({
                        kind: 'h7-conversion',
                        severity: 'high',
                        pageIdx: page.idx,
                        location: `page ${page.label}`,
                        tokenId: tokenId,
                        sideNoteText: sideNoteText.slice(0, 60),
                        childRect: { x: Math.round(pRect.left - bcRect.left), y: Math.round(pRect.top - bcRect.top), w: Math.round(pRect.width), h: Math.round(pRect.height) },
                        message: `כותרת צד "${sideNoteText.slice(0, 40)}" (token ${tokenId}) לא נמצאה בעמוד ${page.label} — המרת H7→side-note נכשלה בעמוד זה`
                    });
                }
            }
        }

        // בדיקה ב: פסקה שמתחילה ב"כותרת 7" — ה-H7 לא הומר כלל
        const allPs = el.querySelectorAll('.main-column p, .single-wide-col p');
        for (const p of allPs) {
            const pText = (p.textContent || '').trim();
            // בדוק אם הפסקה מתחילה ב"כותרת 7" (או "כותרת 7 מספר")
            if (/^כותרת\s*7\b/.test(pText)) {
                const pRect = p.getBoundingClientRect();
                issues.push({
                    kind: 'h7-conversion',
                    severity: 'high',
                    pageIdx: page.idx,
                    location: `page ${page.label}`,
                    paragraphText: pText.slice(0, 80),
                    childRect: { x: Math.round(pRect.left - bcRect.left), y: Math.round(pRect.top - bcRect.top), w: Math.round(pRect.width), h: Math.round(pRect.height) },
                    message: `פסקה בעמוד ${page.label} מתחילה ב"כותרת 7" — H7 לא הומר לכותרת צד. טקסט: "${pText.slice(0, 60)}..."`
                });
            }
        }
    }
}

/* ── פריט 3.5: וידוא המרת [] להערות שוליים ────────────────────────── */

function auditBracketToFootnote(model, sourceText, issues) {
    if (!sourceText || !model.pages || model.pages.length === 0) return;
    const parsed = parseSourceText(sourceText);
    if (parsed.bracketContents.length === 0) return;

    // אסוף טקסט מ-note-line ב-footnote-area
    const domFootnoteTexts = [];
    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;
        const noteLines = el.querySelectorAll('.footnote-area .note-line, .fn-block .note-line');
        for (const nl of noteLines) {
            const text = normalizeText(nl.textContent || '');
            if (text) domFootnoteTexts.push(text);
        }
    }

    // בדוק שכל [...] מהמקור מופיע ב-footnotes
    let missingCount = 0;
    const missing = [];
    for (const bracketText of parsed.bracketContents) {
        const normalized = normalizeText(bracketText);
        if (normalized.length < 3) continue; // דלג על סוגריים ריקות/קצרות
        // חפש התאמה חלקית — לפחות 10 תווים ראשונים
        const prefix = normalized.slice(0, Math.min(10, normalized.length));
        const found = domFootnoteTexts.some(fn => fn.includes(prefix));
        if (!found) {
            missingCount++;
            missing.push(normalized.slice(0, 50));
        }
    }

    // [תיקון 2026-10-28 — הערת משתמש] אל תדווח גלובלית (pageIdx=-1)!
    // בדוק עמוד-עמוד ודווח על העמוד שבו הסוגריים נמצאים.
    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;
        // דלג על עמודי שער
        const cls = page.cls || '';
        const isSpecial = cls.includes('blank-page') || cls.includes('sub-shaar-page') ||
                          cls.includes('main-shaar-page') || cls.includes('back-shaar-page') ||
                          cls.includes('toc-page');
        if (isSpecial) continue;

        const ps = el.querySelectorAll('.main-column p, .single-wide-col p');
        for (const p of ps) {
            const pText = p.textContent || '';
            for (const bracketText of parsed.bracketContents) {
                if (bracketText.length < 3) continue;
                // אם הסוגריים המרובעות עדיין בטקסט — בעיה בעמוד זה
                if (pText.includes('[' + bracketText.slice(0, 10))) {
                    const bc = document.getElementById('book-container');
                    const bcRect = bc ? bc.getBoundingClientRect() : { left: 0, top: 0 };
                    const pRect = p.getBoundingClientRect();
                    issues.push({
                        kind: 'bracket-conversion',
                        severity: 'high',
                        pageIdx: page.idx,
                        location: `page ${page.label}`,
                        bracketText: bracketText.slice(0, 60),
                        childRect: { x: Math.round(pRect.left - bcRect.left), y: Math.round(pRect.top - bcRect.top), w: Math.round(pRect.width), h: Math.round(pRect.height) },
                        message: `סוגריים מרובעות "[${bracketText.slice(0, 40)}...]" נמצאו בגוף הטקסט בעמוד ${page.label} — המרת []→footnote נכשלה`
                    });
                    break; // דלג על שאר ה-brackets בפסקה זו
                }
            }
        }
    }

    if (missingCount > 0) {
        // [תיקון 2026-10-28] מצא עמוד נציג (ראשון שאינו שער)
        let firstNonSpecialPage = -1;
        for (let i = 0; i < model.pages.length; i++) {
            const cls = model.pages[i].cls || '';
            const isSpecial = cls.includes('blank-page') || cls.includes('sub-shaar-page') ||
                              cls.includes('main-shaar-page') || cls.includes('back-shaar-page') ||
                              cls.includes('toc-page');
            if (!isSpecial) { firstNonSpecialPage = i; break; }
        }
        issues.push({
            kind: 'bracket-conversion',
            severity: 'high',
            pageIdx: firstNonSpecialPage >= 0 ? firstNonSpecialPage : 0,
            location: firstNonSpecialPage >= 0 ? `page ${model.pages[firstNonSpecialPage].label}` : 'global',
            expected: `${parsed.bracketContents.length} bracket contents`,
            found: `${parsed.bracketContents.length - missingCount} in footnotes`,
            missing: missing.slice(0, 5),
            missingCount,
            message: `${missingCount} מתוך ${parsed.bracketContents.length} תוכני סוגריים מרובעות לא נמצאו בהערות שוליים — ייתכן שהמרת []→footnote נכשלה`
        });
    }
    // [הוסר 2026-10-28] הבדיקה "inBodyCount" הוחלפה בבדיקה עמוד-עמוד למעלה.
}

/* ── רישום ב-API הציבורי ────────────────────────────────────────── */

window.__geomAudit = window.__geomAudit || {};
Object.assign(window.__geomAudit, {
    auditTextCompleteness,
    auditH7ToSideNote,
    auditBracketToFootnote,
    parseSourceText,
    normalizeAuditText: normalizeText
});

console.log('[audit-text-integrity] נטען. 3 בדיקות חדשות: text-completeness, h7-conversion, bracket-conversion.');

})();
