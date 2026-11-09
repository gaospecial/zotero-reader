import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../App';
import { api } from '../lib/api';
import { parseNoteLocator } from '../lib/textAnchors';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

async function selectFirstPaperStrong() {
  fireEvent.click(await screen.findByText('生成式人工智能如何促进大学生的自我调节学习？'));
  await screen.findByRole('heading', { name: '研究背景与目的', level: 2 });
  const section = document.querySelector<HTMLElement>('.article-section[data-section-index="1"]')!;
  const strong = section.querySelector('strong')!;
  const range = document.createRange();
  range.selectNodeContents(strong);
  Object.defineProperty(range, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: 200, bottom: 220, left: 300, right: 420, width: 120, height: 20, x: 300, y: 200, toJSON: () => ({}) }),
  });
  const selection = {
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => range,
    removeAllRanges: vi.fn(() => { selection.isCollapsed = true; }),
  };
  vi.spyOn(window, 'getSelection').mockImplementation(() => selection as unknown as Selection);
  fireEvent.mouseUp(section.parentElement!);
}

describe('AI 解读选段备忘', () => {
  it('完成选中保存、备忘中心回跳、编辑删除并保留总备忘', async () => {
    render(<App />);
    await selectFirstPaperStrong();
    fireEvent.click(await screen.findByRole('button', { name: '记备忘' }));
    expect(await screen.findByRole('dialog', { name: '添加选段备忘' })).toBeInTheDocument();
    expect(document.querySelector('.anchored-memo-source blockquote')).toHaveTextContent('带有元认知提示的 AI 反馈');
    fireEvent.change(screen.getByLabelText('选段备忘内容'), { target: { value: '这条选段需要复核。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存备忘' }));

    await waitFor(() => expect(document.querySelector('mark.memo-highlight')).toHaveTextContent('带有元认知提示的 AI 反馈'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(within(document.querySelector('.primary-nav')!).getByRole('button', { name: '备忘' }));
    const card = (await screen.findByText('这条选段需要复核。')).closest('.note-card-anchored') as HTMLElement;
    expect(card.querySelector('.note-card-quote')).toHaveTextContent('带有元认知提示的 AI 反馈');
    expect(card.querySelector('button')).toHaveTextContent('回到原文');
    fireEvent.click(card.querySelector('button')!);

    expect(await screen.findByRole('dialog', { name: '编辑选段备忘' })).toBeInTheDocument();
    expect(vi.mocked(HTMLElement.prototype.scrollIntoView)).toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('选段备忘内容'), { target: { value: '已复核这条选段。' } });
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(document.querySelector('mark.memo-highlight')!);
    expect(await screen.findByRole('dialog', { name: '编辑选段备忘' })).toBeInTheDocument();
    expect(screen.getByLabelText('选段备忘内容')).toHaveValue('已复核这条选段。');
    fireEvent.click(screen.getByRole('button', { name: '删除备忘' }));
    await waitFor(() => expect(document.querySelector('mark.memo-highlight')).not.toBeInTheDocument());
    expect((await api.detail('demo-1')).note).toBe('后续可重点关注“元认知提示”的实验操控，以及延迟迁移测验的设计。');
    expect(await api.itemNotes('demo-1')).toEqual([]);
  });

  it('无需填写文字即可保存颜色高亮，并能回跳改色', async () => {
    render(<App />);
    await selectFirstPaperStrong();
    fireEvent.click(await screen.findByRole('button', { name: '绿色高亮' }));
    await waitFor(() => expect(document.querySelector('mark.memo-highlight')).toHaveAttribute('data-color', 'green'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect((await api.itemNotes('demo-1'))[0].content).toBe('');

    fireEvent.click(within(document.querySelector('.primary-nav')!).getByRole('button', { name: '备忘' }));
    const card = (await screen.findByText('未填写备忘，仅保留选段高亮。')).closest('.note-card-anchored') as HTMLElement;
    expect(card.querySelector('.note-kind')).toHaveTextContent('颜色高亮');
    expect(card.querySelector('.note-card-quote')).toHaveAttribute('data-color', 'green');
    fireEvent.click(card.querySelector('button')!);

    expect(await screen.findByRole('dialog', { name: '编辑选段高亮' })).toBeInTheDocument();
    expect(screen.getByLabelText('选段备忘内容')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: '粉色高亮' }));
    expect(screen.getByRole('button', { name: '粉色高亮' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '保存修改' }));
    await waitFor(() => expect(document.querySelector('mark.memo-highlight')).toHaveAttribute('data-color', 'pink'));
    const [saved] = await api.itemNotes('demo-1');
    expect(saved.content).toBe('');
    expect(parseNoteLocator(saved.locator)?.color).toBe('pink');
    expect((await api.detail('demo-1')).note).toBe('后续可重点关注“元认知提示”的实验操控，以及延迟迁移测验的设计。');
  });
});
