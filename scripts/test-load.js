const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('console', msg => console.log('CONSOLE:', msg.text()));
    page.on('pageerror', err => console.log('ERROR:', err.message));
    await page.goto('http://localhost:8765/index.html', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => !!document.querySelector('iframe#render-frame'), { timeout: 15000 });
    await page.waitForTimeout(3000);
    const iframe = page.frame({ name: 'render-frame' }) || page.frames().find((f) => f !== page.mainFrame());
    const result = await iframe.evaluate(() => {
        return {
            geomAuditLoaded: !!window.__geomAudit,
            auditExpansionLoaded: typeof window.__geomAudit?.auditHeadingEscort === 'function',
            geomAuditKeys: window.__geomAudit ? Object.keys(window.__geomAudit) : [],
        };
    });
    console.log('Result:', JSON.stringify(result, null, 2));
    await browser.close();
})().catch(e => { console.error('Error:', e.message); process.exit(1); });
