import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/api';
import { demoDetail, demoPapers } from '../lib/demo';

afterEach(() => vi.restoreAllMocks());

 describe('Zotero Reader 工作台', () => {
  it('展示本地文库并执行关键词检索', async () => {
    render(<App />);
    expect(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索本地资源库'), { target: { value: '仪表盘' } });
    expect(await screen.findByText('学习分析仪表盘是否真的会改变教学行动？')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('生成式人工智能如何促进大学生的自我调节学习？')).not.toBeInTheDocument());
  });

  it('紧凑与舒展视图显示文字标签和明确的选中状态', async () => {
    render(<App />);
    const compact = await screen.findByRole('button', { name: '紧凑视图' });
    const comfortable = screen.getByRole('button', { name: '舒展视图' });
    expect(compact).toHaveTextContent('紧凑');
    expect(comfortable).toHaveTextContent('舒展');
    expect(compact).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(comfortable);
    expect(comfortable).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.paper-row')).toHaveClass('comfortable');
    fireEvent.click(compact);
    expect(compact).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.paper-row')).not.toHaveClass('comfortable');
  });

  it('打开七段解读并查看局部 Markdown 来源', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？'));
    expect(await screen.findByRole('heading', { name: '基本信息提取', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '个人评价与启示', level: 2 })).toBeInTheDocument();
    const sources = screen.getAllByRole('button', { name: '定位 Markdown 来源' });
    fireEvent.click(sources[0]);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/桌面端只返回当前 Markdown 版本/)).toBeInTheDocument();
  });

  it('在列表内阅读并用快捷键切换到下一篇', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？'));
    expect(await screen.findByRole('button', { name: '下一篇' })).toBeInTheDocument();
    expect(screen.getByLabelText('搜索本地资源库')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'j' });
    expect(await screen.findByRole('heading', { name: '从“给答案”到“促思考”：智能辅导反馈设计的实证研究', level: 1 })).toBeInTheDocument();
    expect(screen.getByText('2 / 8')).toBeInTheDocument();
  });

  it('分类导入先显示数量预览', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '导入 Zotero 分类' }));
    fireEvent.click(screen.getByRole('button', { name: '选择 人工智能与教育' }));
    fireEvent.click(screen.getByRole('button', { name: /预览导入范围/ }));
    expect(await screen.findByText('24')).toBeInTheDocument();
    expect(screen.getByText('21')).toBeInTheDocument();
    expect(screen.getByText('无 PDF').parentElement).toHaveTextContent('3');
  });

  it('PDF 不可读时显示警告并允许继续导入', async () => {
    vi.spyOn(api, 'previewImport').mockResolvedValue({ collectionKeys: ['ai'], collectionNames: ['人工智能与教育'], total: 1, withPdf: 1, withoutPdf: 0, multiplePdf: 0, pdfIssues: [{ itemKey: 'BADPDF', title: '路径失效的文献', attachmentKey: 'ATTACH', error: '文件不存在' }] });
    const importItems = vi.spyOn(api, 'importCollections').mockResolvedValue({ imported: 1, queued: 0, skipped: 0 });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '导入 Zotero 分类' }));
    fireEvent.click(screen.getByRole('button', { name: '选择 人工智能与教育' }));
    fireEvent.click(screen.getByRole('button', { name: /预览导入范围/ }));
    expect(await screen.findByText(/发现 1 个不可读 PDF/)).toBeInTheDocument();
    expect(screen.getByText(/《路径失效的文献》/)).toBeInTheDocument();
    const continueImport = screen.getByRole('button', { name: '继续导入 1 篇文献' });
    expect(continueImport).toBeEnabled();
    fireEvent.click(continueImport);
    expect(await screen.findByText('1 篇文献已进入本地资源库')).toBeInTheDocument();
    expect(importItems).toHaveBeenCalledWith(['ai']);
  });

  it('未加入分类从右侧功能区加入，分类树不重复显示按钮', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^研究方法/ }));
    expect(screen.queryByRole('button', { name: '加入 Zotero Reader：研究方法' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '同步 Zotero' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加入 Zotero Reader' }));
    expect(screen.getByRole('button', { name: '选择 研究方法' })).toHaveClass('checked');
    fireEvent.click(screen.getByRole('button', { name: /预览导入范围/ }));
    fireEvent.click(await screen.findByRole('button', { name: /导入 24 篇文献/ }));
    expect(await screen.findByText('24 篇文献已进入本地资源库')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看资源库/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '加入 Zotero Reader' })).not.toBeInTheDocument());
  });

  it('可在设置页安全保存 DeepSeek 密钥并更新连接状态', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    const input = await screen.findByLabelText('DeepSeek API Key');
    fireEvent.change(input, { target: { value: 'test-secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 DeepSeek 密钥' }));
    expect(await screen.findByText('已配置')).toBeInTheDocument();
    expect(input).toHaveValue('');
  });

  it('设置页展示完整文献解读提示词', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    fireEvent.click(await screen.findByRole('button', { name: /系统默认提示词/ }));
    expect(screen.getByText(/描述作者采用的研究方法（如实验、调查、建模、定量\/定性分析等）。/)).toBeInTheDocument();
    expect(screen.getByText(/给出自己对相关领域未来研究的建议和启示。/)).toBeInTheDocument();
  });

  it('已加入分类可通过右键菜单同步', async () => {
    render(<App />);
    const collection = await screen.findByRole('button', { name: /^人工智能与教育/ });
    fireEvent.contextMenu(collection);
    fireEvent.click(screen.getByRole('menuitem', { name: '与 Zotero 同步' }));
    expect(await screen.findByText(/“人工智能与教育”同步完成/)).toBeInTheDocument();
  });

  it('无全文条目只显示 Zotero 元信息并隐藏旧 AI 内容', async () => {
    const paper = {
      ...demoPapers[6],
      title: 'Original Zotero Title',
      titleZh: '不应显示的 AI 标题',
      oneSentence: '不应显示的 AI 摘要',
      abstractNote: '这是 Zotero 中保存的原始摘要。',
      aiState: 'queued',
      interpretationId: 'legacy-interpretation',
      error: '旧 AI 错误',
    };
    vi.spyOn(api, 'listLibrary').mockResolvedValue([paper]);
    vi.spyOn(api, 'detail').mockResolvedValue(demoDetail(paper));
    const regenerate = vi.spyOn(api, 'regenerate');
    const ask = vi.spyOn(api, 'ask');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Original Zotero Title/ }));
    expect(await screen.findByRole('heading', { name: 'Zotero 元信息' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Original Zotero Title', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText('这是 Zotero 中保存的原始摘要。')).toHaveLength(2);
    expect(screen.getByText(paper.doi)).toBeInTheDocument();
    expect(screen.getByText('仅元信息')).toBeInTheDocument();
    expect(screen.queryByText('不应显示的 AI 标题')).not.toBeInTheDocument();
    expect(screen.queryByText('不应显示的 AI 摘要')).not.toBeInTheDocument();
    expect(screen.queryByText('旧 AI 错误')).not.toBeInTheDocument();
    expect(screen.queryByText('正在梳理论文脉络')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '重新解读' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI 问答' })).not.toBeInTheDocument();
    expect(regenerate).not.toHaveBeenCalled();
    expect(ask).not.toHaveBeenCalled();
  });

  it('重试后同时刷新当前文献详情，不保留旧错误', async () => {
    const failed = { ...demoPapers[0], aiState: 'failed' as const, error: '旧错误', interpretationId: null };
    const list = vi.spyOn(api, 'listLibrary').mockResolvedValue([failed]);
    const detail = vi.spyOn(api, 'detail').mockResolvedValue(demoDetail(failed));
    vi.spyOn(api, 'retry').mockImplementation(async () => {
      const queued = { ...failed, aiState: 'queued' as const, error: null };
      list.mockResolvedValue([queued]);
      detail.mockResolvedValue(demoDetail(queued));
    });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(failed.titleZh) }));
    await waitFor(() => expect(detail).toHaveBeenCalled());
    expect(await screen.findAllByText('旧错误', { selector: 'p' })).not.toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByText('正在梳理论文脉络')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('旧错误')).not.toBeInTheDocument());
  });
});
