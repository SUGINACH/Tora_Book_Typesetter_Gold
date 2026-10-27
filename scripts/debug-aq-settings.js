/* debug-aq-settings.js — check AQ settings state in iframe */
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
    const ch = chapters[7]; // chapter 8

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !!document.querySelector('iframe#render-frame'), { timeout: 15000 });
    await page.waitForTimeout(3000);
    const iframe = page.frame({ name: 'render-frame' }) || page.frames().find((f) => f !== page.mainFrame());

    // First check the AQ settings state in parent document
    const aqSettings = await page.evaluate(() => {
        const ids = ['aq-enabled', 'aq-word-spacing', 'aq-para-spacing', 'aq-line-height',
                     'aq-heading-spacing', 'aq-letter-spacing', 'aq-page-height',
                     'aq-heading-spacing-max', 'aq-line-height-max', 'aq-para-spacing-max',
                     'avoid-widows', 'avoid-orphans'];
        const out = {};
        for (const id of ids) {
            const el = document.getElementById(id);
            if (!el) { out[id] = 'MISSING'; continue; }
            if (el.type === 'checkbox') out[id] = el.checked;
            else out[id] = el.value;
        }
        return out;
    });
    console.log('AQ settings (parent doc):', JSON.stringify(aqSettings, null, 2));

    // Now render chapter 8 and inspect block-2col on page 4
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

    // Inspect block-2col on page 4
    const info = await iframe.evaluate(() => {
        const pages = document.querySelectorAll('#book-container .a4-page');
        const out = [];
        for (let pIdx = 0; pIdx < Math.min(pages.length, 10); pIdx++) {
            const page = pages[pIdx];
            const blocks = page.querySelectorAll('.block-2col');
            for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
                const block = blocks[bIdx];
                const rCol = block.querySelector('.right-col');
                const lCol = block.querySelector('.left-col');
                if (!rCol || !lCol) continue;
                const rH = rCol.scrollHeight;
                const lH = lCol.scrollHeight;
                if (Math.abs(rH - lH) > 5) {
                    // Imbalanced block — inspect contents
                    const rKids = Array.from(rCol.children).map(c => ({
                        tag: c.tagName,
                        cls: (c.className || '').slice(0, 60),
                        text: (c.textContent || '').slice(0, 30),
                        h: Math.round(c.getBoundingClientRect().height),
                        paddingBottom: c.style.paddingBottom || '',
                        lh: c.style.lineHeight || '',
                        baseLh: c.getAttribute('data-base-lh') || ''
                    }));
                    const lKids = Array.from(lCol.children).map(c => ({
                        tag: c.tagName,
                        cls: (c.className || '').slice(0, 60),
                        text: (c.textContent || '').slice(0, 30),
                        h: Math.round(c.getBoundingClientRect().height),
                        paddingBottom: c.style.paddingBottom || '',
                        lh: c.style.lineHeight || '',
                        baseLh: c.getAttribute('data-base-lh') || ''
                    }));
                    out.push({
                        pageIdx: pIdx,
                        blockIdx: bIdx,
                        rH, lH, diff: rH - lH,
                        rKidCount: rKids.length,
                        lKidCount: lKids.length,
                        rKids: rKids.slice(0, 5),
                        lKids: lKids.slice(0, 5)
                    });
                }
            }
        }
        return out;
    });
    console.log('\nImbalanced blocks on pages 1-10 of ch8:');
    for (const b of info) {
        console.log(`\n=== page ${b.pageIdx + 1}, block ${b.blockIdx + 1}: rH=${b.rH} lH=${b.lH} diff=${b.diff} ===`);
        console.log(`  rCol kids (${b.rKidCount}):`);
        for (const k of b.rKids) {
            console.log(`    ${k.tag} ${k.cls.slice(0,30)} h=${k.h} pb=${k.paddingBottom} lh=${k.lh} baseLh=${k.baseLh} text="${k.text}"`);
        }
        console.log(`  lCol kids (${b.lKidCount}):`);
        for (const k of b.lKids) {
            console.log(`    ${k.tag} ${k.cls.slice(0,30)} h=${k.h} pb=${k.paddingBottom} lh=${k.lh} baseLh=${k.baseLh} text="${k.text}"`);
        }
    }

    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
