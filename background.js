/**
 * 简历投递与进度管理助手 - Background Service Worker
 */

const RECORDS_STORAGE_KEY = 'autumnRecruitmentTracker.records.v1';
const RESUME_STORAGE_KEY = 'autumnRecruitmentTracker.resume.v1';

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
    if (targetHash && existingTab.url !== fullTargetUrl) {
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

// 点击扩展图标 -> 直接打开投递管理看板
chrome.action.onClicked.addListener(() => {
  openOrFocusDashboard();
});

// 监听各页面消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'OPEN_DASHBOARD') {
    openOrFocusDashboard(request.targetHash || '').then(() => {
      sendResponse({ ok: true });
    });
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
