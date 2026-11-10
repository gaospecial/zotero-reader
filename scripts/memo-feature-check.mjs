import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const root = new URL('..', import.meta.url).pathname;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '7185', '--strictPort'], { cwd: root, detached: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;

async function targetState(page) {
  return page.locator('mark.memo-highlight').first().evaluate(target => {
    const scroller = target.closest('.inline-reading-list');
    const targetRect = target.getBoundingClientRect();
    const scrollerRect = scroller.getBoundingClientRect();
    return {
      scrollTop: scroller.scrollTop,
      visible: targetRect.top >= scrollerRect.top && targetRect.bottom <= scrollerRect.bottom,
      dialogOpen: Boolean(document.querySelector('[role="dialog"]')),
      selectedPaperId: document.querySelector('.paper-row.selected')?.id ?? null,
    };
  });
}

try {
  let ready = false;
  for (let i = 0; i < 40; i += 1) {
    try { const response = await fetch('http://127.0.0.1:7185'); if (response.ok) { ready = true; break; } } catch {}
    await sleep(250);
  }
  assert.ok(ready, 'Vite server did not start');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  await page.goto('http://127.0.0.1:7185', { waitUntil: 'networkidle' });
  await page.locator('#paper-demo-1 .paper-content').click();
  await page.locator('.article-section[data-section-index="2"] p').first().waitFor();
  await page.locator('.article-section[data-section-index="2"]').evaluate(section => {
    const range = document.createRange();
    range.selectNodeContents(section.querySelector('.markdown-content'));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    section.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await page.getByRole('button', { name: '记备忘' }).click();
  await page.getByLabel('选段备忘内容').fill('用于检查完整原文与原文定位的备忘。');
  await page.getByRole('button', { name: '保存备忘' }).click();
  await page.locator('mark.memo-highlight').first().waitFor();
  await page.locator('.primary-nav').getByRole('button', { name: /备忘/ }).click();
  const card = page.locator('.note-card-anchored').first();
  await card.waitFor();
  await page.waitForFunction(() => document.querySelector('.primary-nav')?.textContent?.includes('备忘1'));

  const quote = await card.locator('.note-card-quote').evaluate(element => {
    const style = getComputedStyle(element);
    return {
      fullyVisible: element.scrollHeight <= element.clientHeight + 1,
      lineClamp: style.webkitLineClamp,
      maxHeight: style.maxHeight,
      overflow: style.overflow,
      gridAlign: getComputedStyle(element.closest('.notes-grid')).alignItems,
    };
  });
  assert.ok(quote.fullyVisible, `完整原文仍被截断：${JSON.stringify(quote)}`);
  assert.notEqual(quote.lineClamp, '4');
  assert.notEqual(quote.maxHeight, '92px');
  assert.notEqual(quote.overflow, 'hidden');
  assert.equal(quote.gridAlign, 'start');

  await card.locator('button').click();
  await page.locator('mark.memo-highlight').first().waitFor();
  await page.waitForTimeout(1000);
  const normalJump = await targetState(page);
  assert.ok(normalJump.visible, `普通回跳未将高亮滚入视口：${JSON.stringify(normalJump)}`);
  assert.equal(normalJump.dialogOpen, false, '回跳不应自动打开编辑弹窗');
  assert.equal(normalJump.selectedPaperId, 'paper-demo-1');

  await page.locator('.primary-nav').getByRole('button', { name: /备忘/ }).click();
  await page.getByLabel('搜索本地资源库').fill('仪表盘');
  await page.waitForTimeout(500);
  await page.locator('.note-card-anchored').first().locator('button').click();
  await page.locator('#paper-demo-1.selected').waitFor();
  await page.locator('mark.memo-highlight').first().waitFor();
  await page.waitForTimeout(1000);
  const filteredJump = await targetState(page);
  assert.ok(filteredJump.visible, `筛选后的回跳未将高亮滚入视口：${JSON.stringify(filteredJump)}`);
  assert.equal(filteredJump.dialogOpen, false);
  assert.equal(filteredJump.selectedPaperId, 'paper-demo-1');
  assert.equal(await page.getByLabel('搜索本地资源库').inputValue(), '');

  console.log(JSON.stringify({ quote, normalJump, filteredJump }, null, 2));
} finally {
  await browser?.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
