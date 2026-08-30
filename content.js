/**
 * 简历投递与进度管理助手 - Content Script
 * 采用 Shadow DOM 隔离技术，保证与宿主网页样式 100% 零冲突
 */

(() => {
  'use strict';

  // 避免重复注入
  if (document.getElementById('autumn-job-assistant-host')) return;

  const RESUME_STORAGE_KEY = 'autumnRecruitmentTracker.resume.v1';
  const RECORDS_STORAGE_KEY = 'autumnRecruitmentTracker.records.v1';
  const SETTINGS_STORAGE_KEY = 'autumnRecruitmentTracker.settings.v1';

  // ================= 默认简历备用种子数据 =================
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
      "紧急联系人": "李华 (13900139000)",
      "自我评价": "具备扎实的AI技术认知与产品化落地经验，自驱力强，跨部门沟通流畅。"
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
        "导师": "张教授"
      },
      {
        "_rowName": "本科",
        "学校": "华东理工大学",
        "学院": "信息科学与工程学院",
        "专业": "软件工程",
        "学历": "本科",
        "开始时间": "2019-09",
        "结束时间": "2023-06"
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
        "岗位职责": "1. 主导智能广告生成 Agent 方案设计；\n2. 协同算法团队完成模型微调，CTR 提升 12.4%；\n3. 撰写多份高保真 PRD 与交互原型。"
      }
    ],
    "项目经历": [
      {
        "_rowName": "LLM Agent 平台",
        "项目名称": "基于大模型多智能体的自动化仿真与决策工作流平台",
        "角色": "核心负责人",
        "开始": "2024-09",
        "结束": "2025-05",
        "主要工作": "设计认知层-技能层解耦架构，结合动态 Prompt 编排实现端到端自动化测试。"
      }
    ],
    "竞赛与技能": {
      "英语水平": "CET-6 (598分)",
      "专业技能": "Python, SQL, Figma, Prompt Engineering, Agent Architecture"
    }
  };

  let currentResumeData = DEFAULT_RESUME;
  let lastFocusedEl = null;
  let lastSelectionStart = null;
  let lastSelectionEnd = null;

  function updateActiveSelection(el) {
    if (!el) return;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      lastFocusedEl = el;
      try {
        lastSelectionStart = el.selectionStart;
        lastSelectionEnd = el.selectionEnd;
      } catch (_) {}
    } else if (el.isContentEditable) {
      lastFocusedEl = el;
    }
  }

  // ================= 监听宿主页面聚焦与光标交互事件 =================
  document.addEventListener('focusin', (e) => updateActiveSelection(e.target), true);
  document.addEventListener('click', (e) => updateActiveSelection(e.target), true);
  document.addEventListener('keyup', (e) => updateActiveSelection(e.target), true);
  document.addEventListener('select', (e) => updateActiveSelection(e.target), true);

  // ================= 创建宿主容器与 Shadow Root =================
  const host = document.createElement('div');
  host.id = 'autumn-job-assistant-host';
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });

  // ================= 注入 Shadow DOM 核心样式 =================
  const style = document.createElement('style');
  style.textContent = `
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    
    /* 悬浮吸边胶囊按钮 */
    #aja-toggle {
      position: fixed;
      top: 180px;
      right: 0;
      z-index: 2147483646;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 12px 8px 10px;
      background: linear-gradient(135deg, #5367e9, #4053cb);
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-right: none;
      border-radius: 20px 0 0 20px;
      box-shadow: 0 4px 16px rgba(64, 83, 203, 0.35);
      cursor: pointer;
      user-select: none;
      transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }
    #aja-toggle:hover {
      padding-left: 14px;
      background: linear-gradient(135deg, #6275f0, #4c5fd6);
      box-shadow: 0 6px 20px rgba(64, 83, 203, 0.45);
    }
    #aja-toggle.hidden {
      display: none;
    }

    /* 侧边滑出抽屉面板 */
    #aja-drawer {
      position: fixed;
      top: 20px;
      right: 20px;
      bottom: 20px;
      width: 350px;
      max-height: calc(100vh - 40px);
      z-index: 2147483647;
      display: flex;
      flex-direction: column;
      background: rgba(255, 255, 255, 0.98);
      backdrop-filter: blur(16px);
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      box-shadow: 0 12px 40px rgba(15, 23, 42, 0.18);
      user-select: none;
      transition: transform 0.28s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s ease;
      transform: translateX(0);
      opacity: 1;
    }
    #aja-drawer.collapsed {
      transform: translateX(calc(100% + 30px));
      opacity: 0;
      pointer-events: none;
    }

    /* 顶部标题栏 */
    .drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 14px;
      background: linear-gradient(135deg, #4f64ee, #3d51cc);
      color: #fff;
      border-radius: 15px 15px 0 0;
      cursor: move;
    }
    .brand-area {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .brand-icon {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      background: rgba(255, 255, 255, 0.2);
      border-radius: 6px;
      font-size: 14px;
    }
    .brand-title {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 0.3px;
    }
    .shortcut-badge {
      font-size: 10px;
      background: rgba(255, 255, 255, 0.22);
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: normal;
      color: #e0e7ff;
    }
    .close-btn {
      background: none;
      border: none;
      color: #fff;
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 2px 6px;
      border-radius: 4px;
      opacity: 0.8;
      transition: opacity 0.15s;
    }
    .close-btn:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.2);
    }

    /* 抽屉内容滚动区域 */
    .drawer-body {
      flex: 1;
      overflow-y: auto;
      padding: 10px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }
    .drawer-body::-webkit-scrollbar {
      width: 5px;
    }
    .drawer-body::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }

    /* 一键收录卡片 */
    .capture-card {
      background: linear-gradient(145deg, #f0f4ff, #e6edff);
      border: 1px solid #c7d7fe;
      border-radius: 12px;
      padding: 10px;
    }
    .capture-btn {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      background: #5367e9;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 650;
      cursor: pointer;
      transition: background 0.15s, transform 0.1s;
    }
    .capture-btn:hover {
      background: #4053cb;
      transform: translateY(-1px);
    }
    .capture-btn:active {
      transform: translateY(0);
    }

    /* 快速微调确认表单 */
    .capture-form {
      display: none;
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px dashed #bfdbfe;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .capture-form.hidden {
      display: none;
    }
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .form-group label {
      font-size: 11px;
      font-weight: 600;
      color: #475569;
    }
    .form-group input, .form-group select {
      padding: 5px 8px;
      font-size: 12px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: #fff;
      color: #1e293b;
      outline: none;
    }
    .form-group input:focus, .form-group select:focus {
      border-color: #5367e9;
      box-shadow: 0 0 0 2px rgba(83, 103, 233, 0.15);
    }
    .form-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .form-actions {
      display: flex;
      gap: 6px;
      margin-top: 4px;
    }
    .btn-save-record {
      flex: 1;
      padding: 6px;
      background: #24a475;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
    }
    .btn-save-record:hover {
      background: #1e8b63;
    }
    .btn-cancel-capture {
      padding: 6px 10px;
      background: #f1f5f9;
      color: #64748b;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      font-size: 12px;
      cursor: pointer;
    }
    .btn-cancel-capture:hover {
      background: #e2e8f0;
    }

    /* 简历模块手风琴折叠 */
    .resume-section {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: #fff;
      overflow: hidden;
    }
    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 10px;
      background: #f8fafc;
      font-size: 12px;
      font-weight: 700;
      color: #334155;
      cursor: pointer;
      transition: background 0.15s;
    }
    .section-header:hover {
      background: #f1f5f9;
    }
    .section-arrow {
      font-size: 10px;
      transition: transform 0.2s;
      color: #94a3b8;
    }
    .resume-section.collapsed .section-arrow {
      transform: rotate(-90deg);
    }
    .section-content {
      padding: 6px 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .resume-section.collapsed .section-content {
      display: none;
    }

    /* 经历行卡片 */
    .exp-row {
      background: #f8fafc;
      border: 1px solid #f1f5f9;
      border-radius: 6px;
      padding: 6px;
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .exp-row-title {
      width: 100%;
      font-size: 11px;
      font-weight: 700;
      color: #4f64ee;
      margin-bottom: 2px;
      border-bottom: 1px dashed #e2e8f0;
      padding-bottom: 2px;
    }

    /* 填充数据字段按钮 */
    .field-btn {
      display: inline-flex;
      align-items: center;
      padding: 4px 7px;
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      color: #1e293b;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.12s;
      max-width: 100%;
      text-align: left;
    }
    .field-btn:hover {
      background: #eff6ff;
      border-color: #93c5fd;
      color: #1d4ed8;
      transform: translateY(-1px);
    }
    .field-btn:active {
      background: #dbeafe;
      transform: translateY(0);
    }
    .field-key {
      color: #64748b;
      font-size: 10px;
      margin-right: 4px;
      white-space: nowrap;
    }
    .field-key::after {
      content: ':';
    }
    .field-val {
      font-weight: 550;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 190px;
    }

    /* 抽屉底部快捷操作 */
    .drawer-footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 12px;
      background: #f8fafc;
      border-top: 1px solid #e2e8f0;
      border-radius: 0 0 15px 15px;
    }
    .footer-btn {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 5px;
      padding: 7px 10px;
      font-size: 12px;
      font-weight: 600;
      border-radius: 8px;
      border: 1px solid #cbd5e1;
      background: #fff;
      color: #334155;
      cursor: pointer;
      transition: all 0.15s;
    }
    .footer-btn:hover {
      background: #eff6ff;
      border-color: #93c5fd;
      color: #4f64ee;
    }

    /* 提示 Toast */
    .aja-toast {
      position: absolute;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: #fff;
      padding: 7px 14px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      box-shadow: 0 4px 14px rgba(0,0,0,0.2);
      pointer-events: none;
      z-index: 999;
      animation: fadeIn .2s ease;
      white-space: nowrap;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translate(-50%, -6px); }
      to { opacity: 1; transform: translate(-50%, 0); }
    }
  `;
  shadow.appendChild(style);

  // ================= 构建 DOM 结构 =================
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    <div id="aja-toggle" title="展开投递助手 (Ctrl+Shift+F)">
      <span>📝</span>
      <span>投递助手</span>
    </div>

    <div id="aja-drawer" class="collapsed">
      <div class="drawer-header" id="aja-drag-handle">
        <div class="brand-area">
          <div class="brand-icon">🚀</div>
          <div class="brand-title">秋招求职助手</div>
          <span class="shortcut-badge">Ctrl+Shift+F</span>
        </div>
        <button class="close-btn" id="aja-close-btn" title="收起面板">✕</button>
      </div>

      <div class="drawer-body">
        <!-- 一键收录岗位卡片 -->
        <div class="capture-card">
          <button class="capture-btn" id="aja-scan-btn">
            <span>📌</span>
            <span>一键收录当前岗位</span>
          </button>
          
          <div class="capture-form hidden" id="aja-capture-form">
            <div class="form-group">
              <label>公司名称</label>
              <input type="text" id="cap-company" placeholder="例如：字节跳动">
            </div>
            <div class="form-group">
              <label>投递岗位</label>
              <input type="text" id="cap-position" placeholder="例如：AI产品经理">
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>目标城市</label>
                <input type="text" id="cap-city" placeholder="例如：北京">
              </div>
              <div class="form-group">
                <label>投递阶段</label>
                <select id="cap-stage">
                  <option value="已投递">已投递</option>
                  <option value="待投递">待投递</option>
                  <option value="笔试">笔试</option>
                  <option value="一面">一面</option>
                  <option value="二面">二面</option>
                  <option value="HR面">HR面</option>
                  <option value="Offer">Offer</option>
                  <option value="已结束">已结束</option>
                </select>
              </div>
            </div>
            <div class="form-group">
              <label>投递日期</label>
              <input type="date" id="cap-date">
            </div>
            <div class="form-actions">
              <button class="btn-save-record" id="cap-save-btn">✓ 确认存入看板</button>
              <button class="btn-cancel-capture" id="cap-cancel-btn">收起</button>
            </div>
          </div>
        </div>

        <!-- 简历资料库分类展示 -->
        <div id="aja-resume-list"></div>
      </div>

      <!-- 底部中枢入口 -->
      <div class="drawer-footer">
        <button class="footer-btn" id="aja-open-records-btn">
          <span>📊</span>
          <span>投递看板</span>
        </button>
        <button class="footer-btn" id="aja-open-resume-btn">
          <span>⚙️</span>
          <span>简历配置</span>
        </button>
      </div>
    </div>
  `;
  shadow.appendChild(wrapper);

  // ================= 获取 DOM 元素 =================
  const toggleBtn = shadow.getElementById('aja-toggle');
  toggleBtn.classList.add('hidden');
  const drawer = shadow.getElementById('aja-drawer');
  const closeBtn = shadow.getElementById('aja-close-btn');
  const dragHandle = shadow.getElementById('aja-drag-handle');
  const scanBtn = shadow.getElementById('aja-scan-btn');
  const captureForm = shadow.getElementById('aja-capture-form');
  const capCompany = shadow.getElementById('cap-company');
  const capPosition = shadow.getElementById('cap-position');
  const capCity = shadow.getElementById('cap-city');
  const capStage = shadow.getElementById('cap-stage');
  const capDate = shadow.getElementById('cap-date');
  const capSaveBtn = shadow.getElementById('cap-save-btn');
  const capCancelBtn = shadow.getElementById('cap-cancel-btn');
  const resumeListEl = shadow.getElementById('aja-resume-list');
  const openRecordsBtn = shadow.getElementById('aja-open-records-btn');
  const openResumeBtn = shadow.getElementById('aja-open-resume-btn');

  // ================= 渲染简历模块 =================
  function renderResumeSections(resume) {
    if (!resume || typeof resume !== 'object') return;
    let html = '';

    for (const [sectionName, sectionData] of Object.entries(resume)) {
      if (!sectionData) continue;
      const isDefaultOpen = sectionName === '优先信息';
      const collapsedClass = isDefaultOpen ? '' : 'collapsed';

      html += `
        <div class="resume-section ${collapsedClass}">
          <div class="section-header">
            <span>${sectionName}</span>
            <span class="section-arrow">▼</span>
          </div>
          <div class="section-content">
      `;

      if (Array.isArray(sectionData)) {
        // 多段经历（如教育经历、实习、项目经历）
        sectionData.forEach(item => {
          html += `<div class="exp-row">`;
          if (item._rowName) {
            html += `<div class="exp-row-title">👉 ${item._rowName}</div>`;
          }
          for (const [k, v] of Object.entries(item)) {
            if (k.startsWith('_') || v === undefined || v === null || v === '') continue;
            const strVal = String(v);
            html += `
              <button class="field-btn" data-val="${encodeURIComponent(strVal)}" title="${k}: ${strVal.replace(/"/g, '&quot;')}">
                <span class="field-key">${k}</span>
                <span class="field-val">${strVal}</span>
              </button>
            `;
          }
          html += `</div>`;
        });
      } else if (typeof sectionData === 'object') {
        // 普通对象模块（如基本信息、优先信息）
        html += `<div class="exp-row">`;
        for (const [k, v] of Object.entries(sectionData)) {
          if (v === undefined || v === null || v === '') continue;
          const strVal = String(v);
          html += `
            <button class="field-btn" data-val="${encodeURIComponent(strVal)}" title="${k}: ${strVal.replace(/"/g, '&quot;')}">
              <span class="field-key">${k}</span>
              <span class="field-val">${strVal}</span>
            </button>
          `;
        }
        html += `</div>`;
      }

      html += `</div></div>`;
    }

    resumeListEl.innerHTML = html;
  }

  // ================= 从 storage 加载最新简历 =================
  async function loadResumeData() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const res = await chrome.storage.local.get([RESUME_STORAGE_KEY]);
        if (res[RESUME_STORAGE_KEY]) {
          currentResumeData = res[RESUME_STORAGE_KEY];
        }
      }
    } catch (e) {
      console.warn('读取扩展存储失败，使用默认简历', e);
    }
    renderResumeSections(currentResumeData);
  }
  loadResumeData();

  // 监听 storage 变化（当用户在看板页面修改了简历，网页端实时刷新）
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes[RESUME_STORAGE_KEY]) {
        currentResumeData = changes[RESUME_STORAGE_KEY].newValue || DEFAULT_RESUME;
        renderResumeSections(currentResumeData);
      }
    });
  }

  // ================= 页面收录与 DOM 解析算法 =================
  function extractPageJobData() {
    function flatten(value, output = []) {
      if (!value) return output;
      if (Array.isArray(value)) value.forEach(item => flatten(item, output));
      else if (typeof value === 'object') {
        output.push(value);
        if (value['@graph']) flatten(value['@graph'], output);
      }
      return output;
    }

    const jsonObjects = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(node => {
      try { flatten(JSON.parse(node.textContent), jsonObjects); } catch (_) {}
    });

    const job = jsonObjects.find(item => {
      const type = item && item['@type'];
      return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
    }) || {};

    const meta = name => document.querySelector(`meta[property="${name}"],meta[name="${name}"]`)?.content?.trim() || '';
    const firstText = selectors => {
      for (const selector of selectors) {
        const el = document.querySelector(selector);
        const value = el?.textContent?.trim();
        if (value && value.length < 120 && !el.closest('#autumn-job-assistant-host')) return value;
      }
      return '';
    };

    const org = typeof job.hiringOrganization === 'string' ? job.hiringOrganization : job.hiringOrganization?.name;
    const locations = Array.isArray(job.jobLocation) ? job.jobLocation : [job.jobLocation].filter(Boolean);
    let city = locations.map(loc => {
      const address = loc?.address || loc;
      return [address?.addressLocality, address?.addressRegion].filter(Boolean).join(' ');
    }).filter(Boolean).join(' / ');

    const rawTitle = job.title || firstText(['h1', '[class*="job-title"]', '[class*="jobTitle"]', '[class*="position"]']) || meta('og:title') || document.title;
    const rawCompany = org || firstText(['[data-testid*="company"]', '[class*="company-name"]', '[class*="companyName"]', '[class*="company_title"]']) || meta('og:site_name');
    const pageText = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 50000);

    // 城市推断
    if (!city) {
      const cities = ['北京','上海','广州','深圳','杭州','南京','苏州','成都','重庆','武汉','西安','长沙','天津','厦门','合肥','郑州','青岛','济南','宁波','无锡','珠海','佛山','东莞','福州','昆明','南昌','大连','沈阳','哈尔滨','香港','澳门'];
      city = cities.find(c => (rawTitle + ' ' + document.title + ' ' + pageText.slice(0, 3000)).includes(c)) || '';
    }

    // 状态推断
    let stage = '已投递';
    if (/offer|录用|待入职/i.test(pageText)) stage = 'Offer';
    else if (/不合适|未通过|已拒绝|流程结束|招聘结束|已关闭/.test(pageText)) stage = '已结束';
    else if (/HR面|hr面|人事面/i.test(pageText)) stage = 'HR面';
    else if (/二面|第二轮|复试/.test(pageText)) stage = '二面';
    else if (/一面|初面|第一轮/.test(pageText)) stage = '一面';
    else if (/笔试|测评/.test(pageText)) stage = '笔试';

    // 日期推断
    const dateMatch = pageText.match(/(?:投递|申请)(?:时间|日期)?\s*[:：]?\s*(20\d{2})[.\/年-](\d{1,2})[.\/月-](\d{1,2})日?/);
    let applicationDate = dateMatch ? `${dateMatch[1]}-${dateMatch[2].padStart(2, '0')}-${dateMatch[3].padStart(2, '0')}` : new Date().toISOString().slice(0, 10);

    // 清理岗位与公司名称
    let position = rawTitle.replace(/\s[-_|｜·]\s|招聘职位|职位详情|校园招聘/g, ' ').trim().split(/\s+/)[0] || '待确认岗位';
    let company = rawCompany;
    if (!company || /BOSS直聘|猎聘|智联招聘|前程无忧|拉勾|牛客|实习僧|应届生求职网/i.test(company)) {
      const parts = document.title.split(/[_|｜·-]/).map(p => p.trim()).filter(Boolean);
      company = parts.find(p => p !== position && !/招聘|职位|BOSS|猎聘|智联|前程|拉勾|牛客|实习僧/.test(p)) || '待确认公司';
    }

    return {
      company: company.slice(0, 50),
      position: position.slice(0, 60),
      city: city.slice(0, 30),
      stage,
      applicationDate,
      applicationUrl: location.href
    };
  }

  // ================= 交互事件绑定 =================
  let isCollapsed = true;
  let capsuleEnabled = true;

  function applyCapsuleVisibility() {
    toggleBtn.classList.toggle('hidden', !capsuleEnabled || !isCollapsed);
  }

  async function loadCapsuleSetting() {
    try {
      const res = await chrome.storage.local.get([SETTINGS_STORAGE_KEY]);
      capsuleEnabled = res[SETTINGS_STORAGE_KEY]?.capsuleEnabled !== false;
    } catch (_) {
      capsuleEnabled = true;
    }
    applyCapsuleVisibility();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_STORAGE_KEY]) {
      capsuleEnabled = changes[SETTINGS_STORAGE_KEY].newValue?.capsuleEnabled !== false;
      applyCapsuleVisibility();
    }
  });

  function toggleDrawer(open) {
    isCollapsed = typeof open === 'boolean' ? !open : !isCollapsed;
    if (isCollapsed) {
      drawer.classList.add('collapsed');
    } else {
      drawer.classList.remove('collapsed');
    }
    applyCapsuleVisibility();
  }

  loadCapsuleSetting();

  toggleBtn.addEventListener('click', () => toggleDrawer(true));
  closeBtn.addEventListener('click', () => toggleDrawer(false));

  // 快捷键 Ctrl+Shift+F
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
      e.preventDefault();
      toggleDrawer();
    }
  });

  // 手风琴折叠交互
  resumeListEl.addEventListener('click', (e) => {
    const headerEl = e.target.closest('.section-header');
    if (headerEl) {
      const sec = headerEl.closest('.resume-section');
      sec.classList.toggle('collapsed');
    }
  });

  // 点击字段按钮 -> 光标处插入/追加 + 剪贴板兜底
  resumeListEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.field-btn');
    if (!btn) return;

    const rawVal = btn.getAttribute('data-val');
    if (!rawVal) return;
    const value = decodeURIComponent(rawVal);

    // 剪贴板兜底
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(value).catch(err => console.warn('剪贴板写入异常', err));
    }

    const targetEl = lastFocusedEl;
    if (targetEl && document.contains(targetEl)) {
      try {
        if (targetEl instanceof HTMLInputElement || targetEl instanceof HTMLTextAreaElement) {
          const prevVal = targetEl.value || '';
          
          // 获取当前光标位置（如选区存在则替换选区，如无选区则直接在光标处插入）
          let start = (typeof targetEl.selectionStart === 'number' && targetEl.selectionStart >= 0)
            ? targetEl.selectionStart
            : ((typeof lastSelectionStart === 'number' && lastSelectionStart >= 0) ? lastSelectionStart : prevVal.length);
            
          let end = (typeof targetEl.selectionEnd === 'number' && targetEl.selectionEnd >= 0)
            ? targetEl.selectionEnd
            : ((typeof lastSelectionEnd === 'number' && lastSelectionEnd >= 0) ? lastSelectionEnd : start);

          if (start > prevVal.length) start = prevVal.length;
          if (end > prevVal.length) end = prevVal.length;

          // 拼接新值
          const newVal = prevVal.slice(0, start) + value + prevVal.slice(end);

          const proto = (targetEl instanceof HTMLTextAreaElement) ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
          if (setter) {
            setter.call(targetEl, newVal);
          } else {
            targetEl.value = newVal;
          }

          // 触发 input 与 change 事件通知网页端框架 (Vue/React/Angular)
          targetEl.dispatchEvent(new Event('input', { bubbles: true }));
          targetEl.dispatchEvent(new Event('change', { bubbles: true }));

          // 将光标定位在新插入内容的末尾并聚焦
          targetEl.focus();
          const nextCursorPos = start + value.length;
          try {
            targetEl.setSelectionRange(nextCursorPos, nextCursorPos);
            lastSelectionStart = nextCursorPos;
            lastSelectionEnd = nextCursorPos;
          } catch (_) {}

          showToast(`已插入: ${value.slice(0, 12)}${value.length > 12 ? '...' : ''}`);
        } else if (targetEl.isContentEditable) {
          targetEl.focus();
          document.execCommand('insertText', false, value);
          showToast(`已插入: ${value.slice(0, 12)}${value.length > 12 ? '...' : ''}`);
        } else {
          showToast(`已复制到剪贴板，请在表单中粘贴`);
        }
      } catch (err) {
        console.warn('插入文本异常', err);
        showToast(`已复制到剪贴板，请手动粘贴`);
      }
    } else {
      showToast(`已复制到剪贴板，请在表单中粘贴`);
    }
  });

  // 一键提取岗位并展示微调表单
  scanBtn.addEventListener('click', () => {
    const detected = extractPageJobData();
    capCompany.value = detected.company;
    capPosition.value = detected.position;
    capCity.value = detected.city;
    capStage.value = detected.stage;
    capDate.value = detected.applicationDate;
    captureForm.classList.remove('hidden');
  });

  capCancelBtn.addEventListener('click', () => {
    captureForm.classList.add('hidden');
  });

  // 保存投递记录
  capSaveBtn.addEventListener('click', async () => {
    const record = {
      company: capCompany.value.trim() || '待确认公司',
      position: capPosition.value.trim() || '待确认岗位',
      city: capCity.value.trim(),
      stage: capStage.value,
      applicationDate: capDate.value || new Date().toISOString().slice(0, 10),
      applicationUrl: location.href,
      recentSchedule: '已完成网申投递',
      nextAction: '关注招聘动态与邮件通知'
    };

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'SAVE_JOB_RECORD', record }, (res) => {
        if (res && res.ok) {
          showToast(`🎉 已收录: ${record.company} - ${record.position}`);
          captureForm.classList.add('hidden');
        } else {
          showToast(`保存失败: ${res?.message || '未知错误'}`);
        }
      });
    } else {
      showToast('扩展连接不可用');
    }
  });

  // 底部直达中枢按钮
  openRecordsBtn.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', targetHash: '#records' });
    }
  });

  openResumeBtn.addEventListener('click', () => {
    if (typeof chrome !== 'undefined' && chrome.runtime) {
      chrome.runtime.sendMessage({ type: 'OPEN_DASHBOARD', targetHash: '#resume' });
    }
  });

  // Toast 消息函数
  let toastTimer = null;
  function showToast(msg) {
    const existing = shadow.querySelector('.aja-toast');
    if (existing) existing.remove();
    if (toastTimer) clearTimeout(toastTimer);

    const t = document.createElement('div');
    t.className = 'aja-toast';
    t.textContent = msg;
    shadow.appendChild(t);

    toastTimer = setTimeout(() => {
      t.remove();
    }, 2000);
  }

  // 悬浮胶囊垂直拖拽定位
  let isDraggingToggle = false;
  let toggleStartY = 0;
  let toggleStartTop = 0;

  toggleBtn.addEventListener('mousedown', (e) => {
    isDraggingToggle = true;
    toggleStartY = e.clientY;
    toggleStartTop = toggleBtn.getBoundingClientRect().top;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingToggle) return;
    const dy = e.clientY - toggleStartY;
    const newTop = Math.min(Math.max(20, toggleStartTop + dy), window.innerHeight - 60);
    toggleBtn.style.top = `${newTop}px`;
  });

  document.addEventListener('mouseup', () => {
    isDraggingToggle = false;
  });

  console.log('🚀 [简历投递与进度管理助手] Shadow DOM 侧边栏已挂载。按 Ctrl+Shift+F 唤起。');
})();
