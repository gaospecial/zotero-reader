import { describe, expect, it } from 'vitest';
import type { Note, NoteLocator } from '../types';
import { applyNoteHighlights, clearNoteHighlights, createNoteLocator, parseNoteLocator } from '../lib/textAnchors';

function noteFor(locator: NoteLocator, content = '测试备忘'): Note {
  return {
    id: 'note-1', itemId: 'paper-1', interpretationId: 'interpretation-1', title: '', content,
    locator: JSON.stringify(locator), updatedAt: new Date().toISOString(),
  };
}

describe('选段文字锚点', () => {
  it('保存并恢复跨加粗节点的选区', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>研究采用<strong>随机分配</strong>的准实验设计。</p>';
    document.body.appendChild(root);
    const strong = root.querySelector('strong')!;
    const range = document.createRange();
    range.setStart(strong.firstChild!, 0);
    range.setEnd(root.querySelector('p')!.lastChild!, 6);
    const locator = createNoteLocator(root, range, 2, '研究方法')!;
    expect(locator.exact).toBe('随机分配的准实验设计');
    expect(locator.prefix).toBe('研究采用');
    expect(locator.suffix).toBe('。');
    expect(locator.color).toBe('yellow');

    const matched = applyNoteHighlights(root, [noteFor(locator)]);
    expect(matched.has('note-1')).toBe(true);
    const marks = [...root.querySelectorAll('mark.memo-highlight')];
    expect(marks.map(mark => mark.textContent).join('')).toBe(locator.exact);
    clearNoteHighlights(root);
    expect(root.textContent).toBe('研究采用随机分配的准实验设计。');
    expect(root.querySelector('strong')?.textContent).toBe('随机分配');
    root.remove();
  });

  it('跨段落选择时用空格保持引用与定位一致', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>第一段结尾</p><p>第二段开头</p>';
    document.body.appendChild(root);
    const paragraphs = root.querySelectorAll('p');
    const range = document.createRange();
    range.setStart(paragraphs[0].firstChild!, 0);
    range.setEnd(paragraphs[1].firstChild!, 5);
    const locator = createNoteLocator(root, range, 0, '测试章节')!;
    expect(locator.exact).toBe('第一段结尾 第二段开头');

    expect(applyNoteHighlights(root, [noteFor(locator)]).has('note-1')).toBe(true);
    const marks = [...root.querySelectorAll('mark.memo-highlight')];
    expect(marks.map(mark => mark.textContent).join('')).toBe('第一段结尾第二段开头');
    clearNoteHighlights(root);
    expect(root.querySelectorAll('p')).toHaveLength(2);
    root.remove();
  });

  it('字符位置失效时仍按精确引用恢复高亮', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>新增加的开头，随机分配，新增的结尾。</p>';
    document.body.appendChild(root);
    const locator: NoteLocator = { version: 1, sectionIndex: 0, sectionTitle: '研究方法', exact: '随机分配', prefix: '旧前缀', suffix: '旧后缀', start: 99, end: 103, color: 'pink' };
    expect(applyNoteHighlights(root, [noteFor(locator)]).has('note-1')).toBe(true);
    expect(root.querySelector('mark.memo-highlight')).toHaveTextContent('随机分配');
    expect(root.querySelector('mark.memo-highlight')).toHaveAttribute('data-color', 'pink');
    clearNoteHighlights(root);
    root.remove();
  });

  it('空白备忘按所选颜色高亮，旧版定位默认黄色', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>需要标记的研究结论</p>';
    document.body.appendChild(root);
    const range = document.createRange();
    range.selectNodeContents(root.querySelector('p')!);
    const locator = createNoteLocator(root, range, 0, '研究结论', 'green')!;
    expect(applyNoteHighlights(root, [noteFor(locator, '')]).has('note-1')).toBe(true);
    const mark = root.querySelector<HTMLElement>('mark.memo-highlight')!;
    expect(mark).toHaveAttribute('data-color', 'green');
    expect(mark).toHaveAttribute('aria-label', '查看选段高亮');
    expect(mark.title).toBe('选段高亮');
    expect(parseNoteLocator(JSON.stringify({ ...locator, color: undefined }))?.color).toBe('yellow');
    clearNoteHighlights(root);
    root.remove();
  });
});
