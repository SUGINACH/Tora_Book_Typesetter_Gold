/* debug-collectLines-vs-enrichNode.js */
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
    const text = fs.readFileSync(TEST_TEXT_PATH, 'utf8');
    const chapters = splitTextIntoChapters(text);
    const ch = chapters[62]; // chapter 75

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
                if (e.data?.type === 'render-done') { window.removeEventListener('message', h); clearTimeout(timer); res({ pageCount: e.data.pageCount || 0 }); }
                else if (e.data?.type === 'render-error') { window.removeEventListener('message', h); clearTimeout(timer); rej(new Error(e.data.error)); }
            };
            window.addEventListener('message', h);
            const timer = setTimeout(() => { window.removeEventListener('message', h); rej(new Error('timeout')); }, 180000);
            f.contentWindow.postMessage({ type: 'typeset', text: chapterText, settings }, '*');
        });
    }, { chapterText: ch.text, settings });

    await page.waitForTimeout(500);

    // For each p-cut on page 19 (idx 18), print collectLines output and compare
    const result = await iframe.evaluate(() => {
        const pages = document.querySelectorAll('#book-container .a4-page');
        const page = pages[18]; // page 7 (0-indexed)
        if (!page) return { error: 'no page 7' };
        const pCuts = page.querySelectorAll('p.p-cut');
        const out = [];
        const off = (function(){ const bc = document.getElementById('book-container'); const r = bc.getBoundingClientRect(); return {x: r.left, y: r.top}; })();

        // Replicate collectLines
        function collectLines(el) {
            const lines = [];
            try {
                const range = document.createRange();
                range.selectNodeContents(el);
                const rects = range.getClientRects();
                const seen = new Set();
                for (let i = 0; i < rects.length; i++) {
                    const r = rects[i];
                    if (r.height < 1 || r.width < 1) continue;
                    const key = Math.round(r.top - off.y) + ':' + Math.round(r.height);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    lines.push({
                        x: r.left - off.x, y: r.top - off.y, w: r.width, h: r.height,
                        right: r.right - off.x, bottom: r.bottom - off.y,
                        idx: lines.length
                    });
                }
            } catch (e) {}
            lines.sort((a, b) => a.y - b.y || a.x - b.x);
            lines.forEach((l, i) => l.idx = i);
            return lines;
        }

        for (const p of pCuts) {
            const r = p.getBoundingClientRect();
            const lines = collectLines(p);
            if (lines.length < 2) continue;
            const first = lines[0];
            const last = lines[lines.length - 1];
            const isSparse = first.w > 0 && last.w < first.w * 0.5;
            // Check paren-text overlap with last line
            const parenSpans = p.querySelectorAll('.paren-text');
            const parenInfo = [];
            for (const sp of parenSpans) {
                const sr = sp.getBoundingClientRect();
                parenInfo.push({
                    cls: sp.className,
                    text: (sp.textContent || '').slice(0, 30),
                    top: Math.round(sr.top - off.y),
                    bottom: Math.round(sr.bottom - off.y),
                    h: Math.round(sr.height)
                });
            }
            const noteMarkers = p.querySelectorAll('.note-marker');
            const noteInfo = [];
            for (const nm of noteMarkers) {
                const sr = nm.getBoundingClientRect();
                noteInfo.push({
                    cls: nm.className,
                    text: (nm.textContent || '').slice(0, 30),
                    top: Math.round(sr.top - off.y),
                    bottom: Math.round(sr.bottom - off.y),
                    h: Math.round(sr.height)
                });
            }
            out.push({
                tokenId: p.getAttribute('data-token-id'),
                rect: { y: Math.round(r.top - off.y), h: Math.round(r.height) },
                lineCount: lines.length,
                firstW: Math.round(first.w),
                lastW: Math.round(last.w),
                lastY: Math.round(last.y),
                lastH: Math.round(last.h),
                isSparse,
                lines: lines.map(l => ({x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h)})),
                parenSpans: parenInfo,
                noteMarkers: noteInfo
            });
        }
        return out;
    });

    console.log('p-cuts on page 19:', result.length);
    for (const r of result) {
        console.log('\n===', 'tokenId:', r.tokenId, '===');
        console.log('rect:', r.rect, ' lineCount:', r.lineCount, ' firstW:', r.firstW, ' lastW:', r.lastW);
        console.log('lastLine: y=', r.lastY, ' h=', r.lastH, ' isSparse:', r.isSparse);
        console.log('lines:');
        for (let i = 0; i < r.lines.length; i++) {
            console.log(`  line ${i}: x=${r.lines[i].x} y=${r.lines[i].y} w=${r.lines[i].w} h=${r.lines[i].h}`);
        }
        console.log('parenSpans:', r.parenSpans);
        console.log('noteMarkers:', r.noteMarkers);
    }

    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
