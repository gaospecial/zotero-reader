import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '7184', '--strictPort'], { cwd: root, detached: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;

try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { const response = await fetch('http://127.0.0.1:7184'); if (response.ok) { ready = true; break; } } catch {}
    await sleep(250);
  }
  if (!ready) throw new Error('Vite server did not start');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
  await page.goto('http://127.0.0.1:7184', { waitUntil: 'networkidle' });
  await page.locator('#paper-demo-1 .paper-content').click();
  await page.locator('.reader-inline').waitFor();
  await page.waitForTimeout(300);

  async function positionTarget(id, offsetFromTop) {
    await page.locator('.virtual-list').evaluate((list, { id, offsetFromTop }) => {
      const target = document.querySelector(`#paper-${id}`);
      const listRect = list.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      list.scrollTop += targetRect.top - listRect.top - offsetFromTop;
    }, { id, offsetFromTop });
    await page.waitForTimeout(150);
  }

  async function targetOffset(id) {
    return page.locator(`#paper-${id}`).evaluate(target => {
      const list = target.closest('.virtual-list');
      return target.getBoundingClientRect().top - list.getBoundingClientRect().top;
    });
  }

  const measurements = [];
  await positionTarget('demo-4', 250);
  await page.waitForFunction(() => document.querySelector('.article-layout')?.classList.contains('is-figure-floating'));
  const floatingBefore = await targetOffset('demo-4');
  await page.locator('#paper-demo-4 .paper-content').click();
  await page.locator('#paper-demo-4.selected').waitFor();
  await page.waitForTimeout(250);
  const floatingAfter = await targetOffset('demo-4');
  measurements.push({ scenario: '前一篇浮动配图恢复布局', before: floatingBefore, after: floatingAfter, delta: floatingAfter - floatingBefore });

  await positionTarget('demo-6', -20);
  const partialBefore = await targetOffset('demo-6');
  const visiblePoint = await page.locator('#paper-demo-6').evaluate(target => {
    const list = target.closest('.virtual-list');
    const targetRect = target.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    return { x: targetRect.left + 100, y: Math.max(targetRect.top, listRect.top) + 5 };
  });
  await page.mouse.click(visiblePoint.x, visiblePoint.y);
  await page.locator('#paper-demo-6.selected').waitFor();
  await page.waitForTimeout(250);
  const partialAfter = await targetOffset('demo-6');
  measurements.push({ scenario: '部分可见标题展开', before: partialBefore, after: partialAfter, delta: partialAfter - partialBefore });

  console.log(JSON.stringify(measurements, null, 2));
  const jumped = measurements.filter(item => Math.abs(item.delta) > 1);
  if (jumped.length) throw new Error(`展开时目标标题位置发生跳动：${jumped.map(item => `${item.scenario} ${item.delta.toFixed(2)}px`).join('；')}`);
} finally {
  await browser?.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
