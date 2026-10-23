import {chromium} from 'playwright-core';
const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});
for (const width of [1280, 900]) {
	const page = await browser.newPage({viewport: {width, height: 900}, deviceScaleFactor: 2});
	await page.goto('http://localhost:5173/login');
	await page.getByRole('button', {name: 'Log in as dev user'}).click();
	await page.waitForURL(/devs-workspace/);
	const section = page.locator('section[aria-label="Agents"]');
	await section.waitFor();
	await page.getByRole('combobox', {name: 'Window'}).click();
	await page.getByRole('option', {name: 'Last hour'}).click();
	const box = await section.boundingBox();
	if (!box) throw new Error('no timeline');
	await page.mouse.move(box.x + box.width * 0.6, box.y + 100);
	await page.keyboard.down('Control');
	await page.mouse.wheel(0, -100);
	await page.keyboard.up('Control');
	await page.waitForTimeout(300);
	for (let i = 0; i < 12; i++) await page.mouse.wheel(-2000, 0);
	await page.waitForTimeout(1500);
	const labels = await section.locator('.tabular-nums span').allInnerTexts();
	console.log(width, 'window:', await page.getByRole('combobox', {name: 'Window'}).innerText(), '| labels:', labels.join(' | '));
	const top = await section.boundingBox();
	if (top) await page.screenshot({path: `/home/vercel-sandbox/proxy/.context/ticks-${width}.png`, clip: {x: top.x - 8, y: top.y + top.height - 220, width: top.width + 16, height: 228}});
	await page.close();
}
await browser.close();
