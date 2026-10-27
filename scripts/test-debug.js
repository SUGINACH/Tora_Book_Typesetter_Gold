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
    const ch = chapters[8]; // chapter 9
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('console', msg => console.log('CONSOLE:', msg.text().slice(0,200)));
    page.on('pageerror', err => console.log('PAGEERROR:', err.message.slice(0,200)));
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !!document.querySelector('iframe#render-frame'), { timeout: 15000 });
    await page.waitForTimeout(3000);
    const iframe = page.frame({ name: 'render-frame' }) || page.frames().find((f) => f !== page.mainFrame());
    console.log('iframe URL:', iframe.url());
    
    // Set stepByStepAudit flag
    const setResult = await iframe.evaluate(() => {
        window.__stepByStepAudit = true;
        return { set: window.__stepByStepAudit, geomAudit: !!window.__geomAudit };
    });
    console.log('Set result:', JSON.stringify(setResult));
    
    const settings = await page.evaluate(() => {
        if (typeof collectAllSettingsForRenderer === 'function') return collectAllSettingsForRenderer();
        return {};
    });
    
    // Send text
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
    
    await page.waitForTimeout(500);
    
    // Read checkpoints
    const cpResult = await iframe.evaluate(() => {
        return {
            stepByStepAudit: window.__stepByStepAudit,
            checkpoints: (window.__auditCheckpoints || []).length,
            geomAuditExists: !!window.__geomAudit,
            auditHeadingEscortExists: typeof window.__geomAudit?.auditHeadingEscort === 'function'
        };
    });
    console.log('After render:', JSON.stringify(cpResult));
    console.log('Render result:', JSON.stringify(renderResult));
    
    await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
