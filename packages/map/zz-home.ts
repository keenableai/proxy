import {chromium} from 'playwright-core';
const [link, name] = process.argv.slice(2);
const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 1280, height: 900}, deviceScaleFactor: 2, colorScheme: name.includes('dark') ? 'dark' : 'light'});
await page.goto(link.replace('callbackUrl=%2Fagents', 'callbackUrl=%2F'));
await page.waitForLoadState('networkidle');
await page.goto('http://localhost:5173/demo-workspace');
await page.waitForSelector('section[aria-label="Agents"]');
await page.waitForTimeout(800);
const box = await page.locator('section[aria-label="Agents"]').boundingBox();
if (box) {
	await page.screenshot({path: `/home/vercel-sandbox/proxy/.context/${name}-top.png`, fullPage: true, clip: {x: box.x - 8, y: box.y - 8, width: box.width + 16, height: 640}});
	await page.screenshot({path: `/home/vercel-sandbox/proxy/.context/${name}-axis.png`, fullPage: true, clip: {x: box.x - 8, y: box.y + box.height - 160, width: box.width + 16, height: 168}});
}
await browser.close();
