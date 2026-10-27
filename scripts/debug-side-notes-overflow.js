/* debug-side-notes-overflow.js — בודק אם טקסט גולש לאזור הערות השוליים */
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

    let totalOverflowChapters = 0;
    let totalOverflowCount = 0;

    for (const ch of chapters) {
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

        await page.waitForTimeout(200);

        // Check each page for text overflowing into margin-col area
        const overflows = await iframe.evaluate(() => {
            const pages = document.querySelectorAll('#book-container .a4-page');
            const out = [];
            for (let pIdx = 0; pIdx < pages.length; pIdx++) {
                const page = pages[pIdx];
                // Find each block-2col
                const blocks = page.querySelectorAll('.block-2col');
                for (let bIdx = 0; bIdx < blocks.length; bIdx++) {
                    const block = blocks[bIdx];
                    // Get the margin-cols and columns
                    const marginCols = block.querySelectorAll('.margin-notes-column');
                    const cols = block.querySelectorAll('.main-column, .single-wide-col');
                    // For each margin-col, check if any text content overlaps its rect
                    for (let mIdx = 0; mIdx < marginCols.length; mIdx++) {
                        const mc = marginCols[mIdx];
                        const mcRect = mc.getBoundingClientRect();
                        // Check each p element inside columns for overflow into margin-col
                        for (let cIdx = 0; cIdx < cols.length; cIdx++) {
                            const col = cols[cIdx];
                            const paragraphs = col.querySelectorAll('p');
                            for (const p of paragraphs) {
                                // Get all text line rects in the paragraph
                                try {
                                    const range = document.createRange();
                                    range.selectNodeContents(p);
                                    const rects = Array.from(range.getClientRects()).filter(r => r.width > 1 && r.height > 1);
                                    for (const r of rects) {
                                        // Check if this rect overlaps the margin-col rect
                                        const overlap = !(r.right < mcRect.left + 1 || r.left > mcRect.right - 1 ||
                                                          r.bottom < mcRect.top + 1 || r.top > mcRect.bottom - 1);
                                        if (overlap) {
                                            // Significant overlap: text is in margin-col area
                                            const overlapX = Math.min(r.right, mcRect.right) - Math.max(r.left, mcRect.left);
                                            const overlapY = Math.min(r.bottom, mcRect.bottom) - Math.max(r.top, mcRect.top);
                                            const overlapArea = overlapX * overlapY;
                                            // Only report if text rect overlaps significantly (more than 30px²)
                                            if (overlapArea > 30) {
                                                out.push({
                                                    pageIdx: pIdx,
                                                    blockIdx: bIdx,
                                                    marginIdx: mIdx,
                                                    marginSide: mc.className.includes('right') ? 'right' : 'left',
                                                    text: (p.textContent || '').slice(0, 50),
                                                    textRect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
                                                    marginRect: { x: Math.round(mcRect.left), y: Math.round(mcRect.top), w: Math.round(mcRect.width), h: Math.round(mcRect.height) },
                                                    overlapArea: Math.round(overlapArea)
                                                });
                                            }
                                        }
                                    }
                                } catch (e) {}
                            }
                        }
                    }
                }
            }
            return out;
        });

        if (overflows.length > 0) {
            totalOverflowChapters++;
            totalOverflowCount += overflows.length;
            console.log(`\n=== Chapter ${ch.chapterNum}: ${overflows.length} overflow(s) ===`);
            for (const ov of overflows.slice(0, 3)) {
                console.log(`  page ${ov.pageIdx + 1} block ${ov.blockIdx} ${ov.marginSide}-margin:`);
                console.log(`    text: "${ov.text}"`);
                console.log(`    textRect: x=${ov.textRect.x} y=${ov.textRect.y} w=${ov.textRect.w} h=${ov.textRect.h}`);
                console.log(`    marginRect: x=${ov.marginRect.x} y=${ov.marginRect.y} w=${ov.marginRect.w} h=${ov.marginRect.h}`);
                console.log(`    overlapArea: ${ov.overlapArea}`);
            }
            if (overflows.length > 3) console.log(`  ... and ${overflows.length - 3} more`);
        }
    }

    console.log(`\n========== Summary ==========`);
    console.log(`Chapters with overflow: ${totalOverflowChapters}/${chapters.length}`);
    console.log(`Total overflow instances: ${totalOverflowCount}`);

    await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
