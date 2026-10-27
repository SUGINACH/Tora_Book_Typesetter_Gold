/* debug-sparse-line.js — בודק את ה-DOM של p-cut עם sparse-line כדי להבין את המבנה */
const { chromium } = require('playwright');
const fs = require('fs');
const path = path_module = require('path');

const BASE_URL = 'http://localhost:8765/index.html';
const TEST_TEXT_PATH = path_module.join(__dirname, '..', 'very_long_test_text.txt');

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
    const ch = chapters[2]; // chapter 3

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

    // Find p-cut elements with tokenId=7 on page 5
    const info = await iframe.evaluate(() => {
        const pages = document.querySelectorAll('#book-container .a4-page');
        const result = [];
        for (let pIdx = 0; pIdx < pages.length; pIdx++) {
            const page = pages[pIdx];
            const pCuts = page.querySelectorAll('p.p-cut');
            for (const p of pCuts) {
                const tokenId = p.getAttribute('data-token-id');
                const r = p.getBoundingClientRect();
                const off = (function(){ const bc = document.getElementById('book-container'); const r = bc.getBoundingClientRect(); return {x: r.left, y: r.top}; })();
                const pY = Math.round(r.top - off.y);
                const pH = Math.round(r.height);
                // Look for sparse line (last line < 50% of first line)
                const range = document.createRange();
                range.selectNodeContents(p);
                const rects = Array.from(range.getClientRects()).filter(rr => rr.width > 0.5 && rr.height > 0.5);
                const map = new Map();
                for (const rr of rects) {
                    const k = Math.round(rr.top * 2) / 2;
                    if (!map.has(k)) map.set(k, { l: rr.left, r: rr.right, t: rr.top, b: rr.bottom, h: rr.height });
                    const e = map.get(k);
                    e.l = Math.min(e.l, rr.left);
                    e.r = Math.max(e.r, rr.right);
                    e.t = Math.min(e.t, rr.top);
                    e.b = Math.max(e.b, rr.bottom);
                }
                const lines = Array.from(map.values()).sort((a,b) => a.t - b.t);
                if (lines.length < 2) continue;
                const first = lines[0];
                const last = lines[lines.length - 1];
                const firstW = first.r - first.l;
                const lastW = last.r - last.l;
                if (firstW > 0 && lastW < firstW * 0.5) {
                    // Sparse! Inspect the p-cut
                    const html = p.outerHTML.slice(0, 1000);
                    const children = Array.from(p.children).map(c => ({
                        tag: c.tagName,
                        cls: c.className,
                        text: (c.textContent || '').slice(0, 50)
                    }));
                    const parenSpans = p.querySelectorAll('.paren-text');
                    const parenInfo = [];
                    for (const sp of parenSpans) {
                        const sr = sp.getBoundingClientRect();
                        parenInfo.push({
                            cls: sp.className,
                            text: (sp.textContent || '').slice(0, 50),
                            top: Math.round(sr.top - off.y),
                            left: Math.round(sr.left - off.x),
                            width: Math.round(sr.width),
                            height: Math.round(sr.height),
                            fontSize: getComputedStyle(sp).fontSize
                        });
                    }
                    // Look at the last line area
                    const lastLineTopAbs = Math.round(last.t);
                    const lastLineTopRel = Math.round(last.t - r.top);
                    result.push({
                        pageIdx: pIdx,
                        tokenId,
                        rect: { y: pY, h: pH, bottom: pY + pH },
                        lineCount: lines.length,
                        firstW: Math.round(firstW),
                        lastW: Math.round(lastW),
                        lastLineTopAbs,
                        lastLineTopRel,
                        lastLineH: Math.round(last.h),
                        htmlPreview: html,
                        children,
                        parenSpans: parenInfo,
                        // Check ALL descendant spans (not just .paren-text)
                        allSpans: Array.from(p.querySelectorAll('span')).map(s => ({
                            cls: s.className,
                            text: (s.textContent || '').slice(0, 30),
                            top: Math.round(s.getBoundingClientRect().top - off.y),
                            h: Math.round(s.getBoundingClientRect().height),
                            fontSize: getComputedStyle(s).fontSize
                        }))
                    });
                }
            }
        }
        return result;
    });

    console.log('Sparse-line p-cuts found:', info.length);
    for (const r of info) {
        console.log('\n=== page', r.pageIdx + 1, '===');
        console.log('tokenId:', r.tokenId);
        console.log('rect:', r.rect);
        console.log('lineCount:', r.lineCount, ' firstW:', r.firstW, ' lastW:', r.lastW);
        console.log('lastLine: y=', r.lastLineTopAbs, '(rel:', r.lastLineTopRel, ') h=', r.lastLineH);
        console.log('html preview:', r.htmlPreview);
        console.log('direct children:', r.children);
        console.log('.paren-text spans:', r.parenSpans);
        console.log('ALL spans:', r.allSpans);
    }

    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
