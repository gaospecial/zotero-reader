import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QaPanel from '../components/QaPanel';
import { api } from '../lib/api';
import { demoDetail, demoPapers } from '../lib/demo';
import type { QaMessage } from '../types';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

describe('文献问答等待状态', () => {
  it('桌面请求完成后即使 done 事件未送达也退出等待并显示回答', async () => {
    Object.defineProperty(window, '__TAURI_INTERNALS__', { configurable: true, value: {} });
    const detail = demoDetail(demoPapers[0]);
    const answer: QaMessage = {
      id: 'answer-1', itemId: detail.id, role: 'assistant', content: '已完成的回答',
      sources: [], visualRefs: [], inference: false, usage: null, createdAt: new Date().toISOString(),
    };
    vi.spyOn(api, 'qa').mockResolvedValueOnce([]).mockResolvedValue([answer]);
    const ask = vi.spyOn(api, 'ask').mockResolvedValue();
    const notify = vi.fn();
    render(<QaPanel paper={detail} notify={notify} onSource={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText('围绕这篇文献提问…'), { target: { value: '研究结论是什么？' } });
    fireEvent.click(screen.getByRole('button', { name: '发送问题' }));

    await waitFor(() => expect(ask).toHaveBeenCalledWith(detail.id, '研究结论是什么？', expect.any(Function)));
    expect(await screen.findByText('已完成的回答')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('正在检索当前文献…')).not.toBeInTheDocument());
    expect(screen.getByPlaceholderText('围绕这篇文献提问…')).toBeEnabled();
    expect(notify).not.toHaveBeenCalled();
  });
});
