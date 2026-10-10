import { chromium } from 'playwright';
const [,, dir, ...names] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
for (const n of names) {
  await p.goto(`file://${dir}/src/${n}.html`); await p.waitForLoadState('networkidle'); await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${dir}/${n}.png` });
}
await b.close();
