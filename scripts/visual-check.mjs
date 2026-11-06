import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';

const root = new URL('..', import.meta.url).pathname;
const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '7183'], { cwd: root, detached: true, stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
try {
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { const response = await fetch('http://127.0.0.1:7183'); if (response.ok) { ready = true; break; } } catch {}
    await sleep(250);
  }
  if (!ready) throw new Error('Vite server did not start');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:7183', { waitUntil: 'networkidle' });
  await page.getByText('生成式人工智能如何促进大学生的自我调节学习？').waitFor();
  await page.getByRole('button', { name: /反馈与评价 2 篇文献，2 篇有 PDF 全文，2 篇已解读/ }).waitFor();
  await page.waitForTimeout(500);
  await mkdir(`${root}/artifacts`, { recursive: true });
  await page.screenshot({ path: `${root}/artifacts/library.png`, fullPage: true });
  await page.getByRole('button', { name: /^研究方法/ }).click();
  await page.getByText(/本文件夹有 2 篇文献/).waitFor();
  await page.screenshot({ path: `${root}/artifacts/collection-unjoined.png`, fullPage: true });
  await page.getByRole('button', { name: '加入 Zotero Reader' }).click();
  await page.getByRole('button', { name: '导入 2 篇文献' }).waitFor();
  if (await page.getByRole('button', { name: '选择 研究方法' }).count()) throw new Error('快捷导入仍要求重复选择分类');
  await page.screenshot({ path: `${root}/artifacts/collection-preview.png`, fullPage: true });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: /^人工智能与教育/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '与 Zotero 同步' }).waitFor();
  await page.screenshot({ path: `${root}/artifacts/collection-menu.png`, fullPage: true });
  await page.keyboard.press('Escape');
  if (await page.getByRole('button', { name: '同步 Zotero', exact: true }).count()) throw new Error('顶部全局同步按钮仍存在');
  await page.getByRole('button', { name: /^全部文献/ }).click();
  await page.getByText('生成式人工智能如何促进大学生的自我调节学习？').click();
  await page.getByRole('heading', { name: '个人评价与启示', level: 2 }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${root}/artifacts/reader.png`, fullPage: true });
  if (await page.getByRole('slider').count()) throw new Error('论文配图宽度滑块仍然存在');
  const figure = page.locator('.article-figure-inline').first();
  const figureBorder = page.getByRole('separator', { name: '调整图 1宽度' });
  await figureBorder.waitFor();
  const initialFigure = await figure.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    mainWidth: element.closest('.article-main').getBoundingClientRect().width,
    float: getComputedStyle(element).float,
  }));
  if (initialFigure.float !== 'right' || Math.abs(initialFigure.width / initialFigure.mainWidth - 0.4) > 0.01) throw new Error('论文配图默认右浮动 40% 布局异常');
  const dragFigure = async deltaRatio => {
    const borderRect = await figureBorder.boundingBox();
    const mainWidth = await page.locator('.article-main').first().evaluate(element => element.getBoundingClientRect().width);
    const startX = borderRect.x + borderRect.width / 2;
    const startY = borderRect.y + Math.min(80, borderRect.height / 2);
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - mainWidth * deltaRatio, startY, { steps: 12 });
    await page.mouse.up();
  };
  await dragFigure(0.25);
  if (await figureBorder.getAttribute('aria-valuenow') !== '65') throw new Error('向左拖动左边框未将图片调宽到 65%');
  await page.screenshot({ path: `${root}/artifacts/reader-figure-wide.png`, fullPage: true });
  await dragFigure(-0.8);
  if (await figureBorder.getAttribute('aria-valuenow') !== '25') throw new Error('图片最小宽度未限制为 25%');
  const releasedWidth = await figureBorder.getAttribute('aria-valuenow');
  await page.mouse.move(100, 100);
  if (await figureBorder.getAttribute('aria-valuenow') !== releasedWidth) throw new Error('松开鼠标后图片宽度仍发生变化');
  await figureBorder.press('End');
  if (await figureBorder.getAttribute('aria-valuenow') !== '100') throw new Error('图片最大宽度未限制为 100%');
  await figureBorder.press('Home');
  await page.locator('.inline-reading-list').first().evaluate(element => {
    const original = element.querySelector('.article-figure-inline').getBoundingClientRect();
    element.scrollTop += original.bottom - element.getBoundingClientRect().top + 60;
  });
  const floating = page.getByRole('complementary', { name: '悬浮论文配图' });
  await floating.waitFor({ timeout: 5000 }).catch(async error => {
    console.error(await page.locator('.reader-inline').first().evaluate(reader => {
      const scroller = reader.closest('.inline-reading-list');
      const article = reader.querySelector('.article-reader').getBoundingClientRect();
      const original = reader.querySelector('.article-figure-inline').getBoundingClientRect();
      const viewport = scroller.getBoundingClientRect();
      return { scrollTop: scroller.scrollTop, scrollHeight: scroller.scrollHeight, article: { top: article.top, bottom: article.bottom }, original: { top: original.top, bottom: original.bottom }, viewport: { top: viewport.top, bottom: viewport.bottom }, floating: reader.querySelectorAll('.article-figure-floating').length };
    }));
    await page.screenshot({ path: `${root}/artifacts/reader-figure-scroll-debug.png`, fullPage: true });
    throw error;
  });
  const floatingBounds = await floating.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const article = element.closest('.article-reader').getBoundingClientRect();
    const scroller = element.closest('.inline-reading-list').getBoundingClientRect();
    return { position: getComputedStyle(element).position, contained: rect.left >= article.left && rect.right <= article.right && rect.top >= Math.max(article.top, scroller.top) && rect.bottom <= Math.min(article.bottom, scroller.bottom) };
  });
  if (floatingBounds.position !== 'absolute' || !floatingBounds.contained) throw new Error('悬浮图片溢出文章阅读边界');
  await page.screenshot({ path: `${root}/artifacts/reader-figure-floating.png`, fullPage: true });
  await floating.getByRole('button', { name: /放大.*论文配图/ }).click();
  await page.getByRole('dialog', { name: '图 1放大预览' }).waitFor();
  await page.getByRole('dialog', { name: '图 1放大预览' }).locator('img').click();
  if (await page.getByRole('dialog').count()) throw new Error('再次点击图片未关闭放大预览');
  await page.locator('.inline-reading-list').first().evaluate(element => { element.scrollTop = 0; });
  await page.setViewportSize({ width: 390, height: 900 });
  if (await figureBorder.isVisible()) throw new Error('手机端仍显示不适用的边框调节');
  const mobileWidths = await page.locator('.reader-inline').first().evaluate(reader => ({
    figure: reader.querySelector('.article-figure-inline').getBoundingClientRect().width,
    main: reader.querySelector('.article-main').getBoundingClientRect().width,
  }));
  if (Math.abs(mobileWidths.figure - mobileWidths.main) > 1) throw new Error('手机端配图未恢复正文整宽');
  await page.screenshot({ path: `${root}/artifacts/reader-figure-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 920 });
  await page.getByRole('button', { name: /Diagnosing Misconceptions through Formative Assessment/ }).click();
  await page.getByRole('heading', { name: 'Zotero 元信息' }).waitFor();
  const metadataReader = page.locator('.reader-inline').filter({ has: page.getByRole('heading', { name: 'Zotero 元信息' }) });
  if (await metadataReader.getByRole('button', { name: '重新解读' }).count()) throw new Error('无全文条目仍显示重新解读按钮');
  if (await metadataReader.getByRole('button', { name: 'AI 问答' }).count()) throw new Error('无全文条目仍显示 AI 问答按钮');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${root}/artifacts/metadata-only.png`, fullPage: true });
  await page.evaluate(async () => {
    const { api } = await import('/src/lib/api.ts');
    api.previewImport = async () => ({ collectionKeys: ['ai'], collectionNames: ['人工智能与教育'], total: 1, withPdf: 1, withoutPdf: 0, multiplePdf: 0, pdfIssues: [{ itemKey: 'BADPDF', title: '路径失效的文献', attachmentKey: 'ATTACH', error: '文件不存在' }] });
    api.importCollections = async () => ({ imported: 1, queued: 0, skipped: 0 });
  });
  await page.getByRole('button', { name: '导入 Zotero 分类' }).click();
  await page.getByRole('button', { name: '选择 人工智能与教育' }).click();
  await page.getByRole('button', { name: /预览导入范围/ }).click();
  const continueImport = page.getByRole('button', { name: '继续导入 1 篇文献' });
  await continueImport.waitFor();
  if (await continueImport.isDisabled()) throw new Error('不可读 PDF 仍在阻塞导入');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${root}/artifacts/import-pdf-warning.png`, fullPage: true });
  await continueImport.click();
  await page.getByText('1 篇文献已进入本地资源库').waitFor();
  console.log(JSON.stringify({ title: await page.title(), errors, library: (await stat(`${root}/artifacts/library.png`)).size, reader: (await stat(`${root}/artifacts/reader.png`)).size, metadataOnly: (await stat(`${root}/artifacts/metadata-only.png`)).size, importWarning: (await stat(`${root}/artifacts/import-pdf-warning.png`)).size }, null, 2));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser?.close();
  try { process.kill(-server.pid, 'SIGTERM'); } catch {}
}
