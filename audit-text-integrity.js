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
        issues.push({
            kind: 'text-completeness',
            severity: totalMissing > 10 ? 'high' : (totalMissing > 3 ? 'medium' : 'low'),
            pageIdx: -1, location: 'global',
            missingWords: missing.slice(0, 10),
            totalMissing,
            message: `${totalMissing} מילים חסרות ב-DOM (קיימות במקור אבל לא בעמודים המרונדרים) — ייתכן שטקסט הלך לאיבוד בעימוד`
        });
    }
    if (extra.length > 5) {
        const totalExtra = extra.reduce((a, e) => a + e.excess, 0);
        issues.push({
            kind: 'text-completeness',
            severity: totalExtra > 20 ? 'medium' : 'low',
            pageIdx: -1, location: 'global',
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

    // אסוף טקסט מ-side-note-anchor ב-DOM
    const domSideNoteTexts = [];
    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;
        const sideNotes = el.querySelectorAll('.side-note-anchor');
        for (const sn of sideNotes) {
            const text = normalizeText(sn.textContent || '');
            if (text) domSideNoteTexts.push(text);
        }
    }

    // בדוק שכל H7 מהמקור מופיע ב-side-notes
    let missingCount = 0;
    const missing = [];
    for (const h7text of parsed.h7Texts) {
        const normalized = normalizeText(h7text);
        // חפש חלק מהטקסט ב-side-notes (עשוי להיות מקוצר)
        const found = domSideNoteTexts.some(sn => {
            // בדוק התאמה חלקית — לפחות 10 תווים ראשונים
            const prefix = normalized.slice(0, Math.min(10, normalized.length));
            return sn.includes(prefix);
        });
        if (!found) {
            missingCount++;
            missing.push(normalized.slice(0, 40));
        }
    }

    // בדוק ש-H7 לא מופיע כ-<p> בגוף הטקסט
    let inBodyCount = 0;
    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;
        const ps = el.querySelectorAll('.main-column p, .single-wide-col p');
        for (const p of ps) {
            const pText = normalizeText(p.textContent || '');
            for (const h7text of parsed.h7Texts) {
                const normalized = normalizeText(h7text);
                if (pText.includes(normalized.slice(0, Math.min(20, normalized.length)))) {
                    inBodyCount++;
                    break;
                }
            }
        }
    }

    if (missingCount > 0) {
        issues.push({
            kind: 'h7-conversion',
            severity: 'high',
            pageIdx: -1, location: 'global',
            expected: `${parsed.h7Texts.length} H7 headings`,
            found: `${parsed.h7Texts.length - missingCount} in side-notes`,
            missing: missing.slice(0, 5),
            missingCount,
            message: `${missingCount} מתוך ${parsed.h7Texts.length} כותרות H7 לא נמצאו בהערות צד — ייתכן שהמרת H7→side-note נכשלה`
        });
    }
    if (inBodyCount > 0) {
        issues.push({
            kind: 'h7-conversion',
            severity: 'high',
            pageIdx: -1, location: 'global',
            inBodyCount,
            message: `${inBodyCount} כותרות H7 נמצאו בגוף הטקסט (כ-p) במקום בהערות צד — המרת H7→side-note נכשלה`
        });
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

    // בדוק ש-[...] לא מופיע בגוף הטקסט
    let inBodyCount = 0;
    for (const page of model.pages) {
        const el = window.__geomAudit?.findDom?.(page);
        if (!el) continue;
        const ps = el.querySelectorAll('.main-column p, .single-wide-col p');
        for (const p of ps) {
            const pText = p.textContent || '';
            for (const bracketText of parsed.bracketContents) {
                if (bracketText.length < 3) continue;
                // אם הסוגריים המרובעות עדיין בטקסט — בעיה
                if (pText.includes('[' + bracketText.slice(0, 10))) {
                    inBodyCount++;
                    break;
                }
            }
        }
    }

    if (missingCount > 0) {
        issues.push({
            kind: 'bracket-conversion',
            severity: 'high',
            pageIdx: -1, location: 'global',
            expected: `${parsed.bracketContents.length} bracket contents`,
            found: `${parsed.bracketContents.length - missingCount} in footnotes`,
            missing: missing.slice(0, 5),
            missingCount,
            message: `${missingCount} מתוך ${parsed.bracketContents.length} תוכני סוגריים מרובעות לא נמצאו בהערות שוליים — ייתכן שהמרת []→footnote נכשלה`
        });
    }
    if (inBodyCount > 0) {
        issues.push({
            kind: 'bracket-conversion',
            severity: 'high',
            pageIdx: -1, location: 'global',
            inBodyCount,
            message: `${inBodyCount} תוכני סוגריים מרובעות עדיין בגוף הטקסט (עם [) — המרת []→footnote נכשלה`
        });
    }
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
