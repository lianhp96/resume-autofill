/**
 * 简历投递与进度管理助手 - 核心业务逻辑
 * 支持投递追踪、可视化简历库编辑、数据安全与离线 OCR 识别
 */

const TODO_STATUS = Object.freeze({
  PENDING: 'pending',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed'
});

function isRecordPendingTodo(record) {
  return record?.todoStatus === TODO_STATUS.PENDING;
}

function isRecordUpcomingSchedule(record, referenceTime = Date.now()) {
  const scheduleTime = record?.scheduleAt ? new Date(record.scheduleAt).getTime() : NaN;
  return Number.isFinite(scheduleTime) && scheduleTime >= referenceTime - 86400000;
}

function isRecordVisibleUpcoming(record, referenceTime = Date.now()) {
  return isRecordPendingTodo(record) || isRecordUpcomingSchedule(record, referenceTime);
}

function matchesPipelineFilter(record, filter) {
  if (filter === 'all') return true;
  if (filter === 'todo') return isRecordPendingTodo(record);
  return record?.stage === filter;
}

function compareUpcomingRecords(a, b) {
  const aIsTodo = isRecordPendingTodo(a);
  const bIsTodo = isRecordPendingTodo(b);
  if (aIsTodo && bIsTodo) return (b.todoCreatedAt || 0) - (a.todoCreatedAt || 0);
  if (aIsTodo !== bIsTodo) return aIsTodo ? -1 : 1;

  const aSchedule = a?.scheduleAt ? new Date(a.scheduleAt).getTime() : NaN;
  const bSchedule = b?.scheduleAt ? new Date(b.scheduleAt).getTime() : NaN;
  if (Number.isFinite(aSchedule) && Number.isFinite(bSchedule)) return aSchedule - bSchedule;
  if (Number.isFinite(aSchedule)) return -1;
  if (Number.isFinite(bSchedule)) return 1;
  return 0;
}

function transitionRecordTodo(record, nextStatus, timestamp = Date.now()) {
  const next = { ...record, todoStatus: nextStatus, updatedAt: timestamp };
  delete next.todoCancelledAt;
  delete next.todoCompletedAt;

  if (nextStatus === TODO_STATUS.PENDING) next.todoCreatedAt = timestamp;
  if (nextStatus === TODO_STATUS.CANCELLED) next.todoCancelledAt = timestamp;
  if (nextStatus === TODO_STATUS.COMPLETED) next.todoCompletedAt = timestamp;
  return next;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    TODO_STATUS,
    isRecordPendingTodo,
    isRecordUpcomingSchedule,
    isRecordVisibleUpcoming,
    matchesPipelineFilter,
    compareUpcomingRecords,
    transitionRecordTodo
  };
}

if (typeof document !== 'undefined') (() => {
  'use strict';

  // ================= 常量定义 =================
  const STAGES = ['待投递', '已投递', '已测评', '笔试', '一面', '二面', 'HR面', 'Offer', '简历挂', '已结束'];
  const STAGE_ADVANCE_ORDER = ['待投递', '已投递', '已测评', '笔试', '一面', '二面', 'HR面', 'Offer', '已结束'];
  const RESUME_SECTION_ORDER = ['优先信息', '基本信息', '教育经历', '实习经历', '项目经历', '竞赛与技能'];
  const RECORDS_STORAGE_KEY = 'autumnRecruitmentTracker.records.v1';
  const RESUME_STORAGE_KEY = 'autumnRecruitmentTracker.resume.v1';
  const SAFETY_DB_NAME = 'autumnRecruitmentTracker.safety.v1';
  const LLM_STORAGE_KEY = 'autumnRecruitmentTracker.llm.v1';
  const LLM_LOGS_STORAGE_KEY = 'autumnRecruitmentTracker.llmLogs.v1';
  const APP_VERSION = '2.2.2';

  // 默认示例简历种子
  const DEFAULT_RESUME = {
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

  // 默认示例投递记录
  function getExampleRecords() {
    const now = Date.now();
    return [
      { id: cryptoId(), company: '腾讯科技', position: 'AI产品经理校招生', city: '深圳', applicationDate: new Date(now - 86400000 * 3).toISOString().slice(0, 10), stage: '一面', applicationUrl: 'https://careers.tencent.com', scheduleAt: new Date(now + 86400000 * 2).toISOString().slice(0, 16), recentSchedule: '腾讯会议专业面', nextAction: '复盘 Agent 架构项目经历，准备 3 分钟自我介绍', updatedAt: now - 3000 },
      { id: cryptoId(), company: '字节跳动', position: '大模型应用产品经理', city: '北京', applicationDate: new Date(now - 86400000 * 8).toISOString().slice(0, 10), stage: '笔试', applicationUrl: 'https://jobs.bytedance.com', scheduleAt: new Date(now + 86400000 * 1).toISOString().slice(0, 16), recentSchedule: '在线专业笔试', nextAction: '复习产品分析案例与行测', updatedAt: now - 6000 },
      { id: cryptoId(), company: '阿里巴巴', position: '算法工程师 (NLP/Agent)', city: '杭州', applicationDate: new Date(now - 86400000 * 12).toISOString().slice(0, 10), stage: '二面', applicationUrl: 'https://talent.alibaba.com', scheduleAt: new Date(now + 86400000 * 4).toISOString().slice(0, 16), recentSchedule: '总监业务面', nextAction: '深入准备多物理场仿真论文讲解', updatedAt: now - 10000 },
      { id: cryptoId(), company: '美团', position: '商业化产品经理', city: '北京', applicationDate: new Date(now - 86400000 * 20).toISOString().slice(0, 10), stage: 'Offer', applicationUrl: 'https://zhaopin.meituan.com', scheduleAt: '', recentSchedule: '已发放录用意向书', nextAction: '确认薪资与入职时间', updatedAt: now - 15000 }
    ];
  }

  // ================= 全局状态 =================
  let records = [];
  let currentResume = DEFAULT_RESUME;
  let editingRecordId = null;
  let pipelineFilter = 'all';
  let ocrWorker = null;
  let ocrFile = null;
  let safetyDbPromise = null;

  // ================= 辅助函数 =================
  function $(selector) { return document.querySelector(selector); }
  function $$(selector) { return document.querySelectorAll(selector); }

  function cryptoId() {
    return (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function showToast(msg) {
    const toast = $('#globalToast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 2200);
  }

  // ================= 统一存储适配层 =================
  async function storageGet(key) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const res = await chrome.storage.local.get([key]);
      return res[key];
    }
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }

  async function storageSet(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ [key]: value });
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  }

  // ================= IndexedDB 快照恢复系统 =================
  function openSafetyDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('当前浏览器不支持快照'));
    if (safetyDbPromise) return safetyDbPromise;
    safetyDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(SAFETY_DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('snapshots')) db.createObjectStore('snapshots');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开快照存储'));
    });
    return safetyDbPromise;
  }

  async function saveSnapshot(recordsData, resumeData) {
    try {
      const db = await openSafetyDb();
      const snapshot = {
        savedAt: new Date().toISOString(),
        records: recordsData,
        resume: resumeData
      };
      const key = `${snapshot.savedAt}-${cryptoId()}`;
      await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readwrite');
        tx.objectStore('snapshots').put(snapshot, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      updateSnapshotCount();
    } catch (e) {
      console.warn('快照保存失败', e);
    }
  }

  async function updateSnapshotCount() {
    try {
      const db = await openSafetyDb();
      const count = await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readonly');
        const req = tx.objectStore('snapshots').count();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      $('#snapshotCountText').textContent = `已自动保留 ${count} 个历史快照`;
    } catch (e) {
      $('#snapshotCountText').textContent = '未开启快照';
    }
  }

  // ================= 选项卡切换逻辑 =================
  const tabs = {
    'records-tab': { kicker: 'JOB TRACKING DASHBOARD', title: '投递追踪看板', subtitle: '全面监控网申进度、面试安排与全链路阶段流转', showActions: true },
    'resume-tab': { kicker: 'RESUME PROFILE MANAGER', title: '我的简历资料库', subtitle: '集中维护个人信息与多段经历，实时同步至网页端快速填报', showActions: false },
    'safety-tab': { kicker: 'LOCAL DATA & PRIVACY', title: '数据安全与备份', subtitle: '100% 浏览器本地存储保护，支持备份导出与快照回滚', showActions: false },
    'llm-tab': { kicker: 'AI JOB EXTRACTION', title: 'AI 解析配置', subtitle: '配置大模型接口，用 AI 从岗位 JD 中智能提取关键字段', showActions: false }
  };

  function switchTab(tabId) {
    $$('.sidebar-nav .nav-item').forEach(item => {
      const isActive = item.getAttribute('data-tab') === tabId;
      item.classList.toggle('is-active', isActive);
      if (isActive) item.setAttribute('aria-current', 'page');
      else item.removeAttribute('aria-current');
    });

    $$('.tab-content').forEach(content => {
      if (content.id === tabId) content.classList.add('is-active');
      else content.classList.remove('is-active');
    });

    const info = tabs[tabId];
    if (info) {
      $('#tabKicker').textContent = info.kicker;
      $('#tabTitle').textContent = info.title;
      $('#tabSubtitle').textContent = info.subtitle;
      $('#topActionsContainer').style.display = info.showActions ? 'flex' : 'none';
    }
  }

  $$('.sidebar-nav .nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const target = item.getAttribute('data-tab');
      switchTab(target);
    });
  });

  // 处理 URL Hash
  function handleUrlHash() {
    const hash = location.hash;
    if (hash === '#resume') switchTab('resume-tab');
    else if (hash === '#safety') switchTab('safety-tab');
    else if (hash === '#llm') switchTab('llm-tab');
    else switchTab('records-tab');
  }
  window.addEventListener('hashchange', handleUrlHash);

  // ================= TAB 1: 投递追踪核心逻辑 =================
  async function loadRecords() {
    const saved = await storageGet(RECORDS_STORAGE_KEY);
    // 只要本地已存在存储（即使是删除后的空数组 []），均直接读取，不再自动生成示例数据
    if (Array.isArray(saved)) {
      records = saved;
    } else {
      // 仅在首次全新安装/初始化（null 或 undefined）时载入初始示例
      records = getExampleRecords();
      await storageSet(RECORDS_STORAGE_KEY, records);
    }
    renderRecords();
  }

  async function saveRecords(msg) {
    await storageSet(RECORDS_STORAGE_KEY, records);
    saveSnapshot(records, currentResume);
    renderRecords();
    if (msg) showToast(msg);
  }

  function renderRecords() {
    const searchVal = $('#searchInput').value.trim().toLowerCase();
    const stageVal = $('#stageFilter').value;
    const sortVal = $('#sortSelect').value;

    // 过滤
    let filtered = records.filter(r => {
      if (!matchesPipelineFilter(r, pipelineFilter)) return false;
      if (stageVal && r.stage !== stageVal) return false;
      if (searchVal) {
        const text = `${r.company} ${r.position} ${r.city} ${r.nextAction} ${r.recentSchedule}`.toLowerCase();
        if (!text.includes(searchVal)) return false;
      }
      return true;
    });

    // 排序
    filtered.sort((a, b) => {
      if (sortVal === 'updatedAt_desc') return (b.updatedAt || 0) - (a.updatedAt || 0);
      if (sortVal === 'applicationDate_desc') return (b.applicationDate || '').localeCompare(a.applicationDate || '');
      if (sortVal === 'applicationDate_asc') return (a.applicationDate || '').localeCompare(b.applicationDate || '');
      if (sortVal === 'company_asc') return (a.company || '').localeCompare(b.company || '', 'zh-Hans-CN');
      return 0;
    });

    // 渲染统计指标
    $('#totalCount').textContent = records.length;
    const todayStr = new Date().toISOString().slice(0, 10);
    $('#todayCount').textContent = records.filter(r => (r.applicationDate === todayStr || (r.updatedAt && new Date(r.updatedAt).toISOString().slice(0,10) === todayStr))).length;
    $('#activeCount').textContent = records.filter(r => !['Offer', '简历挂', '已结束', '待投递'].includes(r.stage)).length;
    $('#weekCount').textContent = records.filter(r => r.scheduleAt && new Date(r.scheduleAt) >= new Date()).length;
    $('#offerCount').textContent = records.filter(r => r.stage === 'Offer').length;
    const scheduledCount = records.filter(r => isRecordUpcomingSchedule(r)).length;
    const pendingTodoCount = records.filter(r => isRecordPendingTodo(r)).length;
    const rhythmEl = $('#sidebarRhythm');
    if (rhythmEl) {
      rhythmEl.textContent = (scheduledCount || pendingTodoCount)
        ? `本周 ${scheduledCount} 场日程，${pendingTodoCount} 项待办待处理。优先处理标记的岗位。`
        : '本周暂无日程或待办，继续完善投递记录。';
    }

    // 渲染阶段漏斗
    const pipelineEl = $('#stagePipeline');
    const pipelineItems = [
      { filter: 'all', label: '全部', count: records.length },
      ...STAGES.map(stage => ({ filter: stage, label: stage, count: records.filter(r => r.stage === stage).length })),
      { filter: 'todo', label: '待办', count: records.filter(r => isRecordPendingTodo(r)).length }
    ];
    pipelineEl.innerHTML = pipelineItems.map(item => {
      const isSelected = pipelineFilter === item.filter;
      const isTodo = item.filter === 'todo' ? ' stage-pill--todo' : '';
      return `
        <button type="button" class="stage-pill${isTodo}${isSelected ? ' is-selected' : ''}" data-filter="${escapeHtml(item.filter)}" aria-pressed="${isSelected}" aria-label="${escapeHtml(item.label)}，${item.count} 条记录">
          <span class="stage-pill-title">${escapeHtml(item.label)}</span>
          <span class="stage-pill-val">${item.count}</span>
        </button>
      `;
    }).join('');

    // 绑定漏斗点击筛选
    pipelineEl.querySelectorAll('.stage-pill[data-filter]').forEach(pill => {
      pill.addEventListener('click', () => {
        const nextFilter = pill.getAttribute('data-filter');
        pipelineFilter = pipelineFilter === nextFilter ? 'all' : nextFilter;
        $('#stageFilter').value = STAGES.includes(pipelineFilter) ? pipelineFilter : '';
        renderRecords();
      });
    });

    // 渲染表格内容
    const tbody = $('#recordsTbody');
    const emptyEl = $('#recordsEmptyState');

    if (filtered.length === 0) {
      tbody.innerHTML = '';
      emptyEl.classList.remove('hidden');
    } else {
      emptyEl.classList.add('hidden');
      tbody.innerHTML = filtered.map(r => {
        const url = r.applicationUrl || r.url || '';
        const hasUrl = /^https?:\/\//i.test(url);
        const todoPending = isRecordPendingTodo(r);
        const compHtml = hasUrl
          ? `<a class="comp-name comp-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="点击跳转至网申/招聘原链接: ${escapeHtml(url)}">${escapeHtml(r.company)} <span class="link-icon" aria-hidden="true">↗</span></a>`
          : `<span class="comp-name">${escapeHtml(r.company)}</span>`;

        return `
        <tr>
          <td>
            <div class="comp-cell">
              ${compHtml}
              <span class="comp-pos">${escapeHtml(r.position)}</span>
            </div>
          </td>
          <td>${escapeHtml(r.city || '-')}</td>
          <td>${r.applicationDate || '-'}</td>
          <td>
            <span class="stage-tag stage-${r.stage}">${r.stage}</span>
          </td>
          <td>
            <div>${escapeHtml(r.recentSchedule || '-')}</div>
            ${r.nextAction ? `<div style="font-size:11px;color:var(--muted)">👉 ${escapeHtml(r.nextAction)}</div>` : ''}
          </td>
          <td class="text-right">
            <div class="table-actions">
              <button type="button" class="btn-sm btn-todo" data-id="${r.id}" ${todoPending ? 'disabled aria-disabled="true"' : ''}>${todoPending ? '已待办' : '待办'}</button>
              <button type="button" class="btn-sm btn-advance" data-id="${r.id}" title="推进到下一阶段">推进</button>
              <button type="button" class="btn-sm btn-edit" data-id="${r.id}">编辑</button>
              <button type="button" class="btn-sm btn-danger btn-del" data-id="${r.id}">删除</button>
            </div>
          </td>
        </tr>
      `;
      }).join('');
    }

    // 渲染右侧近期待办列表
    renderUpcoming();
  }

  function renderUpcoming() {
    const listEl = $('#upcomingList');
    const upcoming = records
      .filter(r => isRecordVisibleUpcoming(r))
      .sort(compareUpcomingRecords);

    if (upcoming.length === 0) {
      listEl.innerHTML = `<p style="font-size:12px;color:var(--muted);text-align:center;padding:12px 0;">近期暂无待办或日程安排</p>`;
      return;
    }

    listEl.innerHTML = upcoming.slice(0, 5).map(r => {
      const url = r.applicationUrl || r.url || '';
      const hasUrl = /^https?:\/\//i.test(url);
      const isTodo = isRecordPendingTodo(r);
      const todoTime = r.scheduleAt
        ? r.scheduleAt.replace('T', ' ')
        : (r.todoCreatedAt ? `添加于 ${new Date(r.todoCreatedAt).toLocaleString('zh-CN', { hour12: false })}` : '待办');
      const titleHtml = hasUrl
        ? `<a class="schedule-item-title comp-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="点击跳转至网申/招聘原链接: ${escapeHtml(url)}">${escapeHtml(r.company)} · ${escapeHtml(r.recentSchedule || r.position || '待办')} <span class="link-icon" aria-hidden="true">↗</span></a>`
        : `<span class="schedule-item-title">${escapeHtml(r.company)} · ${escapeHtml(r.recentSchedule || r.position || '待办')}</span>`;

      return `
      <article class="schedule-item">
        <span class="schedule-item-time">${escapeHtml(todoTime)}</span>
        ${titleHtml}
        ${r.nextAction ? `<span class="schedule-item-desc">${escapeHtml(r.nextAction)}</span>` : ''}
        ${isTodo ? `<div class="schedule-item-actions">
          <button type="button" class="schedule-action schedule-action-cancel" data-action="todo-cancel" data-id="${r.id}" aria-label="取消 ${escapeHtml(r.company)} 的待办">取消</button>
          <button type="button" class="schedule-action schedule-action-complete" data-action="todo-complete" data-id="${r.id}" aria-label="完成 ${escapeHtml(r.company)} 的待办">完成待办</button>
        </div>` : ''}
      </article>
    `;
    }).join('');
  }

  function escapeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // 搜索与过滤事件绑定
  $('#searchInput').addEventListener('input', renderRecords);
  $('#stageFilter').addEventListener('change', () => {
    pipelineFilter = $('#stageFilter').value || 'all';
    renderRecords();
  });
  $('#sortSelect').addEventListener('change', renderRecords);
  $('#refreshDashboardBtn').addEventListener('click', async () => {
    await loadRecords();
    await updateSnapshotCount();
    showToast('投递追踪看板已刷新');
  });

  // 表格操作委托
  $('#recordsTbody').addEventListener('click', (e) => {
    const actionButton = e.target.closest('button[data-id]');
    const id = actionButton?.getAttribute('data-id');
    if (!id) return;

    if (actionButton.classList.contains('btn-todo')) {
      void addTodo(id);
    } else if (actionButton.classList.contains('btn-advance')) {
      advanceStage(id);
    } else if (actionButton.classList.contains('btn-edit')) {
      openEditModal(id);
    } else if (actionButton.classList.contains('btn-del')) {
      deleteRecord(id);
    }
  });

  $('#upcomingList').addEventListener('click', (e) => {
    const actionButton = e.target.closest('button[data-action][data-id]');
    if (!actionButton) return;
    const id = actionButton.getAttribute('data-id');
    if (actionButton.dataset.action === 'todo-cancel') void cancelTodo(id);
    if (actionButton.dataset.action === 'todo-complete') void completeTodo(id);
  });

  function findButtonByRecordId(container, id, selector) {
    return Array.from(container.querySelectorAll(selector)).find(button => button.dataset.id === id);
  }

  function restoreFocusAfterTodoRemoval(id) {
    const recordTodoButton = findButtonByRecordId($('#recordsTbody'), id, 'button.btn-todo[data-id]');
    const nextTodoAction = $('#upcomingList button[data-action]');
    (recordTodoButton || nextTodoAction || $('#searchInput'))?.focus();
  }

  async function addTodo(id) {
    const idx = records.findIndex(r => r.id === id);
    const record = records[idx];
    if (!record || isRecordPendingTodo(record)) return;
    records[idx] = transitionRecordTodo(record, TODO_STATUS.PENDING);
    await saveRecords(`${record.company} 已加入待办`);
    findButtonByRecordId($('#upcomingList'), id, 'button[data-action="todo-cancel"][data-id]')?.focus();
  }

  async function cancelTodo(id) {
    const idx = records.findIndex(r => r.id === id);
    const record = records[idx];
    if (!record || !isRecordPendingTodo(record)) return;
    records[idx] = transitionRecordTodo(record, TODO_STATUS.CANCELLED);
    await saveRecords(`已取消 ${record.company} 的待办`);
    restoreFocusAfterTodoRemoval(id);
  }

  async function completeTodo(id) {
    const idx = records.findIndex(r => r.id === id);
    const record = records[idx];
    if (!record || !isRecordPendingTodo(record)) return;
    records[idx] = transitionRecordTodo(record, TODO_STATUS.COMPLETED);
    await saveRecords(`${record.company} 的待办已完成`);
    restoreFocusAfterTodoRemoval(id);
  }

  function advanceStage(id) {
    const record = records.find(r => r.id === id);
    if (!record) return;
    const curIdx = STAGE_ADVANCE_ORDER.indexOf(record.stage);
    if (curIdx >= 0 && curIdx < STAGE_ADVANCE_ORDER.length - 1) {
      record.stage = STAGE_ADVANCE_ORDER[curIdx + 1];
      record.updatedAt = Date.now();
      saveRecords(`🚀 ${record.company} 阶段已推进至「${record.stage}」`);
    }
  }

  function deleteRecord(id) {
    const record = records.find(r => r.id === id);
    if (!record) return;
    if (confirm(`确定要删除 ${record.company} - ${record.position} 的投递记录吗？`)) {
      records = records.filter(r => r.id !== id);
      saveRecords('已删除投递记录');
    }
  }

  // ================= 投递记录表单弹窗 =================
  const recordModal = $('#recordModal');
  $('#addRecordBtn').addEventListener('click', () => {
    editingRecordId = null;
    $('#modalTitle').textContent = '新增投递记录';
    $('#editRecordId').value = '';
    $('#m-company').value = '';
    $('#m-position').value = '';
    $('#m-city').value = '';
    $('#m-date').value = new Date().toISOString().slice(0, 10);
    $('#m-stage').value = '已投递';
    $('#m-url').value = '';
    $('#m-scheduleAt').value = '';
    $('#m-recentSchedule').value = '';
    $('#m-nextAction').value = '';
    $('#m-jobDescription').value = '';
    $('#m-jobRequirements').value = '';
    recordModal.showModal();
  });

  function openEditModal(id) {
    const record = records.find(r => r.id === id);
    if (!record) return;
    editingRecordId = id;
    $('#modalTitle').textContent = '编辑投递记录';
    $('#editRecordId').value = id;
    $('#m-company').value = record.company || '';
    $('#m-position').value = record.position || '';
    $('#m-city').value = record.city || '';
    $('#m-date').value = record.applicationDate || '';
    $('#m-stage').value = record.stage || '已投递';
    $('#m-url').value = record.applicationUrl || '';
    $('#m-scheduleAt').value = record.scheduleAt || '';
    $('#m-recentSchedule').value = record.recentSchedule || '';
    $('#m-nextAction').value = record.nextAction || '';
    $('#m-jobDescription').value = record.jobDescription || '';
    $('#m-jobRequirements').value = record.jobRequirements || '';
    recordModal.showModal();
  }

  $('#closeModalBtn').addEventListener('click', () => recordModal.close());
  $('#cancelModalBtn').addEventListener('click', () => recordModal.close());

  $('#recordForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      company: $('#m-company').value.trim(),
      position: $('#m-position').value.trim(),
      city: $('#m-city').value.trim(),
      applicationDate: $('#m-date').value,
      stage: $('#m-stage').value,
      applicationUrl: $('#m-url').value.trim(),
      scheduleAt: $('#m-scheduleAt').value,
      recentSchedule: $('#m-recentSchedule').value.trim(),
      nextAction: $('#m-nextAction').value.trim(),
      jobDescription: $('#m-jobDescription').value.trim(),
      jobRequirements: $('#m-jobRequirements').value.trim(),
      updatedAt: Date.now()
    };

    if (editingRecordId) {
      const idx = records.findIndex(r => r.id === editingRecordId);
      if (idx !== -1) {
        records[idx] = { ...records[idx], ...data };
      }
    } else {
      records.unshift({ id: cryptoId(), ...data });
    }

    recordModal.close();
    saveRecords(editingRecordId ? '记录修改成功' : '新增记录成功');
  });

  // ================= TAB 2: 简历资料库管理核心逻辑 =================
  async function loadResume() {
    const saved = await storageGet(RESUME_STORAGE_KEY);
    if (saved && typeof saved === 'object') {
      currentResume = saved;
    } else {
      currentResume = DEFAULT_RESUME;
      await storageSet(RESUME_STORAGE_KEY, currentResume);
    }
    renderResumeEditor();
  }

  function renderResumeEditor() {
    // 渲染 KV 区域：优先信息、基本信息、竞赛与技能
    ['优先信息', '基本信息', '竞赛与技能'].forEach(sec => {
      const container = $(`#kv-${sec}`);
      if (!container) return;
      const data = currentResume[sec] || {};
      container.innerHTML = Object.entries(data).map(([k, v]) => `
        <div class="kv-row" data-section="${sec}">
          <input type="text" class="kv-key" value="${escapeHtml(k)}" placeholder="字段名称">
          <input type="text" class="kv-val" value="${escapeHtml(v)}" placeholder="内容值">
          <button type="button" class="kv-del-btn" data-action="del-kv" title="删除字段">✕</button>
        </div>
      `).join('');
    });

    // 渲染经历列表：教育经历、实习经历、项目经历
    ['教育经历', '实习经历', '项目经历'].forEach(sec => {
      const container = $(`#exp-${sec}`);
      if (!container) return;
      const list = Array.isArray(currentResume[sec]) ? currentResume[sec] : [];
      container.innerHTML = list.map((item, idx) => `
        <div class="exp-item-card" data-section="${sec}" data-index="${idx}">
          <div class="exp-item-header">
            <h4>#${idx + 1} ${escapeHtml(item._rowName || '经历')}</h4>
            <div>
              <button type="button" class="btn-sm btn-danger" data-action="del-exp">删除此条</button>
            </div>
          </div>
          <div class="exp-fields-grid">
            <div class="form-item">
              <label>经历标签 (_rowName)</label>
              <input type="text" class="exp-field" data-key="_rowName" value="${escapeHtml(item._rowName || '')}" placeholder="例如：硕士 / 腾讯">
            </div>
            ${Object.entries(item).filter(([k]) => k !== '_rowName').map(([k, v]) => {
              const isLongText = ['主要工作', '岗位职责', '自我评价', '项目职责'].includes(k);
              return `
                <div class="form-item ${isLongText ? 'full-w' : ''}">
                  <label>${escapeHtml(k)}</label>
                  ${isLongText 
                    ? `<textarea class="exp-field" data-key="${escapeHtml(k)}" rows="3">${escapeHtml(v)}</textarea>`
                    : `<input type="text" class="exp-field" data-key="${escapeHtml(k)}" value="${escapeHtml(v)}">`
                  }
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `).join('');
    });
  }

  // 添加 KV 字段函数
  function addKvField(sec) {
    const container = $(`#kv-${sec}`);
    if (!container) return;
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.setAttribute('data-section', sec);
    row.innerHTML = `
      <input type="text" class="kv-key" placeholder="新字段名称">
      <input type="text" class="kv-val" placeholder="内容值">
      <button type="button" class="kv-del-btn" data-action="del-kv" title="删除字段">✕</button>
    `;
    container.appendChild(row);
    const keyInput = row.querySelector('.kv-key');
    if (keyInput) keyInput.focus();
  }

  // 添加经历行卡片函数
  function addExperienceRow(sec) {
    const container = $(`#exp-${sec}`);
    if (!container) return;
    const card = document.createElement('div');
    card.className = 'exp-item-card';
    card.setAttribute('data-section', sec);

    let defaultFields = [];
    if (sec === '教育经历') {
      defaultFields = [
        { k: '_rowName', label: '经历标签', val: '本/硕' },
        { k: '学校', label: '学校', val: '' },
        { k: '学院', label: '学院', val: '' },
        { k: '专业', label: '专业', val: '' },
        { k: '学历', label: '学历', val: '本科/硕士' },
        { k: '开始时间', label: '开始时间', val: '2023-09' },
        { k: '结束时间', label: '结束时间', val: '2026-06' }
      ];
    } else if (sec === '实习经历') {
      defaultFields = [
        { k: '_rowName', label: '经历标签', val: '实习单位简写' },
        { k: '单位', label: '单位全称', val: '' },
        { k: '部门', label: '部门', val: '' },
        { k: '岗位', label: '岗位名称', val: '' },
        { k: '开始', label: '开始时间', val: '2025-06' },
        { k: '结束', label: '结束时间', val: '至今' },
        { k: '岗位职责', label: '岗位职责 (长文本)', val: '', isTextarea: true }
      ];
    } else if (sec === '项目经历') {
      defaultFields = [
        { k: '_rowName', label: '经历标签', val: '项目简称' },
        { k: '项目名称', label: '项目全称', val: '' },
        { k: '角色', label: '担任角色', val: '核心负责人' },
        { k: '开始', label: '开始时间', val: '2024-09' },
        { k: '结束', label: '结束时间', val: '至今' },
        { k: '主要工作', label: '主要工作 (长文本)', val: '', isTextarea: true }
      ];
    }

    const currentCount = container.querySelectorAll('.exp-item-card').length + 1;

    card.innerHTML = `
      <div class="exp-item-header">
        <h4>#${currentCount} 新增经历</h4>
        <button type="button" class="btn-sm btn-danger" data-action="del-exp">删除此条</button>
      </div>
      <div class="exp-fields-grid">
        ${defaultFields.map(f => `
          <div class="form-item ${f.isTextarea ? 'full-w' : ''}">
            <label>${f.label}</label>
            ${f.isTextarea
              ? `<textarea class="exp-field" data-key="${f.k}" rows="3" placeholder="详细描述..."></textarea>`
              : `<input type="text" class="exp-field" data-key="${f.k}" value="${f.val}" placeholder="填写内容...">`
            }
          </div>
        `).join('')}
      </div>
    `;
    container.appendChild(card);
    const firstInput = card.querySelector('.exp-field');
    if (firstInput) firstInput.focus();
  }

  // 挂载到 window 供多场景访问
  window.addKvField = addKvField;
  window.addExperienceRow = addExperienceRow;

  // 全局事件委托：绑定简历资料库全部动态按钮事件 (彻底规避 Chrome CSP 限制)
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    const sec = btn.getAttribute('data-section');

    if (action === 'add-kv') {
      e.preventDefault();
      addKvField(sec);
      showToast(`已在「${sec}」中添加新字段`);
    } else if (action === 'add-exp') {
      e.preventDefault();
      addExperienceRow(sec);
      showToast(`已在「${sec}」中添加新经历`);
    } else if (action === 'del-kv') {
      e.preventDefault();
      const row = btn.closest('.kv-row');
      if (row) {
        row.remove();
        showToast('已删除该字段');
      }
    } else if (action === 'del-exp') {
      e.preventDefault();
      const card = btn.closest('.exp-item-card');
      if (card) {
        const parent = card.parentElement;
        card.remove();
        // 重新排序标题编号
        if (parent) {
          parent.querySelectorAll('.exp-item-card').forEach((c, idx) => {
            const h4 = c.querySelector('.exp-item-header h4');
            const tag = c.querySelector('.exp-field[data-key="_rowName"]')?.value || '经历';
            if (h4) h4.textContent = `#${idx + 1} ${tag}`;
          });
        }
        showToast('已删除该段经历');
      }
    }
  });

  // 从 DOM 收集并保存简历数据
  async function collectAndSaveResume() {
    const updated = {};

    // 收集 KV
    ['优先信息', '基本信息', '竞赛与技能'].forEach(sec => {
      updated[sec] = {};
      const rows = $$(`#kv-${sec} .kv-row`);
      rows.forEach(r => {
        const k = r.querySelector('.kv-key').value.trim();
        const v = r.querySelector('.kv-val').value.trim();
        if (k) updated[sec][k] = v;
      });
    });

    // 收集经历
    ['教育经历', '实习经历', '项目经历'].forEach(sec => {
      updated[sec] = [];
      const cards = $$(`#exp-${sec} .exp-item-card`);
      cards.forEach(card => {
        const item = {};
        const fields = card.querySelectorAll('.exp-field');
        fields.forEach(f => {
          const k = f.getAttribute('data-key');
          if (k) item[k] = f.value.trim();
        });
        if (Object.keys(item).length > 0) {
          updated[sec].push(item);
        }
      });
    });

    const ordered = {};
    [
      ...RESUME_SECTION_ORDER,
      ...Object.keys(updated).filter(sectionName => !RESUME_SECTION_ORDER.includes(sectionName))
    ].forEach(sectionName => {
      if (Object.prototype.hasOwnProperty.call(updated, sectionName)) ordered[sectionName] = updated[sectionName];
    });

    currentResume = ordered;
    await storageSet(RESUME_STORAGE_KEY, currentResume);
    saveSnapshot(records, currentResume);
    showToast('🎉 简历资料库已保存！所有网页侧边栏已实时同步');
  }

  $('#saveAllResumeBtn').addEventListener('click', collectAndSaveResume);

  // 导出简历 JSON
  $('#resumeExportJsonBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(currentResume, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `resume_profile_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('简历 JSON 已导出');
  });

  // 导入简历 JSON
  $('#resumeImportJsonBtn').addEventListener('click', () => $('#resumeFileInput').click());
  $('#resumeFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        if (parsed && typeof parsed === 'object') {
          currentResume = parsed;
          await storageSet(RESUME_STORAGE_KEY, currentResume);
          renderResumeEditor();
          showToast('✅ 简历已成功导入并同步！');
        }
      } catch (err) {
        alert('导入失败：不是有效的 JSON 文件');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // 重置简历为示例
  $('#resumeResetSeedBtn').addEventListener('click', async () => {
    if (confirm('确定要重置简历为默认示例数据吗？')) {
      currentResume = DEFAULT_RESUME;
      await storageSet(RESUME_STORAGE_KEY, currentResume);
      renderResumeEditor();
      showToast('已重置为示例简历');
    }
  });

  // ================= TAB 3: 数据安全与备份 =================
  function downloadFullBackup() {
    const envelope = {
      schemaVersion: 2,
      appVersion: APP_VERSION,
      savedAt: new Date().toISOString(),
      recordCount: records.length,
      records: records,
      resume: currentResume
    };
    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autumn_assistant_backup_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('完整备份文件已下载');
  }

  $('#exportDataBtn').addEventListener('click', downloadFullBackup);
  $('#exportFullBackupBtn').addEventListener('click', downloadFullBackup);

  // ================= 投递记录 Excel 导出 =================
  const excelExportModal = $('#excelExportModal');
  const excelExportStartDate = $('#excelExportStartDate');
  const excelExportEndDate = $('#excelExportEndDate');
  const excelExportStage = $('#excelExportStage');
  const excelExportCount = $('#excelExportCount');

  function recordsForExcelExport() {
    const startDate = excelExportStartDate.value;
    const endDate = excelExportEndDate.value;
    const stage = excelExportStage.value;
    return records.filter(record => {
      const date = record.applicationDate || '';
      return (!startDate || (date && date >= startDate))
        && (!endDate || (date && date <= endDate))
        && (!stage || record.stage === stage);
    }).sort((a, b) => (b.applicationDate || '').localeCompare(a.applicationDate || ''));
  }

  function refreshExcelExportCount() {
    excelExportCount.textContent = `将导出 ${recordsForExcelExport().length} 条投递记录`;
  }

  function setExcelExportFullDateRange() {
    const dates = records.map(record => record.applicationDate || '')
      .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date))
      .sort();
    excelExportStartDate.value = dates[0] || '';
    excelExportEndDate.value = dates[dates.length - 1] || '';
  }

  function escapeXml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
  }

  function excelColumnName(index) {
    let name = '';
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
    }
    return name;
  }

  function crc32(bytes) {
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
    return (crc ^ -1) >>> 0;
  }

  function zipStoredFiles(files) {
    const encoder = new TextEncoder();
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const set16 = (view, position, value) => view.setUint16(position, value, true);
    const set32 = (view, position, value) => view.setUint32(position, value, true);

    files.forEach(({ name, content }) => {
      const nameBytes = encoder.encode(name);
      const data = encoder.encode(content);
      const crc = crc32(data);
      const local = new Uint8Array(30 + nameBytes.length + data.length);
      const localView = new DataView(local.buffer);
      set32(localView, 0, 0x04034b50);
      set16(localView, 4, 20);
      set16(localView, 6, 0x0800);
      set16(localView, 8, 0);
      set32(localView, 14, crc);
      set32(localView, 18, data.length);
      set32(localView, 22, data.length);
      set16(localView, 26, nameBytes.length);
      local.set(nameBytes, 30);
      local.set(data, 30 + nameBytes.length);
      localParts.push(local);

      const central = new Uint8Array(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      set32(centralView, 0, 0x02014b50);
      set16(centralView, 4, 20);
      set16(centralView, 6, 20);
      set16(centralView, 8, 0x0800);
      set16(centralView, 10, 0);
      set32(centralView, 16, crc);
      set32(centralView, 20, data.length);
      set32(centralView, 24, data.length);
      set16(centralView, 28, nameBytes.length);
      set32(centralView, 42, offset);
      central.set(nameBytes, 46);
      centralParts.push(central);
      offset += local.length;
    });

    const centralSize = centralParts.reduce((size, part) => size + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    set32(endView, 0, 0x06054b50);
    set16(endView, 8, files.length);
    set16(endView, 10, files.length);
    set32(endView, 12, centralSize);
    set32(endView, 16, offset);
    return new Blob([...localParts, ...centralParts, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function createRecordsXlsx(exportRecords) {
    const headers = ['公司', '投递岗位', '城市', '投递日期', '当前阶段', '最近日程', '日程时间', '下一步行动', '网申链接', '职位描述', '职位要求', '最近更新'];
    const rows = exportRecords.map(record => [
      record.company, record.position, record.city, record.applicationDate, record.stage,
      record.recentSchedule, record.scheduleAt ? record.scheduleAt.replace('T', ' ') : '', record.nextAction,
      record.applicationUrl || record.url, record.jobDescription, record.jobRequirements,
      record.updatedAt ? new Date(record.updatedAt).toLocaleString('zh-CN', { hour12: false }) : ''
    ]);
    const sheetRows = [headers, ...rows].map((row, rowIndex) => {
      const cells = row.map((value, columnIndex) => `<c r="${excelColumnName(columnIndex)}${rowIndex + 1}" t="inlineStr"${rowIndex === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join('');
    const widths = [22, 28, 14, 14, 12, 24, 20, 34, 42, 54, 54, 22]
      .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
    const generatedAt = new Date().toISOString();
    return zipStoredFiles([
      { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>' },
      { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="投递记录" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Microsoft YaHei"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF4F64EE"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>' },
      { name: 'xl/worksheets/sheet1.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${sheetRows}</sheetData><autoFilter ref="A1:L${Math.max(rows.length + 1, 1)}"/></worksheet>` },
      { name: 'docProps/core.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>秋招求职与简历助手</dc:creator><dc:title>投递记录导出</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:created></cp:coreProperties>` },
      { name: 'docProps/app.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>秋招求职与简历助手</Application></Properties>' }
    ]);
  }

  function exportRecordsToExcel() {
    const startDate = excelExportStartDate.value;
    const endDate = excelExportEndDate.value;
    if (startDate && endDate && startDate > endDate) {
      showToast('开始日期不能晚于结束日期');
      return;
    }
    const exportRecords = recordsForExcelExport();
    if (exportRecords.length === 0) {
      showToast('当前筛选条件下没有可导出的投递记录');
      return;
    }
    const blob = createRecordsXlsx(exportRecords);
    const range = `${startDate || '全部'}至${endDate || '全部'}`;
    const stage = excelExportStage.value || '全部阶段';
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `投递记录_${range}_${stage}.xlsx`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    excelExportModal.close();
    showToast(`已导出 ${exportRecords.length} 条投递记录`);
  }

  $('#openExcelExportModalBtn').addEventListener('click', () => {
    excelExportStage.value = $('#stageFilter').value;
    setExcelExportFullDateRange();
    refreshExcelExportCount();
    excelExportModal.showModal();
  });
  $('#closeExcelExportModalBtn').addEventListener('click', () => excelExportModal.close());
  $('#cancelExcelExportBtn').addEventListener('click', () => excelExportModal.close());
  [excelExportStartDate, excelExportEndDate, excelExportStage].forEach(control => control.addEventListener('change', refreshExcelExportCount));
  $('#excelExportForm').addEventListener('submit', event => {
    event.preventDefault();
    exportRecordsToExcel();
  });

  $('#importFullBackupBtn').addEventListener('click', () => $('#fullBackupFileInput').click());
  $('#fullBackupFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        let importedRecords = [];
        let importedResume = null;

        // 兼容原 autumn-recruitment-tracker 的 envelope 格式或纯数组
        if (Array.isArray(parsed)) {
          importedRecords = parsed;
        } else if (parsed && Array.isArray(parsed.records)) {
          importedRecords = parsed.records;
          if (parsed.resume) importedResume = parsed.resume;
        }

        if (importedRecords.length > 0) {
          records = importedRecords;
          await storageSet(RECORDS_STORAGE_KEY, records);
        }
        if (importedResume) {
          currentResume = importedResume;
          await storageSet(RESUME_STORAGE_KEY, currentResume);
        }

        saveSnapshot(records, currentResume);
        renderRecords();
        renderResumeEditor();
        showToast(`✅ 成功导入 ${importedRecords.length} 条投递记录！`);
      } catch (err) {
        alert('导入失败：文件损坏或格式不兼容');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  // 恢复上一快照
  $('#restoreLastSnapshotBtn').addEventListener('click', async () => {
    try {
      const db = await openSafetyDb();
      const keys = await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readonly');
        const req = tx.objectStore('snapshots').getAllKeys();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });

      if (keys.length < 2) {
        alert('暂无更早的历史快照可供恢复');
        return;
      }

      const prevKey = keys.sort()[keys.length - 2];
      const snapshot = await new Promise((resolve, reject) => {
        const tx = db.transaction('snapshots', 'readonly');
        const req = tx.objectStore('snapshots').get(prevKey);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });

      if (snapshot && Array.isArray(snapshot.records)) {
        records = snapshot.records;
        if (snapshot.resume) currentResume = snapshot.resume;
        await storageSet(RECORDS_STORAGE_KEY, records);
        await storageSet(RESUME_STORAGE_KEY, currentResume);
        renderRecords();
        renderResumeEditor();
        showToast(`已成功回滚至快照版本 (${snapshot.savedAt.slice(0, 16)})`);
      }
    } catch (e) {
      alert('快照恢复失败');
    }
  });

  // 清空所有数据
  $('#clearAllDataBtn').addEventListener('click', async () => {
    if (confirm('警告：确定要清空全部投递记录与简历配置吗？此操作不可逆！')) {
      records = [];
      await storageSet(RECORDS_STORAGE_KEY, records);
      renderRecords();
      showToast('已清空全部数据');
    }
  });

  // ================= 离线 OCR 截图识别逻辑 =================
  const ocrModal = $('#ocrModal');
  const ocrDropzone = $('#ocrDropzone');
  const ocrFileInput = $('#ocrFileInput');
  const ocrPreviewImg = $('#ocrPreviewImg');
  const ocrPrompt = $('#ocrPrompt');
  const startOcrBtn = $('#startOcrBtn');
  const ocrProgress = $('#ocrProgress');
  const ocrProgressInner = $('#ocrProgressInner');
  const ocrStatusText = $('#ocrStatusText');
  const ocrResultForm = $('#ocrResultForm');
  const saveOcrRecordBtn = $('#saveOcrRecordBtn');

  $('#openOcrModalBtn').addEventListener('click', () => {
    resetOcrModal();
    ocrModal.showModal();
  });
  $('#closeOcrModalBtn').addEventListener('click', () => ocrModal.close());
  $('#cancelOcrBtn').addEventListener('click', () => ocrModal.close());

  ocrDropzone.addEventListener('click', () => ocrFileInput.click());
  ocrFileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleOcrImage(e.target.files[0]);
    }
  });

  // 拖拽支持
  ocrDropzone.addEventListener('dragover', (e) => { e.preventDefault(); ocrDropzone.style.borderColor = 'var(--primary)'; });
  ocrDropzone.addEventListener('dragleave', () => { ocrDropzone.style.borderColor = '#cbd5e1'; });
  ocrDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    ocrDropzone.style.borderColor = '#cbd5e1';
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleOcrImage(e.dataTransfer.files[0]);
    }
  });

  // 粘贴剪贴板图片支持
  window.addEventListener('paste', (e) => {
    if (!ocrModal.open) return;
    const items = e.clipboardData?.items || [];
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) handleOcrImage(file);
        break;
      }
    }
  });

  function handleOcrImage(file) {
    ocrFile = file;
    const url = URL.createObjectURL(file);
    ocrPreviewImg.src = url;
    ocrPreviewImg.classList.remove('hidden');
    ocrPrompt.classList.add('hidden');
    startOcrBtn.disabled = false;
  }

  function resetOcrModal() {
    ocrFile = null;
    ocrPreviewImg.src = '';
    ocrPreviewImg.classList.add('hidden');
    ocrPrompt.classList.remove('hidden');
    startOcrBtn.disabled = true;
    startOcrBtn.classList.remove('hidden');
    ocrProgress.classList.add('hidden');
    ocrResultForm.classList.add('hidden');
    saveOcrRecordBtn.classList.add('hidden');
  }

  // ================= 离线 OCR 预热与识别核心 =================
  function openTesseractCache() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('keyval-store');
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('keyval')) {
          request.result.createObjectStore('keyval');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本地识别缓存数据库'));
    });
  }

  async function ensureChineseOcrModel() {
    if (!window.__OCR_CHI_SIM_GZIP_BASE64__) throw new Error('中文识别模型依赖缺失 (chi_sim-data.js 未加载)');
    const db = await openTesseractCache();
    const key = './chi_sim.traineddata';
    const exists = await new Promise((resolve, reject) => {
      const request = db.transaction('keyval', 'readonly').objectStore('keyval').get(key);
      request.onsuccess = () => resolve(typeof request.result !== 'undefined');
      request.onerror = () => reject(request.error);
    });
    if (!exists) {
      const raw = atob(window.__OCR_CHI_SIM_GZIP_BASE64__);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
      await new Promise((resolve, reject) => {
        const tx = db.transaction('keyval', 'readwrite');
        tx.objectStore('keyval').put(bytes, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('写入离线语言模型到 IndexedDB 失败'));
      });
    }
    db.close();
  }

  function describeOcrProgress(message) {
    const names = {
      'loading tesseract core': '正在加载本地识别引擎',
      'initializing tesseract': '正在初始化识别引擎',
      'loading language traineddata': '正在读取离线中文模型',
      'initializing api': '正在准备中文识别',
      'recognizing text': '正在识别截图文字'
    };
    const progress = Math.max(0, Math.min(1, Number(message.progress) || 0));
    ocrProgressInner.style.width = `${Math.round(progress * 100)}%`;
    ocrStatusText.textContent = `${names[message.status] || '正在识别'}… ${Math.round(progress * 100)}%`;
  }

  // 辅助函数：将任意格式图片文件转为标准 Canvas (填充白底保证 OCR 识别对比度)
  function loadImageToCanvas(file) {
    return new Promise((resolve, reject) => {
      if (!file) return reject(new Error('未选择有效图片'));
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const width = img.naturalWidth || img.width || 800;
          const height = img.naturalHeight || img.height || 600;
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          
          // 关键：PNG 截图透明通道处理，填充纯白底色确保 OCR 算法准确识别
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
          resolve({ canvas, dataUrl: e.target.result });
        };
        img.onerror = () => reject(new Error('图片格式无法解码，请上传常见 PNG 或 JPG 图片'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('读取图片文件失败'));
      reader.readAsDataURL(file);
    });
  }

  startOcrBtn.addEventListener('click', async () => {
    if (!ocrFile) return;
    startOcrBtn.disabled = true;
    ocrProgress.classList.remove('hidden');
    ocrProgressInner.style.width = '2%';
    ocrStatusText.textContent = '正在准备离线中文识别，首次可能需要几秒…';

    try {
      if (typeof window.Tesseract === 'undefined') {
        throw new Error('未加载本地 Tesseract OCR 引擎组件 (tesseract.min.js)');
      }

      // 1. 确保离线语言模型已注入 IndexedDB keyval-store
      await ensureChineseOcrModel();

      // 2. 转为标准白底 Canvas，消除透明通道与格式差异
      const { canvas } = await loadImageToCanvas(ocrFile);

      // 3. 构建本地相对/扩展绝对路径
      const ocrRoot = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getURL)
        ? chrome.runtime.getURL('ocr/')
        : new URL('./ocr/', location.href).href;

      // 4. 启动 Worker 并配置 cacheMethod: 'readOnly' 与 workerBlobURL: false (兼容 MV3 扩展沙箱)
      ocrWorker = await Tesseract.createWorker('chi_sim', 1, {
        workerPath: `${ocrRoot}worker.min.js`,
        corePath: `${ocrRoot}core`,
        langPath: `${ocrRoot}lang`,
        cacheMethod: 'readOnly',
        workerBlobURL: false,
        logger: describeOcrProgress
      });

      // 5. 执行识别
      const result = await ocrWorker.recognize(canvas);
      const text = result?.data?.text || '';
      await ocrWorker.terminate();
      ocrWorker = null;

      ocrProgressInner.style.width = '100%';
      ocrStatusText.textContent = '识别完成！';

      // 6. 智能正则提取字段
      const parsed = parseOcrText(text);
      $('#ocr-company').value = parsed.company;
      $('#ocr-position').value = parsed.position;
      $('#ocr-date').value = parsed.date;
      $('#ocr-stage').value = parsed.stage;

      ocrResultForm.classList.remove('hidden');
      startOcrBtn.classList.add('hidden');
      saveOcrRecordBtn.classList.remove('hidden');
    } catch (err) {
      console.error('OCR 识别失败', err);
      if (ocrWorker) {
        try { await ocrWorker.terminate(); } catch (_) {}
        ocrWorker = null;
      }
      alert(`识别失败：${err.message || '请检查图片清晰度或直接手动录入'}`);
      ocrProgress.classList.add('hidden');
      startOcrBtn.disabled = false;
    }
  });

  function cleanOcrCandidate(value, maxLength = 80) {
    return String(value || '')
      .replace(/^[\s:：|·•\-—]+|[\s:：|·•\-—]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .slice(0, maxLength);
  }

  function matchOcrLabel(text, labels, maxLength) {
    const labelGroup = labels.join('|');
    const match = text.match(new RegExp(`(?:${labelGroup})\\s*[:：]?\\s*([^\\n]{2,${maxLength}})`, 'i'));
    return cleanOcrCandidate(match?.[1], maxLength);
  }

  function parseOcrText(rawText) {
    const text = String(rawText || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
    const lines = text.split('\n').map(line => cleanOcrCandidate(line, 100)).filter(line => line.length >= 2);
    let company = matchOcrLabel(text, ['公司(?:名称)?', '企业(?:名称)?', '招聘单位', '应聘公司'], 60);
    let position = matchOcrLabel(text, ['投递岗位', '应聘岗位', '应聘职位', '岗位(?:名称)?', '职位(?:名称)?'], 80);
    if (!company) company = lines.find(line => /(?:公司|集团|科技|银行|证券|咨询|智能|互娱|网络|汽车|电子|传媒|研究院)/.test(line) && line.length <= 45) || '';
    if (!position) position = lines.find(line => /(?:工程师|经理|运营|设计师|分析师|顾问|开发|算法|产品|实习|管培生|专员|研究员)/.test(line) && line.length <= 60) || '';

    let stage = '已投递';
    if (/(?:offer|录用|已通过|已录取)/i.test(text)) stage = 'Offer';
    else if (/(?:简历挂|简历未通过|简历筛选未通过|简历淘汰)/i.test(text)) stage = '简历挂';
    else if (/(?:已结束|流程结束|不合适|未通过|淘汰|拒绝)/i.test(text)) stage = '已结束';
    else if (/(?:HR\s*面|人力面|人事面)/i.test(text)) stage = 'HR面';
    else if (/(?:二面|第二轮面试|复试)/i.test(text)) stage = '二面';
    else if (/(?:一面|第一轮面试|初面|面试中)/i.test(text)) stage = '一面';
    else if (/(?:测评|在线测试)/i.test(text)) stage = '已测评';
    else if (/笔试/i.test(text)) stage = '笔试';

    const labelled = text.match(/(?:投递|申请|提交)(?:日期|时间)?\s*[:：]?\s*(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?/);
    const generic = text.match(/(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})\s*日?/);
    const parts = labelled || generic;
    let date = new Date().toISOString().slice(0, 10);
    if (parts) {
      const month = String(Math.min(12, Math.max(1, Number(parts[2])))).padStart(2, '0');
      const day = String(Math.min(31, Math.max(1, Number(parts[3])))).padStart(2, '0');
      date = `${parts[1]}-${month}-${day}`;
    }

    return {
      company: cleanOcrCandidate(company, 60) || '识别公司',
      position: cleanOcrCandidate(position, 80) || '识别岗位',
      date,
      stage
    };
  }

  saveOcrRecordBtn.addEventListener('click', () => {
    const newRec = {
      id: cryptoId(),
      company: $('#ocr-company').value.trim() || '待确认公司',
      position: $('#ocr-position').value.trim() || '待确认岗位',
      city: '',
      applicationDate: $('#ocr-date').value || new Date().toISOString().slice(0, 10),
      stage: $('#ocr-stage').value,
      recentSchedule: '截图识别收录',
      nextAction: '核对岗位详情与跟进状态',
      updatedAt: Date.now()
    };
    records.unshift(newRec);
    saveRecords(`🎉 已收录: ${newRec.company} - ${newRec.position}`);
    ocrModal.close();
  });
  // ================= LLM 一键收录配置 =================
  const llmEnabledToggle = $('#llmEnabledToggle');
  const llmDisableThinkingToggle = $('#llmDisableThinkingToggle');
  const llmBaseUrl = $('#llmBaseUrl');
  const llmApiKey = $('#llmApiKey');
  const llmModel = $('#llmModel');
  const llmTestHint = $('#llmTestHint');

  async function loadLlmConfig() {
    const cfg = (await storageGet(LLM_STORAGE_KEY)) || {};
    llmEnabledToggle.checked = cfg.enabled === true;
    llmDisableThinkingToggle.checked = cfg.disableThinking !== false;
    llmBaseUrl.value = cfg.baseUrl || '';
    llmApiKey.value = cfg.apiKey || '';
    llmModel.value = cfg.model || '';
  }

  async function saveLlmConfig() {
    await storageSet(LLM_STORAGE_KEY, {
      enabled: llmEnabledToggle.checked,
      disableThinking: llmDisableThinkingToggle.checked,
      baseUrl: llmBaseUrl.value.trim(),
      apiKey: llmApiKey.value.trim(),
      model: llmModel.value.trim()
    });
    llmTestHint.textContent = '✅ 配置已保存。招聘页面点击「一键收录当前岗位」时将使用 AI 解析。';
    showToast('✅ AI 解析配置已保存');
  }

  function setLlmTestHint(text, isError = false) {
    llmTestHint.textContent = text;
    llmTestHint.style.color = isError ? '#ef4444' : '#166534';
  }

  $('#llmSaveBtn').addEventListener('click', saveLlmConfig);

  $('#llmTestBtn').addEventListener('click', async () => {
    await saveLlmConfig();
    setLlmTestHint('⏳ 正在测试连接...');
    const btn = $('#llmTestBtn');
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '测试中...';
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        const res = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'TEST_LLM' }, resolve));
        if (res && res.ok) setLlmTestHint('✅ 连接成功，模型可用。');
        else setLlmTestHint(`❌ 测试失败: ${res?.message || '未知错误'}`, true);
      } else {
        setLlmTestHint('⚠️ 需在扩展环境下测试', true);
      }
    } catch (err) {
      setLlmTestHint(`❌ 测试异常: ${err.message || err}`, true);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });

  llmEnabledToggle.addEventListener('change', () => {
    if (!llmEnabledToggle.checked) {
      setLlmTestHint('AI 解析已关闭，一键收录将使用本地规则识别。');
    } else {
      setLlmTestHint('提示：JD 文本将发送到你所填写的服务商用于解析，请确认配置正确。');
    }
  });

  const llmLogSummary = $('#llmLogSummary');
  const llmLogList = $('#llmLogList');
  const llmLogStatusLabels = {
    success: '成功',
    parse_error: 'JSON 解析失败',
    request_error: '请求失败',
    skipped: '未调用'
  };

  function createLogText(className, text) {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
  }

  function renderLlmLogs(logs) {
    const list = Array.isArray(logs) ? logs : [];
    llmLogList.replaceChildren();
    const successful = list.filter(log => log.ok).length;
    llmLogSummary.textContent = list.length
      ? `共 ${list.length} 条，成功 ${successful} 条，失败/跳过 ${list.length - successful} 条`
      : '暂无调用日志';

    if (!list.length) {
      llmLogList.appendChild(createLogText('llm-log-empty', '点击「一键收录」或「测试连接」后，调用记录会显示在这里。'));
      return;
    }

    list.forEach(log => {
      const entry = document.createElement('article');
      entry.className = `llm-log-entry ${log.status === 'skipped' ? 'is-skipped' : log.ok ? '' : 'is-error'}`;

      const main = document.createElement('div');
      main.className = 'llm-log-main';
      main.append(
        createLogText('', log.kind === 'test' ? '连接测试' : '岗位解析'),
        createLogText('llm-log-status', llmLogStatusLabels[log.status] || log.status || '未知状态'),
        createLogText('', log.at ? new Date(log.at).toLocaleString() : '无时间')
      );

      const meta = document.createElement('div');
      meta.className = 'llm-log-meta';
      meta.append(
        createLogText('', `模型：${log.model || '-'}`),
        createLogText('', `接口：${log.endpoint || '-'}`),
        createLogText('', `思考：${log.thinkingDisabled === undefined ? '-' : log.thinkingDisabled ? '已关闭' : '开启'}`),
        createLogText('', `总耗时：${log.totalMs ?? '-'} ms`),
        createLogText('', `API：${log.apiMs ?? '-'} ms`),
        createLogText('', `解析：${log.parseMs ?? '-'} ms`),
        createLogText('', `输入：${log.inputChars ?? '-'} 字符`),
        createLogText('', `输出：${log.outputChars ?? '-'} 字符`),
        createLogText('', `请求：${Array.isArray(log.attempts) ? log.attempts.length : 0} 次`)
      );

      entry.append(main, meta);
      if (log.clientTimings && Object.keys(log.clientTimings).length) {
        const client = document.createElement('div');
        client.className = 'llm-log-meta';
        client.textContent = `页面本地耗时：解析 ${log.clientTimings.localParseMs ?? '-'} ms · 读取配置 ${log.clientTimings.configReadMs ?? '-'} ms · 采集文本 ${log.clientTimings.textCollectMs ?? '-'} ms`;
        entry.appendChild(client);
      }
      (log.attempts || []).forEach(attempt => {
        const attemptEl = document.createElement('div');
        attemptEl.className = 'llm-log-attempt';
        attemptEl.textContent = `第 ${attempt.attempt} 次${attempt.jsonMode ? '（JSON mode）' : ''}：${attempt.ok ? '成功' : (attempt.error || '失败')} · ${attempt.durationMs ?? '-'} ms · HTTP ${attempt.status ?? '-'}`;
        entry.appendChild(attemptEl);
      });
      if (log.error) {
        entry.appendChild(createLogText('llm-log-error', `错误：${log.error}`));
      }
      llmLogList.appendChild(entry);
    });
  }

  async function loadLlmLogs() {
    renderLlmLogs((await storageGet(LLM_LOGS_STORAGE_KEY)) || []);
  }

  $('#refreshLlmLogsBtn').addEventListener('click', loadLlmLogs);
  $('#clearLlmLogsBtn').addEventListener('click', async () => {
    if (!window.confirm('确定清空全部 LLM 调用日志吗？')) return;
    await storageSet(LLM_LOGS_STORAGE_KEY, []);
    renderLlmLogs([]);
  });

  if (typeof chrome !== 'undefined' && chrome.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[LLM_LOGS_STORAGE_KEY]) {
        renderLlmLogs(changes[LLM_LOGS_STORAGE_KEY].newValue || []);
      }
    });
  }

  // ================= 初始化启动 =================
  async function init() {
    handleUrlHash();
    await loadRecords();
    await loadResume();
    await loadLlmConfig();
    await loadLlmLogs();
    updateSnapshotCount();
  }

  init();
})();
