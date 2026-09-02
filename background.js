/**
 * 网申投递助手 - Background Service Worker
 */

const RECORDS_STORAGE_KEY = 'autumnRecruitmentTracker.records.v1';
const RESUME_STORAGE_KEY = 'autumnRecruitmentTracker.resume.v1';
const LLM_STORAGE_KEY = 'autumnRecruitmentTracker.llm.v1';
const LLM_LOGS_STORAGE_KEY = 'autumnRecruitmentTracker.llmLogs.v1';

// 初始默认示例简历数据
const DEFAULT_RESUME_DATA = {
  "优先信息": {
    "身份证": "110101199801011234",
    "手机": "13800138000",
    "邮箱": "job_hunter@example.com",
    "微信号": "wechat_demo",
    "现居地": "北京市海淀区",
    "求职意向": "AI产品经理 / 算法工程师"
  },
  "基本信息": {
    "姓名": "李明",
    "性别": "男",
    "出生年月": "1999-06",
    "政治面貌": "共青团员",
    "籍贯": "山东省济南市",
    "紧急联系人": "李华 (父子 13900139000)",
    "自我评价": "具备扎实的AI技术认知与产品化落地经验，深度理解大语言模型、多智能体交互机制。自驱力强，跨部门沟通流畅，多次主导高校与工业级产学研项目。"
  },
  "教育经历": [
    {
      "_rowName": "硕士",
      "学校": "浙江大学",
      "学院": "计算机科学与技术学院",
      "专业": "人工智能",
      "学历": "硕士研究生",
      "开始时间": "2023-09",
      "结束时间": "2026-06",
      "导师": "张教授",
      "专业排名": "前 5%"
    },
    {
      "_rowName": "本科",
      "学校": "华东理工大学",
      "学院": "信息科学与工程学院",
      "专业": "软件工程",
      "学历": "本科",
      "开始时间": "2019-09",
      "结束时间": "2023-06",
      "GPA": "3.85 / 4.0",
      "荣誉": "国家励志奖学金、校优秀毕业生"
    }
  ],
  "实习经历": [
    {
      "_rowName": "字节跳动",
      "单位": "北京字节跳动科技有限公司",
      "部门": "商业化产品部",
      "岗位": "AI产品经理实习生",
      "开始": "2025-06",
      "结束": "至今",
      "证明人": "王主管",
      "岗位职责": "1. 主导智能广告生成 Agent 方案设计，构建提示词工程与评估指标集；\n2. 协同算法团队完成模型微调与端到端延迟优化，CTR 提升 12.4%；\n3. 撰写多份高保真 PRD 与交互原型，推动敏捷迭代上线。"
    }
  ],
  "项目经历": [
    {
      "_rowName": "Multi-Agent 仿真系统",
      "项目名称": "基于大模型多智能体的自动化仿真与决策工作流平台",
      "角色": "核心负责人",
      "开始": "2024-09",
      "结束": "2025-05",
      "主要工作": "1. 设计认知层-技能层解耦架构，结合拓扑校验与动态 Prompt 编排实现手绘草图到工业仿真的端到端闭环；\n2. 提出基于质心的空间推理机制，弥合自然语言与抽象边界条件之间的语义差距；\n3. 投稿 SCI/EI 顶级期刊一篇 (Under Review)。",
      "技术栈": "Python, LLM Agent, LangChain, Vue.js, FastAPI"
    }
  ],
  "竞赛与技能": {
    "英语水平": "CET-6 (598分) / 英语流利",
    "专业技能": "Python, SQL, Figma, Axure, Prompt Engineering, Agent Architecture",
    "学术竞赛": "全国大学生数学建模竞赛一等奖、互联网+大学生创新创业大赛银奖"
  }
};

// 打开或聚焦 Dashboard
async function openOrFocusDashboard(targetHash = '') {
  const dashboardUrl = chrome.runtime.getURL('dashboard.html');
  const fullTargetUrl = targetHash ? `${dashboardUrl}${targetHash}` : dashboardUrl;
  
  const tabs = await chrome.tabs.query({});
  const existingTab = tabs.find(tab => tab.url && tab.url.startsWith(dashboardUrl));
  
  if (existingTab && existingTab.id) {
    // 未指定锚点时回到默认的投递追踪看板，避免沿用此前停留的资料库页面。
    if (existingTab.url !== fullTargetUrl) {
      await chrome.tabs.update(existingTab.id, { url: fullTargetUrl, active: true });
    } else {
      await chrome.tabs.update(existingTab.id, { active: true });
    }
    if (existingTab.windowId) {
      await chrome.windows.update(existingTab.windowId, { focused: true });
    }
  } else {
    await chrome.tabs.create({ url: fullTargetUrl });
  }
}

// 初始化时检查并写入默认简历（如果尚无配置）
chrome.runtime.onInstalled.addListener(async (details) => {
  try {
    const data = await chrome.storage.local.get([RESUME_STORAGE_KEY]);
    if (!data[RESUME_STORAGE_KEY]) {
      await chrome.storage.local.set({ [RESUME_STORAGE_KEY]: DEFAULT_RESUME_DATA });
    }
  } catch (err) {
    console.error('初始化简历默认数据失败', err);
  }
});

// ================= LLM 助力岗位一键收录 =================
const LLM_SYSTEM_PROMPT = `你是招聘信息抽取助手。我会给你一个求职类网页的文本内容，请从其中提取岗位关键信息，并且只返回一个 JSON 对象，不要输出任何其他文字，也不要用 Markdown 代码块包裹。

必须严格按以下字段返回（缺失或无法从文本判断时返回空字符串 ""，禁止臆测或编造）：

{
  "company": "公司全称；可以综合页面正文、结构化数据、页面标题和 URL 判断。若 URL 中包含明确的公司自有域名或品牌标识（例如 campus.dewu.com 可还原为 得物），请还原为常用中文公司名；确实无法判断时留空，不要编造",
  "position": "岗位名称（如：AI研发工程师），请清理掉序号、括号内的无关说明与"急招""校招"等字样",
  "city": "工作城市（如：上海）；多个城市用 / 分隔；无法判断则留空",
  "stage": "当前招聘阶段，只能取以下枚举之一：待投递 / 已投递 / 已测评 / 笔试 / 一面 / 二面 / HR面 / Offer / 简历挂 / 已结束；无法判断时输出"已投递"",
  "applicationDate": "投递日期，格式 YYYY-MM-DD；文中没有明确投递日期则输出空字符串",
  "jobDescription": "职位描述 / 岗位职责：完整摘录文中"职位描述""岗位职责""工作内容"等章节的内容，保留序号要点；无法确定则留空",
  "jobRequirements": "职位要求 / 任职要求：完整摘录文中"职位要求""任职要求""任职资格""岗位要求""职位JD"等章节的内容，保留序号要点；无法确定则留空"
}

注意：公司名可能不在岗位描述正文中，可以结合页面标题和 URL 中的公司域名或品牌标识进行推断；只有在缺乏可靠线索时才输出空字符串。`;

function normalizeBaseUrl(baseUrl) {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

async function requestLLMAttempt(url, headers, body, attempts, attempt, jsonMode) {
  const startedAt = performance.now();
  let status = null;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    status = response.status;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '';
    attempts.push({ attempt, jsonMode, status, durationMs: Math.round(performance.now() - startedAt), outputChars: content.length, ok: true });
    return content;
  } catch (err) {
    attempts.push({
      attempt,
      jsonMode,
      status,
      durationMs: Math.round(performance.now() - startedAt),
      ok: false,
      error: String(err.message || err).slice(0, 120)
    });
    throw err;
  }
}

async function callLLM(config, messages) {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const url = `${baseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`
  };
  const thinkingDisabled = config.disableThinking !== false
    && (baseUrl.includes('dashscope.aliyuncs.com') || /^qwen3/i.test(config.model));
  const baseBody = {
    model: config.model,
    messages,
    temperature: 0,
    ...(thinkingDisabled ? { enable_thinking: false } : {})
  };
  const attempts = [];
  const startedAt = performance.now();
  try {
    const content = await requestLLMAttempt(url, headers, { ...baseBody, response_format: { type: 'json_object' } }, attempts, 1, true);
    return { content, attempts, apiMs: Math.round(performance.now() - startedAt), thinkingDisabled };
  } catch (_) {
    try {
      const content = await requestLLMAttempt(url, headers, baseBody, attempts, 2, false);
      return { content, attempts, apiMs: Math.round(performance.now() - startedAt), thinkingDisabled };
    } catch (err) {
      err.llmAttempts = attempts;
      err.llmApiMs = Math.round(performance.now() - startedAt);
      throw err;
    }
  }
}

function parseJsonContent(content) {
  try { return JSON.parse(content); } catch (_) {}
  const m = String(content || '').match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) {} }
  return null;
}

async function llmGetConfig() {
  try {
    const res = await chrome.storage.local.get([LLM_STORAGE_KEY]);
    return res[LLM_STORAGE_KEY] || {};
  } catch (_) {
    return {};
  }
}

function safeEndpoint(baseUrl) {
  try {
    const url = new URL(normalizeBaseUrl(baseUrl));
    return `${url.origin}${url.pathname}`;
  } catch (_) {
    return '自定义地址';
  }
}

async function appendLlmLog(log) {
  try {
    const res = await chrome.storage.local.get([LLM_LOGS_STORAGE_KEY]);
    const logs = Array.isArray(res[LLM_LOGS_STORAGE_KEY]) ? res[LLM_LOGS_STORAGE_KEY] : [];
    logs.unshift({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, ...log });
    await chrome.storage.local.set({ [LLM_LOGS_STORAGE_KEY]: logs.slice(0, 50) });
  } catch (err) {
    console.warn('保存 LLM 调用日志失败', err);
  }
}

// 监听各页面消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'OPEN_DASHBOARD') {
    openOrFocusDashboard(request.targetHash || '').then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (request.type === 'EXTRACT_JOB_LLM') {
    (async () => {
      const startedAt = performance.now();
      const pageText = String(request.pageText || '');
      const baseLog = {
        kind: 'extract',
        at: Date.now(),
        inputChars: pageText.length,
        clientTimings: request.clientTimings || {}
      };
      let config = {};
      try {
        config = await llmGetConfig();
        Object.assign(baseLog, { model: config.model || '', endpoint: safeEndpoint(config.baseUrl) });
        if (!config.enabled) {
          await appendLlmLog({ ...baseLog, ok: false, status: 'skipped', error: '未启用 AI 解析', totalMs: Math.round(performance.now() - startedAt), attempts: [] });
          return sendResponse({ ok: false, message: '未启用 AI 解析' });
        }
        if (!config.baseUrl || !config.apiKey || !config.model) {
          await appendLlmLog({ ...baseLog, ok: false, status: 'skipped', error: 'LLM 配置不完整', totalMs: Math.round(performance.now() - startedAt), attempts: [] });
          return sendResponse({ ok: false, message: 'LLM 配置不完整' });
        }
        const user = `网页标题：${request.title || ''}\n网页地址：${request.url || ''}\n===== 页面正文 =====\n${pageText}`;
        const result = await callLLM(config, [
          { role: 'system', content: LLM_SYSTEM_PROMPT },
          { role: 'user', content: user }
        ]);
        const parseStartedAt = performance.now();
        const parsed = parseJsonContent(result.content);
        await appendLlmLog({
          ...baseLog,
          ok: Boolean(parsed),
          status: parsed ? 'success' : 'parse_error',
          outputChars: result.content.length,
          apiMs: result.apiMs,
          thinkingDisabled: result.thinkingDisabled,
          parseMs: Math.round(performance.now() - parseStartedAt),
          totalMs: Math.round(performance.now() - startedAt),
          attempts: result.attempts
        });
        if (!parsed) return sendResponse({ ok: false, message: 'LLM 返回无法解析为 JSON' });
        sendResponse({ ok: true, data: parsed });
      } catch (err) {
        await appendLlmLog({
          ...baseLog,
          ok: false,
          status: 'request_error',
          error: String(err.message || err).slice(0, 120),
          apiMs: err.llmApiMs || 0,
          totalMs: Math.round(performance.now() - startedAt),
          attempts: err.llmAttempts || []
        });
        sendResponse({ ok: false, message: err.message || String(err) });
      }
    })();
    return true;
  }

  if (request.type === 'TEST_LLM') {
    (async () => {
      const startedAt = performance.now();
      const config = await llmGetConfig();
      const baseLog = { kind: 'test', at: Date.now(), model: config.model || '', endpoint: safeEndpoint(config.baseUrl), inputChars: 4 };
      if (!config.baseUrl || !config.apiKey || !config.model) {
        await appendLlmLog({ ...baseLog, ok: false, status: 'skipped', error: 'LLM 配置不完整', totalMs: Math.round(performance.now() - startedAt), attempts: [] });
        return sendResponse({ ok: false, message: '请先填写完整配置' });
      }
      try {
        const result = await callLLM(config, [
          { role: 'system', content: '你是连接测试助手。请只返回 JSON 对象 {"ok":true}。' },
          { role: 'user', content: 'ping' }
        ]);
        const parsed = parseJsonContent(result.content);
        await appendLlmLog({ ...baseLog, ok: parsed?.ok === true, status: parsed?.ok === true ? 'success' : 'parse_error', outputChars: result.content.length, apiMs: result.apiMs, thinkingDisabled: result.thinkingDisabled, totalMs: Math.round(performance.now() - startedAt), attempts: result.attempts });
        sendResponse({ ok: parsed?.ok === true, raw: String(result.content).slice(0, 200) });
      } catch (err) {
        await appendLlmLog({ ...baseLog, ok: false, status: 'request_error', error: String(err.message || err).slice(0, 120), apiMs: err.llmApiMs || 0, totalMs: Math.round(performance.now() - startedAt), attempts: err.llmAttempts || [] });
        sendResponse({ ok: false, message: err.message || String(err) });
      }
    })().catch(err => sendResponse({ ok: false, message: err.message || String(err) }));
    return true;
  }

  if (request.type === 'SAVE_JOB_RECORD') {
    (async () => {
      try {
        const res = await chrome.storage.local.get([RECORDS_STORAGE_KEY]);
        let records = Array.isArray(res[RECORDS_STORAGE_KEY]) ? res[RECORDS_STORAGE_KEY] : [];
        
        const newRecord = {
          id: (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          company: String(request.record.company || '').trim() || '待确认公司',
          position: String(request.record.position || '').trim() || '待确认岗位',
          city: String(request.record.city || '').trim(),
          applicationDate: String(request.record.applicationDate || new Date().toISOString().slice(0, 10)),
          stage: String(request.record.stage || '已投递'),
          applicationUrl: String(request.record.applicationUrl || ''),
          jobDescription: String(request.record.jobDescription || ''),
          jobRequirements: String(request.record.jobRequirements || ''),
          scheduleAt: String(request.record.scheduleAt || ''),
          recentSchedule: String(request.record.recentSchedule || ''),
          nextAction: String(request.record.nextAction || ''),
          updatedAt: Date.now()
        };

        // 检查是否有同 URL 或同公司同岗位的记录，如有则提示或追加
        records.unshift(newRecord);
        await chrome.storage.local.set({ [RECORDS_STORAGE_KEY]: records });
        sendResponse({ ok: true, record: newRecord, total: records.length });
      } catch (err) {
        console.error('保存投递记录失败', err);
        sendResponse({ ok: false, message: err.message });
      }
    })();
    return true;
  }

  if (request.type === 'GET_RESUME_DATA') {
    (async () => {
      try {
        const res = await chrome.storage.local.get([RESUME_STORAGE_KEY]);
        const resume = res[RESUME_STORAGE_KEY] || DEFAULT_RESUME_DATA;
        sendResponse({ ok: true, data: resume });
      } catch (err) {
        sendResponse({ ok: false, data: DEFAULT_RESUME_DATA });
      }
    })();
    return true;
  }
});
