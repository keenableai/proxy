import {chromium} from 'playwright-core';
const [link, name, ...ids] = process.argv.slice(2);
const browser = await chromium.launch({executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox']});
const page = await browser.newPage({viewport: {width: 1280, height: 900}, deviceScaleFactor: 2, colorScheme: name.includes('dark') ? 'dark' : 'light'});
await page.goto(link.replace('callbackUrl=%2Fagents', 'callbackUrl=%2F'));
await page.waitForLoadState('networkidle');
const lanes = await page.evaluate(async () => (await fetch(`/api/orgs/demo-workspace/activity/lanes?from=${new Date(Date.now() - 30 * 3600e3).toISOString()}`)).json());
const job = lanes.tasks.find((t: {title: string; parentId: string | null}) => t.title === 'Prepare the board update' && t.parentId === null);
for (const [index, id] of [job?.id, ...ids].filter(Boolean).entries()) {
	await page.goto(`http://localhost:5173/demo-workspace/activity/tasks/${id}`);
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(500);
	const box = await page.locator('div.rounded-lg.border').first().boundingBox();
	if (box) await page.screenshot({path: `/home/vercel-sandbox/proxy/.context/${name}-${index}.png`, clip: {x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16}});
}
await browser.close();
