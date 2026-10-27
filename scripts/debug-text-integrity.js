/* debug-text-integrity.js — מצא את המילים החסרות וכותרות H7 הבעייתיות */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'http://localhost:8765/index.html';
const TEST_TEXT_PATH = path.join(__dirname, '..', 'very_long_test_text.txt');

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

(async () => {
    const CHAPTER_NUM = parseInt(process.argv[2] || '9', 10);
    const text = fs.readFileSync(TEST_TEXT_PATH, 'utf8');
    const chapters = splitTextIntoChapters(text);
    const ch = chapters[CHAPTER_NUM - 1];
    console.log(`פרק ${CHAPTER_NUM}: "${ch.title.slice(0, 60)}"\n`);

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

    await page.evaluate(async ({ chapterText, settings }) => {
        return await new Promise((res, rej) => {
            const f = document.querySelector('iframe#render-frame');
            const h = (e) => {
                if (e.data?.type === 'render-done') { window.removeEventListener('message', h); clearTimeout(timer); res({}); }
                else if (e.data?.type === 'render-error') { window.removeEventListener('message', h); clearTimeout(timer); rej(new Error(e.data.error)); }
            };
            window.addEventListener('message', h);
            const timer = setTimeout(() => { window.removeEventListener('message', h); rej(new Error('timeout')); }, 180000);
            f.contentWindow.postMessage({ type: 'typeset', text: chapterText, settings }, '*');
        });
    }, { chapterText: ch.text, settings });
    await page.waitForTimeout(500);

    // Run the integrity checks directly in the iframe
    const result = await iframe.evaluate((sourceText) => {
        const parsed = window.__geomAudit.parseSourceText(sourceText);
        const model = window.__geomAudit.extract();

        // --- Text Completeness ---
        const STYLE_MARKER_RE = /^(שם הספר|נושא|נושא מפורט|פרטי מהדורא|שם המחבר|מקום ושנת|שמירת זכויות|פרטי הוצאה|פרטי קשר|פרטים נוספים)\s*-/;
        const HEADING_RE = /^כותרת\s+([0-7])\s+מספר\s+/;
        const BRACKET_RE = /\[([^\]]*)\]/g;
        function normalizeText(text) {
            text = text.replace(/[\u0591-\u05C7\u05F3\u05F4]/g, '');
            text = text.replace(/\s+/g, ' ').trim();
            return text;
        }

        // Parse source
        const sourceWords = [];
        for (const line of sourceText.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (STYLE_MARKER_RE.test(trimmed)) continue;
            if (HEADING_RE.test(trimmed)) continue;
            let bodyText = trimmed.replace(BRACKET_RE, ' ');
            bodyText = normalizeText(bodyText);
            sourceWords.push(...bodyText.split(/\s+/).filter(w => w.length > 0));
        }

        // Parse DOM
        const domWords = [];
        for (const pg of model.pages) {
            const el = window.__geomAudit.findDom(pg);
            if (!el) continue;
            const ps = el.querySelectorAll('.main-column p, .single-wide-col p');
            for (const p of ps) {
                let text = '';
                for (const child of p.childNodes) {
                    if (child.nodeType === 3) text += child.textContent;
                    else if (child.nodeType === 1) {
                        if (child.classList?.contains('note-marker')) continue;
                        text += child.textContent || '';
                    }
                }
                text = normalizeText(text);
                domWords.push(...text.split(/\s+/).filter(w => w.length > 0));
            }
        }

        // Compare as multiset
        const sourceMap = new Map();
        for (const w of sourceWords) sourceMap.set(w, (sourceMap.get(w) || 0) + 1);
        const domMap = new Map();
        for (const w of domWords) domMap.set(w, (domMap.get(w) || 0) + 1);

        const missing = [];
        for (const [word, count] of sourceMap) {
            const domCount = domMap.get(word) || 0;
            if (domCount < count) {
                missing.push({ word, sourceCount: count, domCount, deficit: count - domCount });
            }
        }
        const extra = [];
        for (const [word, count] of domMap) {
            const sourceCount = sourceMap.get(word) || 0;
            if (sourceCount < count) {
                extra.push({ word, domCount: count, sourceCount, excess: count - sourceCount });
            }
        }

        // --- H7 Conversion ---
        const h7Texts = parsed.h7Texts || [];
        const domSideNoteTexts = [];
        for (const pg of model.pages) {
            const el = window.__geomAudit.findDom(pg);
            if (!el) continue;
            const sideNotes = el.querySelectorAll('.side-note-anchor');
            for (const sn of sideNotes) {
                const text = normalizeText(sn.textContent || '');
                if (text) domSideNoteTexts.push(text);
            }
        }
        const missingH7 = [];
        const h7InBody = [];
        for (const h7text of h7Texts) {
            const normalized = normalizeText(h7text);
            const prefix = normalized.slice(0, Math.min(10, normalized.length));
            const foundInSideNote = domSideNoteTexts.some(sn => sn.includes(prefix));
            if (!foundInSideNote) missingH7.push({ h7text: normalized, foundInSideNote: false });

            // Check if in body
            for (const pg of model.pages) {
                const el = window.__geomAudit.findDom(pg);
                if (!el) continue;
                const ps = el.querySelectorAll('.main-column p, .single-wide-col p');
                for (const p of ps) {
                    const pText = normalizeText(p.textContent || '');
                    if (pText.includes(normalized.slice(0, Math.min(20, normalized.length)))) {
                        h7InBody.push({
                            h7text: normalized.slice(0, 60),
                            pageIdx: pg.idx,
                            pPreview: pText.slice(0, 80)
                        });
                    }
                }
            }
        }

        // --- Bracket Conversion ---
        const bracketContents = parsed.bracketContents || [];
        const domFootnoteTexts = [];
        for (const pg of model.pages) {
            const el = window.__geomAudit.findDom(pg);
            if (!el) continue;
            const noteLines = el.querySelectorAll('.footnote-area .note-line, .fn-block .note-line');
            for (const nl of noteLines) {
                const text = normalizeText(nl.textContent || '');
                if (text) domFootnoteTexts.push(text);
            }
        }
        const missingBrackets = [];
        for (const bt of bracketContents) {
            const normalized = normalizeText(bt);
            if (normalized.length < 3) continue;
            const prefix = normalized.slice(0, Math.min(10, normalized.length));
            const found = domFootnoteTexts.some(fn => fn.includes(prefix));
            if (!found) missingBrackets.push(normalized.slice(0, 60));
        }

        return {
            sourceWordCount: sourceWords.length,
            domWordCount: domWords.length,
            missing,
            extra: extra.slice(0, 20),
            h7Texts: h7Texts.map(t => normalizeText(t).slice(0, 60)),
            domSideNoteCount: domSideNoteTexts.length,
            missingH7,
            h7InBody,
            bracketContents: bracketContents.map(b => normalizeText(b).slice(0, 60)),
            domFootnoteCount: domFootnoteTexts.length,
            missingBrackets
        };
    }, ch.text);

    console.log('=== TEXT COMPLETENESS ===');
    console.log(`Source words: ${result.sourceWordCount}, DOM words: ${result.domWordCount}`);
    console.log(`Missing words (${result.missing.length}):`);
    for (const m of result.missing) {
        console.log(`  "${m.word}" — source: ${m.sourceCount}, DOM: ${m.domCount}, deficit: ${m.deficit}`);
    }
    console.log(`Extra words (${result.extra.length}):`);
    for (const e of result.extra.slice(0, 10)) {
        console.log(`  "${e.word}" — DOM: ${e.domCount}, source: ${e.sourceCount}, excess: ${e.excess}`);
    }

    console.log('\n=== H7 CONVERSION ===');
    console.log(`H7 texts in source: ${result.h7Texts.length}`);
    for (const h of result.h7Texts) console.log(`  H7: "${h}"`);
    console.log(`Side-notes in DOM: ${result.domSideNoteCount}`);
    console.log(`Missing H7 (not in side-notes): ${result.missingH7.length}`);
    for (const m of result.missingH7) console.log(`  MISSING: "${m.h7text}"`);
    console.log(`H7 found in body text: ${result.h7InBody.length}`);
    for (const b of result.h7InBody) {
        console.log(`  IN BODY: "${b.h7text}" (page ${b.pageIdx + 1})`);
        console.log(`    paragraph preview: "${b.pPreview}..."`);
    }

    console.log('\n=== BRACKET CONVERSION ===');
    console.log(`Brackets in source: ${result.bracketContents.length}`);
    console.log(`Footnotes in DOM: ${result.domFootnoteCount}`);
    console.log(`Missing brackets: ${result.missingBrackets.length}`);
    for (const m of result.missingBrackets) console.log(`  MISSING: "${m}"`);

    await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
