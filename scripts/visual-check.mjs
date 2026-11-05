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
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:7183', { waitUntil: 'networkidle' });
  await page.getByText('生成式人工智能如何促进大学生的自我调节学习？').waitFor();
  await page.waitForTimeout(500);
  await mkdir(`${root}/artifacts`, { recursive: true });
  await page.screenshot({ path: `${root}/artifacts/library.png`, fullPage: true });
  await page.getByRole('button', { name: /^人工智能与教育/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '与 Zotero 同步' }).waitFor();
  await page.screenshot({ path: `${root}/artifacts/collection-menu.png`, fullPage: true });
  await page.keyboard.press('Escape');
  if (await page.getByRole('button', { name: '同步 Zotero', exact: true }).count()) throw new Error('顶部全局同步按钮仍存在');
  await page.getByText('生成式人工智能如何促进大学生的自我调节学习？').click();
  await page.getByRole('heading', { name: '个人评价与启示', level: 2 }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${root}/artifacts/reader.png`, fullPage: true });
  await page.getByRole('button', { name: /Diagnosing Misconceptions through Formative Assessment/ }).click();
  await page.getByRole('heading', { name: 'Zotero 元信息' }).waitFor();
  if (await page.getByRole('button', { name: '重新解读' }).count()) throw new Error('无全文条目仍显示重新解读按钮');
  if (await page.getByRole('button', { name: 'AI 问答' }).count()) throw new Error('无全文条目仍显示 AI 问答按钮');
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
