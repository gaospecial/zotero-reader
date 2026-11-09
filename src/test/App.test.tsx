import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/api';
import { demoDetail, demoPapers } from '../lib/demo';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe('Zotero Reader 工作台', () => {
  it('列表星标可切换并持久化，且不改变已读状态', async () => {
    const setRead = vi.spyOn(api, 'setRead');
    render(<App />);
    const star = (await screen.findAllByRole('button', { name: '添加星标' }))[0];
    expect(star.closest('article')).toHaveAttribute('id', 'paper-demo-1');
    fireEvent.click(star);
    expect(screen.getByRole('button', { name: '取消星标' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('reader-starred-demo-1')).toBe('true');
    expect(setRead).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '取消星标' }));
    expect(document.querySelector('#paper-demo-1 .star-marker')).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem('reader-starred-demo-1')).toBe('false');
  });

  it('列表与阅读页星标实时双向同步', async () => {
    render(<App />);
    fireEvent.click((await screen.findAllByRole('button', { name: '添加星标' }))[0]);
    fireEvent.click(screen.getByText('生成式人工智能如何促进大学生的自我调节学习？'));
    const readerStar = await screen.findByRole('button', { name: '已加星标' });
    expect(readerStar).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(readerStar);
    expect(readerStar).toHaveTextContent('添加星标');
    expect(document.querySelector('#paper-demo-1 .star-marker')).toHaveAttribute('aria-pressed', 'false');
    expect(window.localStorage.getItem('reader-starred-demo-1')).toBe('false');
  });

  it('侧栏星标位于未读之后，只显示收藏文献并随取消实时更新', async () => {
    render(<App />);
    const firstStar = (await screen.findAllByRole('button', { name: '添加星标' }))[0];
    fireEvent.click(firstStar);
    const navigation = document.querySelector('.primary-nav')!;
    const starNavigation = screen.getByRole('button', { name: '星标' });
    expect(navigation.children[2]).toBe(starNavigation);
    expect(starNavigation).toHaveTextContent('1');
    fireEvent.click(starNavigation);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('星标文献1');
    await waitFor(() => expect(document.querySelectorAll('.paper-row')).toHaveLength(1));
    expect(screen.getByText('生成式人工智能如何促进大学生的自我调节学习？')).toBeInTheDocument();
    expect(screen.queryByText('从“给答案”到“促思考”：智能辅导反馈设计的实证研究')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取消星标' }));
    expect(await screen.findByText('还没有星标文献')).toBeInTheDocument();
    expect(document.querySelectorAll('.paper-row')).toHaveLength(0);
    expect(starNavigation).not.toHaveTextContent('1');
  });

  it('侧栏可通过右边框调宽并折叠为可恢复的图标栏', async () => {
    render(<App />);
    const handle = screen.getByRole('separator', { name: '调整左侧栏宽度' });
    handle.setPointerCapture = vi.fn();
    handle.releasePointerCapture = vi.fn();
    handle.hasPointerCapture = vi.fn(() => true);
    const shell = document.querySelector('.app-shell')!;
    const initialWidth = Number(handle.getAttribute('aria-valuenow'));
    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };
    fireEvent(handle, pointer('pointerdown', 200));
    fireEvent(handle, pointer('pointermove', 320));
    expect(handle).toHaveAttribute('aria-valuenow', String(initialWidth + 120));
    fireEvent(handle, pointer('pointermove', -1000));
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    fireEvent(handle, pointer('pointerup', -1000));
    fireEvent.keyDown(handle, { key: 'End' });
    expect(handle).toHaveAttribute('aria-valuenow', '360');
    fireEvent.keyDown(handle, { key: 'Home' });
    expect(handle).toHaveAttribute('aria-valuenow', '200');
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(handle).toHaveAttribute('aria-valuenow', '210');
    expect(window.localStorage.getItem('reader-sidebar-width')).toBe('210');

    fireEvent.click(screen.getByRole('button', { name: '收起左侧栏' }));
    expect(shell).toHaveClass('sidebar-collapsed');
    expect(screen.queryByRole('separator', { name: '调整左侧栏宽度' })).not.toBeInTheDocument();
    expect(window.localStorage.getItem('reader-sidebar-collapsed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: '展开左侧栏' }));
    expect(shell).not.toHaveClass('sidebar-collapsed');
    expect(screen.getByRole('separator', { name: '调整左侧栏宽度' })).toHaveAttribute('aria-valuenow', '210');
  });

  it('打开未读文献后列表与侧栏计数同步减少', async () => {
    const papers = demoPapers.filter(paper => paper.readState === 'unread').map(paper => ({ ...paper }));
    const base = await api.bootstrap();
    vi.spyOn(api, 'bootstrap').mockImplementation(async () => ({
      ...base,
      papers,
      stats: { ...base.stats, unread: papers.filter(paper => paper.localState === 'active' && paper.readState === 'unread').length },
    }));
    vi.spyOn(api, 'listLibrary').mockImplementation(async query =>
      query.status === 'unread' ? papers.filter(paper => paper.readState === 'unread') : papers
    );
    vi.spyOn(api, 'detail').mockImplementation(async id => demoDetail(papers.find(paper => paper.id === id)!));
    const setRead = vi.spyOn(api, 'setRead').mockImplementation(async (id, readState) => {
      const paper = papers.find(item => item.id === id);
      if (paper) paper.readState = readState as typeof paper.readState;
    });

    render(<App />);
    const unreadNavigation = document.querySelectorAll('.primary-nav button')[1];
    fireEvent.click(unreadNavigation);
    await waitFor(() => expect(document.querySelectorAll('.paper-row')).toHaveLength(3));
    expect(unreadNavigation).toHaveTextContent('未读3');
    fireEvent.click(document.querySelector('#paper-demo-1 .paper-content')!);
    await waitFor(() => expect(setRead).toHaveBeenCalledWith('demo-1', 'reading'));
    await waitFor(() => expect(document.querySelectorAll('.paper-row')).toHaveLength(2));
    expect(unreadNavigation).toHaveTextContent('未读2');
  });

  it('文献信息显示第一作者、粗斜体期刊缩写和年份', async () => {
    render(<App />);
    await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？');
    const metadata = document.querySelector('#paper-demo-1 .paper-meta');
    expect(metadata).toHaveTextContent('林晓, 学习科学, 2024');
    expect(metadata).not.toHaveTextContent('陈默');
    expect(metadata?.querySelector('strong.paper-journal')).toHaveTextContent('学习科学');
    expect(metadata?.querySelector('strong.paper-journal')).toHaveAttribute('title', '学习科学研究');
  });

  it('展示本地文库并执行关键词检索', async () => {
    render(<App />);
    expect(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('搜索本地资源库'), { target: { value: '仪表盘' } });
    expect(await screen.findByText('学习分析仪表盘是否真的会改变教学行动？')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('生成式人工智能如何促进大学生的自我调节学习？')).not.toBeInTheDocument());
  });

  it('舒展展开当前全部阅读区，紧凑折叠全部阅读区并使用 44px 单行布局', async () => {
    render(<App />);
    const compact = await screen.findByRole('button', { name: '紧凑视图' });
    const comfortable = screen.getByRole('button', { name: '舒展视图' });
    expect(compact).toHaveTextContent('紧凑');
    expect(comfortable).toHaveTextContent('舒展');
    expect(compact).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelector('.paper-row')).toHaveClass('compact');
    expect((document.querySelector('.paper-row')?.parentElement as HTMLElement).style.height).toBe('44px');
    fireEvent.click(comfortable);
    await waitFor(() => expect(document.querySelectorAll('.reader-inline')).toHaveLength(demoPapers.length));
    expect(comfortable).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(compact);
    expect(compact).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('.reader-inline')).toHaveLength(0);
    expect(document.querySelector('.paper-row')).toHaveClass('compact');
  });

  it('紧凑行仅将未读文献标记为加粗标题状态', async () => {
    vi.spyOn(api, 'listLibrary').mockResolvedValue(demoPapers.slice(0, 3).map(paper => ({ ...paper })));
    render(<App />);
    await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？');
    expect(document.querySelector('#paper-demo-1')).toHaveClass('compact', 'unread');
    expect(document.querySelector('#paper-demo-2')).toHaveClass('compact');
    expect(document.querySelector('#paper-demo-2')).not.toHaveClass('unread');
    expect(document.querySelector('#paper-demo-3')).toHaveClass('compact');
    expect(document.querySelector('#paper-demo-3')).not.toHaveClass('unread');
  });

  it('紧凑模式下字号按钮同样实时调整列表文字', async () => {
    render(<App />);
    await screen.findByRole('button', { name: '紧凑视图' });
    const panel = document.querySelector('.library-panel') as HTMLElement;
    expect(panel.style.getPropertyValue('--reader-font-size')).toBe('12px');
    fireEvent.click(screen.getByRole('button', { name: '增大阅读字号' }));
    expect(panel.style.getPropertyValue('--reader-font-size')).toBe('13px');
    expect(document.querySelector('.paper-row')).toHaveClass('compact');
    fireEvent.click(screen.getByRole('button', { name: '减小阅读字号' }));
    expect(panel.style.getPropertyValue('--reader-font-size')).toBe('12px');
  });

  it('字号按钮实时调整全部打开的阅读正文', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？'));
    await screen.findByRole('heading', { name: '基本信息提取', level: 2 });
    const reader = document.querySelector('.reader-inline') as HTMLElement;
    expect(reader.style.getPropertyValue('--reader-font-size')).toBe('12px');
    fireEvent.click(screen.getByRole('button', { name: '增大阅读字号' }));
    expect(reader.style.getPropertyValue('--reader-font-size')).toBe('13px');
    expect(screen.getByText('13px')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '减小阅读字号' }));
    expect(reader.style.getPropertyValue('--reader-font-size')).toBe('12px');
  });

  it('网页演示文库的前两篇文章带有可加载配图', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？'));
    const firstFigure = await screen.findByRole('button', { name: '放大论文配图：不同反馈方式下的延迟迁移表现（演示数据）' });
    expect(firstFigure.querySelector('img')).toHaveAttribute('src', '/demo/self-regulated-learning.svg');
    fireEvent.click(screen.getByText('从“给答案”到“促思考”：智能辅导反馈设计的实证研究'));
    const secondFigure = await screen.findByRole('button', { name: '放大论文配图：结构化追问促进自我解释与知识迁移的反馈循环' });
    expect(secondFigure.querySelector('img')).toHaveAttribute('src', '/demo/structured-feedback-loop.svg');
  });

  it('多图在文内右侧环绕单张轮播，支持箭头切换与圆点直选', async () => {
    const detail = demoDetail(demoPapers[0]);
    detail.interpretation!.figures = [
      { path: 'figure-1.png', label: '图 1', caption: '第一张图注' },
      { path: 'figure-2.png', label: '图 2', caption: '第二张图注' },
      { path: 'figure-3.png', label: '图 3', caption: '第三张图注' },
    ];
    vi.spyOn(api, 'detail').mockResolvedValue(detail);
    vi.spyOn(api, 'asset').mockResolvedValue('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    render(<App />);
    fireEvent.click(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？'));
    const first = await screen.findByRole('button', { name: '放大论文配图：第一张图注' });
    const carousel = first.closest('aside.article-figure');
    expect(carousel).not.toBeNull();
    expect(carousel?.querySelectorAll('.article-figure-stage img')).toHaveLength(1);
    expect(document.querySelector('.article-layout')).toHaveClass('has-figure');
    expect(document.querySelectorAll('.article-figure-inline')).toHaveLength(0);
    expect(screen.getByText('1 / 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '上一张图片' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
    expect(await screen.findByRole('button', { name: '放大论文配图：第二张图注' })).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '放大论文配图：第一张图注' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '查看第 3 张图片' }));
    expect(await screen.findByRole('button', { name: '放大论文配图：第三张图注' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '下一张图片' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '查看第 3 张图片' })).toHaveAttribute('aria-current', 'true');

    fireEvent.click(screen.getByRole('button', { name: '上一张图片' }));
    expect(await screen.findByRole('button', { name: '放大论文配图：第二张图注' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看第 1 张图片' }));
    expect(await screen.findByRole('button', { name: '放大论文配图：第一张图注' })).toBeInTheDocument();
  });

  it('论文环绕轮播默认 420px 且可通过左边框和键盘调整宽度', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？'));
    await screen.findByRole('button', { name: '放大论文配图：不同反馈方式下的延迟迁移表现（演示数据）' });
    const figure = document.querySelector('.article-figure') as HTMLElement;
    const article = document.querySelector('.article-reader') as HTMLElement;
    const layout = document.querySelector('.article-layout') as HTMLElement;
    vi.spyOn(article, 'clientWidth', 'get').mockReturnValue(1140);
    const border = screen.getByRole('separator', { name: '调整论文配图宽度' });
    border.setPointerCapture = vi.fn();
    border.releasePointerCapture = vi.fn();
    border.hasPointerCapture = vi.fn(() => true);
    expect(figure.parentElement).toHaveClass('article-main');
    expect(getComputedStyle(figure).position).toBe('relative');
    expect(getComputedStyle(figure).float).toBe('right');
    expect(layout.style.getPropertyValue('--figure-width')).toBe('420px');
    expect(border).toHaveAttribute('aria-valuenow', '420');

    const pointer = (type: string, clientX: number) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      return event;
    };
    fireEvent(border, pointer('pointerdown', 400));
    fireEvent(border, pointer('pointermove', 150));
    expect(layout.style.getPropertyValue('--figure-width')).toBe('670px');
    expect(border).toHaveAttribute('aria-valuetext', '670 像素');
    fireEvent(border, pointer('pointermove', 1000));
    expect(layout.style.getPropertyValue('--figure-width')).toBe('280px');
    fireEvent(border, pointer('pointerup', 1000));
    fireEvent(border, pointer('pointermove', 0));
    expect(layout.style.getPropertyValue('--figure-width')).toBe('280px');

    fireEvent.keyDown(border, { key: 'End' });
    expect(layout.style.getPropertyValue('--figure-width')).toBe('720px');
    fireEvent.keyDown(border, { key: 'Home' });
    expect(layout.style.getPropertyValue('--figure-width')).toBe('280px');
    fireEvent.keyDown(border, { key: 'ArrowLeft' });
    expect(layout.style.getPropertyValue('--figure-width')).toBe('296px');
    fireEvent.keyDown(border, { key: 'ArrowRight' });
    expect(layout.style.getPropertyValue('--figure-width')).toBe('280px');
  });

  it('点击图片可放大，再次点击图片关闭且不会收起阅读区', async () => {
    const detail = demoDetail(demoPapers[0]);
    detail.interpretation!.figures = [{ path: 'figure-1.png', label: '图 1', caption: '实验流程与结果对比' }];
    vi.spyOn(api, 'detail').mockResolvedValue(detail);
    vi.spyOn(api, 'asset').mockResolvedValue('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="400" height="900"></svg>');
    render(<App />);
    fireEvent.click(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？'));
    fireEvent.click(await screen.findByRole('button', { name: '放大论文配图：实验流程与结果对比' }));
    const dialog = await screen.findByRole('dialog', { name: '图 1放大预览' });
    const enlargedImage = dialog.querySelector('img');
    expect(enlargedImage).toHaveAttribute('src', expect.stringContaining('data:image/svg+xml'));
    fireEvent.click(enlargedImage!);
    expect(screen.queryByRole('dialog', { name: '图 1放大预览' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '基本信息提取', level: 2 })).toBeInTheDocument();
  });

  it('悬浮后轮播仍保留当前图片、箭头、圆点选择与放大入口', async () => {
    const detail = demoDetail(demoPapers[0]);
    detail.interpretation!.figures = [
      { path: 'figure-1.png', label: '图 1', caption: '第一张图注' },
      { path: 'figure-2.png', label: '图 2', caption: '第二张图注' },
      { path: 'figure-3.png', label: '图 3', caption: '第三张图注' },
    ];
    vi.spyOn(api, 'detail').mockResolvedValue(detail);
    vi.spyOn(api, 'asset').mockResolvedValue('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    render(<App />);
    fireEvent.click(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？'));
    await screen.findByRole('button', { name: '放大论文配图：第一张图注' });
    fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
    await screen.findByRole('button', { name: '放大论文配图：第二张图注' });

    const scroller = document.querySelector('.inline-reading-list') as HTMLElement;
    const article = document.querySelector('.article-reader') as HTMLElement;
    const header = document.querySelector('.article-header') as HTMLElement;
    const figure = document.querySelector('.article-figure') as HTMLElement;
    const layout = document.querySelector('.article-layout') as HTMLElement;
    const rect = (top: number, height: number, width = 980) => ({ width, height, top, bottom: top + height, left: 0, right: width, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => rect(100, 600));
    vi.spyOn(article, 'getBoundingClientRect').mockImplementation(() => rect(200 - scroller.scrollTop, 2000));
    vi.spyOn(header, 'getBoundingClientRect').mockImplementation(() => rect(300 - scroller.scrollTop, 200));
    vi.spyOn(figure, 'getBoundingClientRect').mockImplementation(() => rect(500 - scroller.scrollTop, 500));
    vi.spyOn(layout, 'getBoundingClientRect').mockImplementation(() => rect(300 - scroller.scrollTop, 1800));

    fireEvent.scroll(scroller, { target: { scrollTop: 1200 } });
    await waitFor(() => expect(layout).toHaveClass('is-figure-floating'));
    expect(getComputedStyle(figure).position).toBe('fixed');
    expect(screen.getByRole('button', { name: '放大论文配图：第二张图注' })).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '收起悬浮图片' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
    expect(await screen.findByRole('button', { name: '放大论文配图：第三张图注' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '查看第 1 张图片' }));
    const first = await screen.findByRole('button', { name: '放大论文配图：第一张图注' });
    fireEvent.click(first);
    expect(await screen.findByRole('dialog', { name: '图 1放大预览' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭放大图片' }));
    expect(layout).toHaveClass('is-figure-floating');

    fireEvent.scroll(scroller, { target: { scrollTop: 0 } });
    await waitFor(() => expect(layout).not.toHaveClass('is-figure-floating'));
    expect(screen.getByRole('button', { name: '放大论文配图：第一张图注' })).toBeInTheDocument();
  });

  it('全部展开后可独立收起其中一篇，其余阅读区保持打开', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '舒展视图' }));
    await waitFor(() => expect(document.querySelectorAll('.reader-inline')).toHaveLength(demoPapers.length));
    fireEvent.click(screen.getAllByRole('button', { name: '收起文章' })[1]);
    expect(document.querySelectorAll('.reader-inline')).toHaveLength(demoPapers.length - 1);
    expect(screen.getAllByRole('heading', { name: '基本信息提取', level: 2 }).length).toBeGreaterThan(0);
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

  it('单篇展开保持紧凑行内容、滚动位置和工具栏状态不变', async () => {
    render(<App />);
    const content = await screen.findByRole('button', { name: /生成式人工智能如何促进大学生的自我调节学习？/ });
    const originalText = content.textContent;
    const originalList = document.querySelector<HTMLDivElement>('.virtual-list')!;
    expect(document.querySelector('.processing-banner')).toBeInTheDocument();
    fireEvent.scroll(originalList, { target: { scrollTop: 88 } });
    expect(originalList.scrollTop).toBe(88);
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scrollIntoView.mockClear();

    fireEvent.click(content);
    await screen.findByRole('heading', { name: '基本信息提取', level: 2 });

    const expandedRow = document.querySelector('#paper-demo-1')!;
    const expandedList = document.querySelector<HTMLDivElement>('.inline-reading-list.is-compact')!;
    expect(screen.getByRole('button', { name: '紧凑视图' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '舒展视图' })).toHaveAttribute('aria-pressed', 'false');
    expect(expandedRow).toHaveClass('compact');
    expect(expandedRow.querySelector('.paper-content')?.textContent).toBe(originalText);
    expect(expandedList).toBe(originalList);
    expect(expandedList.scrollTop).toBe(88);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(document.querySelector('main')).not.toHaveClass('library-reading');
    expect(document.querySelector('.processing-banner')).toBeInTheDocument();
  });

  it('展开阅读时保留侧栏资源库选中态，避免文字字重跳变', async () => {
    render(<App />);
    const allPapers = await screen.findByRole('button', { name: /全部文献/ });
    expect(allPapers).toHaveClass('active');
    fireEvent.click(screen.getByText('生成式人工智能如何促进大学生的自我调节学习？'));
    await screen.findByRole('heading', { name: '基本信息提取', level: 2 });
    expect(allPapers).toHaveClass('active');
  });

  it('切换展开文献时锁定目标行位置，阅读区不会向上展开', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？'));
    await screen.findByRole('heading', { name: '基本信息提取', level: 2 });
    const list = document.querySelector<HTMLDivElement>('.inline-reading-list')!;
    fireEvent.scroll(list, { target: { scrollTop: 800 } });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = (top: number, height = 44) => ({ x: 0, y: top, top, left: 0, width: 800, right: 800, height, bottom: top + height, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('virtual-list')) return rect(200, 600);
      if (this.id === 'paper-demo-4') return rect(this.classList.contains('selected') ? -100 : 600);
      return originalRect.call(this);
    });

    fireEvent.click(document.querySelector('#paper-demo-4 .paper-content')!);
    await waitFor(() => expect(document.querySelector('#paper-demo-4')).toHaveClass('selected'));
    expect(list.scrollTop).toBe(100);
  });

  it('点击同一文献可切换打开与关闭解读', async () => {
    render(<App />);
    const trigger = () => screen.getByRole('heading', { name: '生成式人工智能如何促进大学生的自我调节学习？', level: 3 }).closest('button')!;
    expect(await screen.findByRole('heading', { name: '生成式人工智能如何促进大学生的自我调节学习？', level: 3 })).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger());
    expect(await screen.findByRole('heading', { name: '基本信息提取', level: 2 })).toBeInTheDocument();
    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(trigger());
    await waitFor(() => expect(screen.queryByRole('heading', { name: '基本信息提取', level: 2 })).not.toBeInTheDocument());
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
  });

  it('紧凑模式逐篇累加展开，收起一篇不影响其他阅读区', async () => {
    render(<App />);
    await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？');
    const content = (id: number) => document.querySelector(`#paper-demo-${id} .paper-content`)!;
    fireEvent.click(content(1));
    await waitFor(() => expect(document.querySelectorAll('.reader-inline')).toHaveLength(1));
    fireEvent.click(content(2));
    await waitFor(() => expect(document.querySelectorAll('.reader-inline')).toHaveLength(2));
    expect(content(1)).toHaveAttribute('aria-expanded', 'true');
    expect(content(2)).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: '紧凑视图' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(content(1));
    await waitFor(() => expect(document.querySelectorAll('.reader-inline')).toHaveLength(1));
    expect(content(1)).toHaveAttribute('aria-expanded', 'false');
    expect(content(2)).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelector('#paper-demo-2')?.parentElement?.querySelector('.reader-inline')).toBeInTheDocument();
  });

  it('星标页收起第二篇时保留文献并锁定标题位置', async () => {
    render(<App />);
    const stars = await screen.findAllByRole('button', { name: '添加星标' });
    fireEvent.click(stars[0]);
    fireEvent.click(stars[1]);
    fireEvent.click(screen.getByRole('button', { name: '星标' }));
    await waitFor(() => expect(document.querySelectorAll('.paper-row')).toHaveLength(2));
    fireEvent.click(document.querySelector('#paper-demo-1 .paper-content')!);
    await waitFor(() => expect(document.querySelectorAll('.reader-inline')).toHaveLength(1));
    fireEvent.click(document.querySelector('#paper-demo-2 .paper-content')!);
    await waitFor(() => expect(document.querySelectorAll('.reader-inline')).toHaveLength(2));
    const list = document.querySelector<HTMLDivElement>('.inline-reading-list')!;
    fireEvent.scroll(list, { target: { scrollTop: 800 } });
    const originalRect = HTMLElement.prototype.getBoundingClientRect;
    const rect = (top: number, height = 44) => ({ x: 0, y: top, top, left: 0, width: 800, right: 800, height, bottom: top + height, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.classList.contains('virtual-list')) return rect(200, 600);
      if (this.id === 'paper-demo-2') return rect(this.querySelector('.paper-content')?.getAttribute('aria-expanded') === 'true' ? 500 : 900);
      return originalRect.call(this);
    });

    fireEvent.click(document.querySelectorAll('.reader-inline')[1].querySelector('[aria-label="收起文章"]')!);
    await waitFor(() => expect(document.querySelectorAll('.reader-inline')).toHaveLength(1));
    expect(list.scrollTop).toBe(1200);
    expect(document.querySelectorAll('.paper-row')).toHaveLength(2);
    expect(document.querySelector('#paper-demo-2 .star-marker')).toHaveAttribute('aria-pressed', 'true');
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

  it('Zotero 分类默认折叠，并记住手动展开和折叠状态', async () => {
    const { unmount } = render(<App />);
    const parent = await screen.findByRole('button', { name: '人工智能与教育 4 篇文献，4 篇有 PDF 全文，4 篇已解读' });
    expect(screen.queryByRole('button', { name: '反馈与评价 2 篇文献，2 篇有 PDF 全文，2 篇已解读' })).not.toBeInTheDocument();

    fireEvent.click(parent.closest('.tree-row')!.querySelector('.tree-toggle')!);
    expect(screen.getByRole('button', { name: '反馈与评价 2 篇文献，2 篇有 PDF 全文，2 篇已解读' })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('reader-expanded-collections')!)).toEqual(['ai']);

    unmount();
    render(<App />);
    const restoredParent = await screen.findByRole('button', { name: '人工智能与教育 4 篇文献，4 篇有 PDF 全文，4 篇已解读' });
    expect(screen.getByRole('button', { name: '反馈与评价 2 篇文献，2 篇有 PDF 全文，2 篇已解读' })).toBeInTheDocument();
    fireEvent.click(restoredParent.closest('.tree-row')!.querySelector('.tree-toggle')!);
    expect(screen.queryByRole('button', { name: '反馈与评价 2 篇文献，2 篇有 PDF 全文，2 篇已解读' })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('reader-expanded-collections')!)).toEqual([]);
  });

  it('分类树显示文献、全文和已解读三项统计，父分类包含子分类文献', async () => {
    render(<App />);
    const parent = await screen.findByRole('button', { name: '人工智能与教育 4 篇文献，4 篇有 PDF 全文，4 篇已解读' });
    expect(screen.queryByRole('img', { name: '统计顺序：全部文献、PDF 全文、已解读' })).not.toBeInTheDocument();
    expect(document.querySelector('.section-label')?.nextElementSibling).toHaveClass('collection-tree');
    expect(screen.queryByRole('button', { name: '添加分类' })).not.toBeInTheDocument();
    const stats = parent.querySelector('.collection-stats');
    const values = stats?.querySelectorAll(':scope>span');
    expect(values).toHaveLength(3);
    expect(stats).toHaveAttribute('data-tooltip', '共有4篇文献记录，4篇有PDF，4篇已完成解读。');
    expect(stats?.querySelectorAll('[data-tooltip]')).toHaveLength(0);
    expect(stats?.querySelectorAll('svg')).toHaveLength(0);
    expect(stats).toHaveTextContent('4/4/4');
    fireEvent.click(parent);
    await waitFor(() => expect(document.querySelectorAll('.paper-row')).toHaveLength(4));
    expect(screen.getByText('从“给答案”到“促思考”：智能辅导反馈设计的实证研究')).toBeInTheDocument();
    fireEvent.click(parent.closest('.tree-row')!.querySelector('.tree-toggle')!);
    fireEvent.click(screen.getByRole('button', { name: '反馈与评价 2 篇文献，2 篇有 PDF 全文，2 篇已解读' }));
    await waitFor(() => expect(document.querySelectorAll('.paper-row')).toHaveLength(2));
  });

  it('有文献但尚未解读的分类使用浅色状态，已有解读的分类不变', async () => {
    render(<App />);
    const uninterpreted = await screen.findByRole('button', { name: '研究方法 2 篇文献，1 篇有 PDF 全文，0 篇已解读' });
    const interpreted = screen.getByRole('button', { name: '人工智能与教育 4 篇文献，4 篇有 PDF 全文，4 篇已解读' });
    expect(uninterpreted.closest('.tree-row')).toHaveClass('uninterpreted');
    expect(interpreted.closest('.tree-row')).not.toHaveClass('uninterpreted');

    fireEvent.click(uninterpreted);
    expect(uninterpreted.closest('.tree-row')).toHaveClass('active');
  });

  it('未加入分类居中显示统计，加入后直接打开第二步预览', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /^研究方法/ }));
    const card = screen.getByRole('region', { name: '研究方法' });
    expect(card).toHaveTextContent('本文件夹有 2 篇文献，含有 1 篇 PDF 全文，尚未导入 Zotero Reader。');
    expect(screen.queryByRole('button', { name: '同步 Zotero' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '加入 Zotero Reader' }));
    expect(await screen.findByRole('dialog', { name: '确认导入范围' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '选择 研究方法' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: '导入 2 篇文献' }));
    expect(await screen.findByText('2 篇文献已进入本地资源库')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /查看资源库/ }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '加入 Zotero Reader' })).not.toBeInTheDocument());
  });

  it('保存密钥后保留当前配置并可通过眼睛切换可见性', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    const input = await screen.findByLabelText('DeepSeek API Key');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.change(input, { target: { value: 'test-secret-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 DeepSeek 密钥' }));
    expect(await screen.findByText('已配置')).toBeInTheDocument();
    expect(input).toHaveValue('test-secret-key');
    expect(input).toHaveAttribute('type', 'password');
    fireEvent.click(screen.getByRole('button', { name: '显示 DeepSeek 密钥' }));
    expect(input).toHaveAttribute('type', 'text');
    fireEvent.click(screen.getByRole('button', { name: '隐藏 DeepSeek 密钥' }));
    expect(input).toHaveAttribute('type', 'password');
  });

  it('设置页按指定顺序展示三个服务的当前配置', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    expect(await screen.findByLabelText('Zotero 本地 API 地址')).toHaveValue('http://127.0.0.1:23119/api/users/0');
    expect(document.querySelectorAll('.service-card')).toHaveLength(3);
    expect([...document.querySelectorAll('.service-card-title strong')].map(element => element.textContent)).toEqual(['Zotero 本地 API', 'Doc2X', 'DeepSeek']);
    const sections = document.querySelectorAll('.settings-section');
    expect(sections[0]).toHaveTextContent('服务连接');
    expect(sections[1]).toHaveTextContent('文献解读提示词');
    expect(sections[2]).toHaveTextContent('备份与恢复');
    expect(sections[3]).toHaveTextContent('打开 config.json');
  });

  it('设置页原位展示完整文献解读提示词', async () => {
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    fireEvent.click(await screen.findByRole('button', { name: /文献解读提示词/ }));
    const editor = await screen.findByRole('textbox', { name: '文献解读提示词内容' });
    await waitFor(() => expect((editor as HTMLTextAreaElement).value).toContain('描述作者采用的研究方法（如实验、调查、建模、定量/定性分析等）。'));
    expect((editor as HTMLTextAreaElement).value).toContain('给出自己对相关领域未来研究的建议和启示。');
    expect(screen.getByRole('button', { name: '保存提示词' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '恢复默认' })).toBeEnabled();
  });

  it('提示词可保存修改并一键恢复默认配置', async () => {
    const save = vi.spyOn(api, 'saveLiteraturePrompt');
    const reset = vi.spyOn(api, 'resetLiteraturePrompt');
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '设置' }));
    fireEvent.click(await screen.findByRole('button', { name: /文献解读提示词/ }));
    const editor = await screen.findByRole('textbox', { name: '文献解读提示词内容' });
    await waitFor(() => expect(editor).not.toBeDisabled());
    fireEvent.change(editor, { target: { value: '  自定义文献解读提示词  ' } });
    expect(screen.getByText('有未保存的修改')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保存提示词' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith('  自定义文献解读提示词  '));
    expect(await screen.findByText('演示提示词已更新。')).toBeInTheDocument();
    expect(editor).toHaveValue('自定义文献解读提示词');
    expect(screen.getByRole('button', { name: '保存提示词' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: '恢复默认' }));
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('演示提示词已恢复默认。')).toBeInTheDocument();
    expect((editor as HTMLTextAreaElement).value).toContain('描述作者采用的研究方法（如实验、调查、建模、定量/定性分析等）。');
    expect(await api.literaturePrompt()).toContain('给出自己对相关领域未来研究的建议和启示。');
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
