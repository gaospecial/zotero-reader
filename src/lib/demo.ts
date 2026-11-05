import type { Bootstrap, Collection, Paper, PaperDetail, QaMessage, Section } from '../types';

const sectionText: Record<string, string> = {
  '基本信息提取': '本研究发表于 2024 年，聚焦生成式人工智能支持下的自我调节学习。研究团队来自学习科学与教育技术领域，采用准实验设计比较不同反馈方式的学习效果。',
  '研究背景与目的': '传统在线学习往往能提供即时答案，却未必促使学习者监控自己的理解过程。研究旨在检验：**带有元认知提示的 AI 反馈**，是否比直接答案反馈更能促进知识迁移与自我调节。',
  '研究方法': '研究采用随机分配的准实验设计，设置元认知提示组、直接反馈组与常规学习组。通过前测、后测和延迟测评估学习效果，并结合学习日志分析求助行为。\n\n优势在于多源数据相互印证；局限是样本来自单一课程，且干预周期相对较短。',
  '主要发现与结果': '元认知提示组在延迟迁移任务上的表现优于直接反馈组。学习日志显示，该组学习者在提问前进行了更多自我解释，而非简单请求答案。\n\n> 关键结果：AI 的教学价值取决于反馈方式，而不只是模型答案的准确程度。',
  '讨论与结论': '结果支持将生成式 AI 设计为“思维脚手架”，而非答案机器。元认知提示能够促使学习者监控理解、识别差距并调整策略。结论仍需在不同学科与更长周期中复验。',
  '创新点与贡献': '研究把自我调节学习理论转化为可执行的 AI 交互策略，并将结果测量与学习过程日志结合，为智能辅导系统的反馈设计提供了实证依据。',
  '个人评价与启示': '研究问题清晰，过程数据增强了结论可信度。后续研究可扩大跨学科样本，并报告提示频率、学习者认知负荷及长期依赖性。实践中应优先设计促进解释的提问，而非追求更快给出结论。',
};
const titles = [
  ['生成式人工智能如何促进大学生的自我调节学习？', 'Generative AI for Self-Regulated Learning in Higher Education', '元认知提示比直接答案反馈更能提升延迟迁移表现。'],
  ['从“给答案”到“促思考”：智能辅导反馈设计的实证研究', 'From Answers to Thinking: Feedback Design in Intelligent Tutoring', '结构化追问能显著减少学习者对 AI 答案的被动依赖。'],
  ['教师人机协同备课中的注意力分配与决策质量', 'Attention and Decision Quality in Human–AI Lesson Planning', '可解释的教学建议帮助教师把注意力转向学情判断。'],
  ['在线讨论中的社会临场感如何影响深度学习', 'Social Presence and Deep Learning in Online Discussions', '持续且具体的同伴回应比单纯增加发言数量更重要。'],
  ['学习分析仪表盘是否真的会改变教学行动？', 'Do Learning Analytics Dashboards Change Teaching Practice?', '仪表盘只有嵌入明确决策流程时才转化为教学行动。'],
  ['跨学科项目学习中的知识整合机制', 'Knowledge Integration in Interdisciplinary Project-Based Learning', '共享表征与迭代反思是跨学科知识整合的关键机制。'],
  ['基于形成性评价的错误概念诊断与干预', 'Diagnosing Misconceptions through Formative Assessment', '针对错误概念的分层反馈优于统一讲解。'],
  ['数字阅读中的笔记策略与长期保持', 'Note-taking Strategies and Retention in Digital Reading', '生成性摘要比逐字复制更有利于一周后的知识保持。'],
];

export const demoCollections: Collection[] = [
  { key: 'ai', name: '人工智能与教育', parentKey: null, itemCount: 4, joined: true },
  { key: 'feedback', name: '反馈与评价', parentKey: 'ai', itemCount: 3, joined: true },
  { key: 'learning', name: '学习科学', parentKey: null, itemCount: 4, joined: true },
  { key: 'online', name: '在线学习', parentKey: 'learning', itemCount: 2, joined: true },
  { key: 'methods', name: '研究方法', parentKey: null, itemCount: 2, joined: false },
];
const sections = (): Section[] => Object.entries(sectionText).map(([title, content]) => ({ title, content }));
export const demoPapers: Paper[] = titles.map(([titleZh, title, oneSentence], index) => ({
  id: `demo-${index + 1}`, zoteroKey: `DEMO${index + 1}`, zoteroVersion: 1, title, titleZh, oneSentence,
  creators: [['林晓', '陈默'], ['周研', '许舟'], ['高宁', '韩青']][index % 3], year: 2024 - (index % 3), publication: ['学习科学研究', '教育技术学报', '开放教育研究'][index % 3], journalAbbreviation: ['学习科学', '教育技术', '开放教育'][index % 3],
  abstractNote: oneSentence, doi: `10.0000/demo.${index + 1}`, url: '', itemType: 'journalArticle', tags: [['AI 反馈', '自我调节'], ['学习分析', '实证研究'], ['教学策略']][index % 3],
  collections: [index < 4 ? 'ai' : 'learning'], pdfState: index === 6 ? 'unavailable' : 'available', parseState: index === 6 ? 'not_started' : 'succeeded',
  aiState: index === 6 ? 'not_started' : index === 7 ? 'generating' : 'succeeded', zoteroState: 'active', localState: 'active', readState: index % 3 === 0 ? 'unread' : index % 3 === 1 ? 'reading' : 'read',
  mainPdfKey: index === 6 ? null : `PDF${index + 1}`, needsPdfChoice: false, error: null, interpretationId: index >= 6 ? null : `interp-${index + 1}`,
  pendingZoteroTrash: false, updatedAt: new Date(Date.now() - index * 86400000).toISOString(), importedAt: new Date(Date.now() - 20 * 86400000).toISOString(),
}));
export const demoBootstrap: Bootstrap = {
  papers: demoPapers, collections: demoCollections,
  stats: { total: 8, unread: 3, processing: 1, trash: 0, pendingSync: 0 },
  services: { zoteroConnected: false, deepseekConfigured: false, doc2xConfigured: false, demoMode: true },
};
export function demoDetail(paper: Paper): PaperDetail {
  return { ...paper, interpretation: paper.interpretationId ? { id: `interp-${paper.id}`, itemId: paper.id, markdownVersionId: `md-${paper.id}`, titleZh: paper.titleZh, oneSentence: paper.oneSentence, sections: sections(), figures: [], model: 'deepseek-v4-flash-vision-exp', createdAt: paper.updatedAt } : null, note: paper.id === 'demo-1' ? '后续可重点关注“元认知提示”的实验操控，以及延迟迁移测验的设计。' : '' };
}
export function demoAnswer(question: string): string {
  return `围绕“${question}”，文献的核心观点是：AI 反馈应帮助学习者识别理解差距，而不是替代其思考。\n\n【来源：研究方法】研究通过前测、后测与延迟测比较不同反馈条件，并结合学习日志分析过程变化。\n\n【来源：主要发现与结果】元认知提示组在延迟迁移任务上表现更好，也出现了更多自我解释行为。\n\n【模型推断】这意味着在实际产品中，可以优先设计“你先判断哪里不确定”一类追问，但仍需结合具体学科验证。`;
}
export const emptyQa: QaMessage[] = [];
