import { ArchiveRestore, CheckCircle2, ChevronDown, DatabaseBackup, Download, ExternalLink, FileKey2, LoaderCircle, Server, Upload, Wifi, WifiOff } from 'lucide-react';
import { useState } from 'react';
import { api, isDesktop } from '../lib/api';
import type { ServiceStatus } from '../types';
import { Modal } from './ui';
import literaturePrompt from '../../prompts/literature_interpretation.txt?raw';
import './SettingsDialog.css';

type ApiService = 'deepseek' | 'doc2x';

export default function SettingsDialog({ services, onClose, onChanged, notify }: { services: ServiceStatus; onClose: () => void; onChanged: () => void; notify: (message: string, tone?: 'success' | 'error' | 'info') => void }) {
  const [busy, setBusy] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);
  const [keys, setKeys] = useState<Record<ApiService, string>>({ deepseek: '', doc2x: '' });
  const run = async (name: string, action: () => Promise<void>) => { setBusy(name); try { await action(); } catch (error) { notify(String(error), 'error'); } finally { setBusy(''); } };
  const exportBackup = () => run('export', async () => { if (!isDesktop) return notify('备份导出需要在桌面应用中执行。', 'info'); const { save } = await import('@tauri-apps/plugin-dialog'); const path = await save({ defaultPath: `zotero-reader-${new Date().toISOString().slice(0, 10)}.zip`, filters: [{ name: 'Zotero Reader 备份', extensions: ['zip'] }] }); if (path) { await api.exportBackup(path); notify('本地备份已导出。', 'success'); } });
  const restoreBackup = () => { if (!window.confirm('恢复备份会替换当前本地数据库与解析文件。建议先导出当前备份。是否继续？')) return; run('restore', async () => { if (!isDesktop) return notify('备份恢复需要在桌面应用中执行。', 'info'); const { open } = await import('@tauri-apps/plugin-dialog'); const path = await open({ multiple: false, filters: [{ name: 'Zotero Reader 备份', extensions: ['zip'] }] }); if (typeof path === 'string') { await api.restoreBackup(path); onChanged(); notify('备份已恢复。', 'success'); } }); };
  const saveKey = (service: ApiService) => run(`key-${service}`, async () => {
    const key = keys[service].trim();
    if (!key) return notify('请输入 API Key。', 'error');
    await api.setApiKey(service, key);
    setKeys(current => ({ ...current, [service]: '' }));
    onChanged();
    notify(isDesktop ? `${service === 'deepseek' ? 'DeepSeek' : 'Doc2X'} 密钥已保存到应用配置文件。` : '演示配置已更新。', 'success');
  });

  return <Modal title="连接与本地数据" eyebrow="PREFERENCES" onClose={onClose} wide><div className="settings-body">
    <section className="settings-section"><h3>服务连接</h3><div className="service-list">
      <div className="service-row"><span className="service-icon"><Wifi size={18} /></span><div><strong>Zotero 本地 API</strong><p>127.0.0.1:23119 · 不读取 zotero.sqlite</p></div><span className={services.zoteroConnected ? 'config-ok' : 'config-off'}>{services.zoteroConnected ? <CheckCircle2 size={14} /> : <WifiOff size={14} />}{services.demoMode ? '演示模式' : services.zoteroConnected ? '已连接' : '未连接'}</span></div>
      {(['deepseek', 'doc2x'] as const).map(service => {
        const label = service === 'deepseek' ? 'DeepSeek' : 'Doc2X';
        const configured = service === 'deepseek' ? services.deepseekConfigured : services.doc2xConfigured;
        return <div className="service-row service-config-row" key={service}>
          <div className="service-summary">
            <span className="service-icon">{service === 'deepseek' ? <FileKey2 size={18} /> : <Server size={18} />}</span>
            <div><strong>{label}</strong><p>config.json 或环境变量 {service === 'deepseek' ? 'DEEPSEEK_API_KEY' : 'DOC2X_API_KEY'}</p></div>
            <span className={configured ? 'config-ok' : 'config-off'}>{configured ? '已配置' : '未配置'}</span>
          </div>
          <div className="api-key-field">
            <label htmlFor={`${service}-api-key`}>{label} API Key</label>
            <div className="api-key-input-row"><input id={`${service}-api-key`} type="password" value={keys[service]} onChange={event => setKeys(current => ({ ...current, [service]: event.target.value }))} placeholder={`输入 ${label} API Key`} autoComplete="off" spellCheck={false} /><button onClick={() => saveKey(service)} disabled={!!busy} aria-label={`保存 ${label} 密钥`}>{busy === `key-${service}` ? <LoaderCircle className="spin" /> : '保存'}</button></div>
          </div>
        </div>;
      })}
    </div>
    <div className="security-note"><FileKey2 size={15} /><p>密钥以明文保存在应用数据目录的 config.json 中，不回显、不写入数据库或备份；文件中的显式配置优先，环境变量作为后备。模型、接口地址、Zotero 路径和文献解读提示词也可在该文件中显式配置。</p><button className="secondary-button" onClick={() => run('config', async () => { const message = await api.openConfig(); notify(message, 'success'); })} disabled={!!busy}>打开 config.json</button></div></section>
    <section className="settings-section"><h3>备份与恢复</h3><p className="settings-help">备份包含 SQLite 数据库、全部 Markdown 历史版本和论文图片；PDF 仍由 Zotero 管理，不会复制到备份。</p><div className="backup-actions"><button onClick={exportBackup} disabled={!!busy}>{busy === 'export' ? <LoaderCircle className="spin" size={16} /> : <Download size={16} />}<span><strong>导出本地备份</strong><small>数据库 + 解析版本 + 图片</small></span><DatabaseBackup size={18} /></button><button onClick={restoreBackup} disabled={!!busy}>{busy === 'restore' ? <LoaderCircle className="spin" size={16} /> : <Upload size={16} />}<span><strong>从备份恢复</strong><small>恢复前需明确确认</small></span><ArchiveRestore size={18} /></button></div></section>
    <section className="settings-section prompt-settings"><button onClick={() => setShowPrompt(!showPrompt)} aria-expanded={showPrompt}><span><strong>系统默认提示词</strong><small>默认完整原文 · 可在 config.json 中自定义</small></span><ChevronDown size={16} /></button>{showPrompt && <pre className="prompt-preview">{literaturePrompt}</pre>}</section>
    <footer className="modal-footer"><a href="https://www.zotero.org/support/dev/web_api/v3/local_api" target="_blank" rel="noreferrer">Zotero 本地 API 说明<ExternalLink size={12} /></a><button className="primary-button" onClick={onClose}>完成</button></footer>
  </div></Modal>;
}
