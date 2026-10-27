const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE_URL = 'http://localhost:8765/index.html';
const TEST_TEXT_PATH = path.join('/home/z/my-project/Tora_Book_Typesetter_Gold', 'very_long_test_text.txt');
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
    const ch = chapters[7]; // chapter 8
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

    // Check all block-2col on all pages for data-layout-* attrs
    const result = await iframe.evaluate(() => {
        const pages = document.querySelectorAll('#book-container .a4-page');
        const out = [];
        for (let pIdx = 0; pIdx < pages.length; pIdx++) {
            const page = pages[pIdx];
            const blocks = page.querySelectorAll('.block-2col');
            for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
                const block = blocks[bIdx];
                const attrs = {};
                for (const a of Array.from(block.attributes)) {
                    if (a.name.startsWith('data-layout-')) {
                        attrs[a.name] = a.value;
                    }
                }
                const rC = block.querySelector('.right-col');
                const lC = block.querySelector('.left-col');
                const rH = rC ? rC.scrollHeight : null;
                const lH = lC ? lC.scrollHeight : null;
                out.push({
                    pageIdx: pIdx + 1,
                    blockIdx: bIdx + 1,
                    rH, lH, diff: rH - lH,
                    hasDataLayout: Object.keys(attrs).length > 0,
                    attrs
                });
            }
        }
        return out;
    });
    console.log('All block-2col elements:');
    for (const r of result) {
        const flag = r.hasDataLayout ? '✓' : '✗';
        console.log(`  ${flag} page ${r.pageIdx} block ${r.blockIdx}: rH=${r.rH} lH=${r.lH} diff=${r.diff}`);
        if (r.hasDataLayout) {
            for (const [k, v] of Object.entries(r.attrs)) {
                console.log(`      ${k}: ${v}`);
            }
        }
    }
    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
