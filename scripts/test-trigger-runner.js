const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE_URL = 'http://localhost:8765/index.html';

(async () => {
    const file = process.argv[2];
    if (!file) { console.error('Usage: node test-trigger-runner.js <file>'); process.exit(1); }
    
    const text = fs.readFileSync(file, 'utf8');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(BASE_URL, { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !!document.querySelector('iframe#render-frame'), { timeout: 15000 });
    await page.waitForTimeout(3000);
    const iframe = page.frame({ name: 'render-frame' }) || page.frames().find(f => f !== page.mainFrame());
    
    // Set source text for integrity checks
    await iframe.evaluate((src) => { window.__auditSourceText = src; }, text);
    
    const settings = await page.evaluate(() => collectAllSettingsForRenderer());
    const result = await page.evaluate(async ({ t, s }) => {
        return await new Promise((res, rej) => {
            const f = document.querySelector('iframe#render-frame');
            const h = (e) => {
                if (e.data?.type === 'render-done') { window.removeEventListener('message', h); clearTimeout(t2); res({ pageCount: e.data.pageCount }); }
                else if (e.data?.type === 'render-error') { window.removeEventListener('message', h); clearTimeout(t2); rej(new Error(e.data.error)); }
            };
            window.addEventListener('message', h);
            const t2 = setTimeout(() => { window.removeEventListener('message', h); rej(new Error('timeout')); }, 180000);
            f.contentWindow.postMessage({ type: 'typeset', text: t, settings: s }, '*');
        });
    }, { t: text, s: settings });
    
    await page.waitForTimeout(500);
    
    const audit = await iframe.evaluate(() => {
        const model = window.__geomAudit.extract();
        const result = window.__geomAudit.audit(model);
        return { summary: result.summary, issues: result.issues.slice(0, 30).map(i => ({ kind: i.kind, severity: i.severity, page: (i.pageIdx ?? -1) + 1, msg: (i.message || '').slice(0, 100) })) };
    });
    
    console.log(`File: ${path.basename(file)}`);
    console.log(`Pages: ${result.pageCount}`);
    console.log(`Summary: ${JSON.stringify(audit.summary)}`);
    console.log(`Issues by kind:`);
    const byKind = {};
    for (const i of audit.issues) byKind[i.kind] = (byKind[i.kind] || 0) + 1;
    for (const [k, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k}: ${n}`);
    }
    console.log(`\nTop issues:`);
    for (const i of audit.issues.slice(0, 10)) {
        console.log(`  [${i.severity}] ${i.kind} p${i.page}: ${i.msg}`);
    }
    
    await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
