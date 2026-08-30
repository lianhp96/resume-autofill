/*
 * 一键填入 P0 的共享逻辑。
 * 这个文件不保存候选人资料值到页面，也不联网；页面脚本和看板共用它的
 * 版本化资料模型与表单填入能力。
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'autumnRecruitmentTracker.candidateProfile.v1';
  const REPORT_STORAGE_KEY = 'autumnRecruitmentTracker.autofillReport.v1';
  const SCHEMA_VERSION = 1;
  const EMPTY_PROFILE = {
    schemaVersion: SCHEMA_VERSION,
    personal: { firstName: '', lastName: '', fullName: '', phone: '', email: '', city: '' },
    links: { github: '', portfolio: '', linkedin: '' },
    education: [{ school: '', major: '', degree: '', graduationDate: '' }],
    preferences: { targetRole: '', targetCity: '' },
    answers: {}
  };

  const FIELD_ALIASES = {
    'personal.fullName': ['姓名', '中文姓名', '真实姓名', 'full name', 'legal name'],
    'personal.firstName': ['名字', 'first name', 'given name'],
    'personal.lastName': ['姓氏', 'last name', 'family name', 'surname'],
    'personal.phone': ['手机', '手机号', '联系电话', '联系电话号码', '电话', 'mobile', 'phone', 'tel'],
    'personal.email': ['邮箱', '电子邮箱', '电子邮件', 'email', 'e-mail', 'mail address'],
    'personal.city': ['现居地', '所在城市', '居住城市', '当前城市', 'current city', 'city of residence'],
    'links.github': ['github', 'github链接', 'github主页'],
    'links.portfolio': ['个人主页', '个人网站', '作品集', 'portfolio', 'personal website', 'website'],
    'links.linkedin': ['linkedin', '领英'],
    'education.0.school': ['学校', '毕业院校', '院校', '大学', 'school', 'university', 'college'],
    'education.0.major': ['专业', '所学专业', 'major', 'field of study'],
    'education.0.degree': ['学历', '学位', 'degree', 'education level'],
    'education.0.graduationDate': ['毕业时间', '毕业日期', '预计毕业', 'graduation date', 'graduation'],
    'preferences.targetRole': ['期望职位', '目标岗位', '求职意向', 'desired role', 'target role'],
    'preferences.targetCity': ['期望城市', '目标城市', '期望工作地点', 'desired location', 'target city']
  };
  const SENSITIVE_RE = /password|passwd|验证码|验证s*码|captcha|verification\s*code|one[\s-]?time\s*code|otp|身份证|证件号|护照|passport|social\s*security|ssn|民族|种族|race|宗教|religion|性别认同|gender\s*identity|残疾|disability|退伍|veteran|eeo|平等就业|合法工作|work\s*authorization|sponsor(ship)?|犯罪|criminal|background\s*check/i;
  const SKIP_INPUT_TYPES = new Set(['hidden', 'password', 'file', 'submit', 'button', 'reset', 'image', 'search']);

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function stringValue(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function normalizeText(value) { return stringValue(value).toLowerCase().replace(/[\s\-_.:/\\()[\]{}，,。！？!?；;：'"“”‘’]/g, ''); }
  function escapeCss(value) { return (window.CSS && CSS.escape) ? CSS.escape(value) : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'); }

  function normalizeProfile(raw) {
    const profile = clone(EMPTY_PROFILE);
    if (!raw || typeof raw !== 'object') return profile;
    ['personal', 'links', 'preferences'].forEach(section => {
      if (raw[section] && typeof raw[section] === 'object') {
        Object.keys(profile[section]).forEach(key => { profile[section][key] = stringValue(raw[section][key]); });
      }
    });
    const education = Array.isArray(raw.education) && raw.education[0] && typeof raw.education[0] === 'object' ? raw.education[0] : {};
    profile.education[0] = {
      school: stringValue(education.school),
      major: stringValue(education.major),
      degree: stringValue(education.degree),
      graduationDate: stringValue(education.graduationDate)
    };
    if (raw.answers && typeof raw.answers === 'object' && !Array.isArray(raw.answers)) {
      Object.entries(raw.answers).forEach(([key, value]) => {
        if (typeof value === 'string' || typeof value === 'boolean') profile.answers[stringValue(key)] = value;
      });
    }
    return profile;
  }

  async function getProfile() {
    const data = await chrome.storage.local.get([STORAGE_KEY]);
    return normalizeProfile(data[STORAGE_KEY]);
  }

  async function saveProfile(profile) {
    const normalized = normalizeProfile(profile);
    await chrome.storage.local.set({ [STORAGE_KEY]: normalized });
    return normalized;
  }

  async function clearProfile() {
    await chrome.storage.local.remove(STORAGE_KEY);
    return clone(EMPTY_PROFILE);
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0' && el.getClientRects().length > 0;
  }

  function associatedLabel(el) {
    const labels = el.labels ? Array.from(el.labels) : [];
    const byFor = el.id ? Array.from(document.querySelectorAll(`label[for="${escapeCss(el.id)}"]`)) : [];
    const wrapped = el.closest('label');
    return [...labels, ...byFor, wrapped].filter(Boolean).map(label => label.innerText || label.textContent || '').join(' ');
  }

  function ariaText(el) {
    const labelledBy = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || '').join(' ');
    return [el.getAttribute('aria-label'), labelledBy].filter(Boolean).join(' ');
  }

  function nearbyText(el) {
    const container = el.closest('[role="group"], .form-group, .form-item, .field, .form-field, li, td') || el.parentElement;
    return container ? (container.innerText || container.textContent || '').slice(0, 300) : '';
  }

  function fieldText(el) {
    return [associatedLabel(el), ariaText(el), el.placeholder, el.name, el.id, el.autocomplete, nearbyText(el)].filter(Boolean).join(' ');
  }

  function directFieldText(el) {
    return [associatedLabel(el), ariaText(el), el.placeholder, el.name, el.id, el.autocomplete].filter(Boolean).join(' ');
  }

  function controlKind(el) {
    if (el instanceof HTMLTextAreaElement) return 'textarea';
    if (el instanceof HTMLSelectElement) return 'select';
    const type = (el.type || 'text').toLowerCase();
    if (type === 'radio' || type === 'checkbox') return type;
    return 'input';
  }

  function shouldSkip(el, text) {
    if (!isVisible(el) || el.disabled || el.readOnly) return 'unavailable';
    if (el.closest('#autumn-job-assistant-host')) return 'assistant_ui';
    if (el instanceof HTMLInputElement && SKIP_INPUT_TYPES.has((el.type || 'text').toLowerCase())) return 'unsafe_control';
    if ((el.autocomplete || '').toLowerCase() === 'one-time-code' || SENSITIVE_RE.test(text)) return 'sensitive';
    return '';
  }

  function hasExistingValue(el) {
    if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) return el.checked;
    return stringValue(el.value) !== '';
  }

  function scanPage() {
    const controls = Array.from(document.querySelectorAll('input, textarea, select'));
    return controls.map((el, index) => {
      const text = fieldText(el);
      const kind = controlKind(el);
      return {
        el, index, kind, text, normalizedText: normalizeText(text),
        normalizedDirectText: normalizeText(directFieldText(el)),
        optionText: normalizeText(`${associatedLabel(el)} ${el.value || ''}`),
        label: stringValue(associatedLabel(el) || el.getAttribute('aria-label') || el.placeholder || el.name || el.id),
        options: el instanceof HTMLSelectElement ? Array.from(el.options).map(option => ({ value: option.value, text: option.textContent.trim() })) : [],
        required: el.required || el.getAttribute('aria-required') === 'true',
        existing: hasExistingValue(el),
        skipReason: shouldSkip(el, text)
      };
    });
  }

  function resolveProfileValue(profile, key) {
    const [section, child, field] = key.split('.');
    if (section === 'education') return stringValue(profile.education?.[Number(child)]?.[field]);
    return stringValue(profile[section]?.[child]);
  }

  function matchField(field, profile) {
    if (field.skipReason) return { status: 'skipped', reason: field.skipReason };
    // 仅直接绑定到控件的标签、ARIA 和属性可触发高置信度自动填写。
    // 父容器文本只用于识别敏感问题及用户明确保存的问答上下文。
    const text = field.normalizedDirectText;
    const candidates = Object.entries(FIELD_ALIASES).map(([key, aliases]) => {
      const matchingAlias = aliases.map(normalizeText).find(alias => alias && (text === alias || text.includes(alias)));
      return matchingAlias ? { key, alias: matchingAlias, value: resolveProfileValue(profile, key) } : null;
    }).filter(Boolean).filter(candidate => candidate.value);
    if (candidates.length) {
      candidates.sort((a, b) => b.alias.length - a.alias.length);
      const winner = candidates[0];
      return { status: 'matched', key: winner.key, value: winner.value, confidence: 'high', reason: `匹配到 ${winner.key}` };
    }
    const answerKey = Object.keys(profile.answers || {}).find(key => {
      const normalizedKey = normalizeText(key);
      return normalizedKey && (field.normalizedText === normalizedKey || field.normalizedText.includes(normalizedKey));
    });
    if (answerKey && !SENSITIVE_RE.test(field.text)) {
      return { status: 'matched', key: `answers.${answerKey}`, value: profile.answers[answerKey], confidence: 'high', reason: '匹配到用户保存的常用问答' };
    }
    return { status: 'pending', reason: '未找到高置信度资料字段' };
  }

  function dispatchFieldEvents(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  }

  function writeField(field, match) {
    const { el, kind } = field;
    if (kind === 'input' || kind === 'textarea') {
      if (el instanceof HTMLInputElement && el.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(match.value))) {
        return { status: 'pending', reason: '日期资料不是 YYYY-MM-DD 格式' };
      }
      setNativeValue(el, String(match.value));
      dispatchFieldEvents(el);
      return stringValue(el.value) === stringValue(match.value)
        ? { status: 'filled', reason: match.reason } : { status: 'failed', reason: '写入后核验失败' };
    }
    if (kind === 'select') {
      const expected = normalizeText(match.value);
      const option = Array.from(el.options).find(item => normalizeText(item.value) === expected || normalizeText(item.textContent) === expected);
      if (!option) return { status: 'pending', reason: '资料值与下拉选项不一致' };
      el.value = option.value;
      dispatchFieldEvents(el);
      return el.value === option.value ? { status: 'filled', reason: match.reason } : { status: 'failed', reason: '写入后核验失败' };
    }
    if (kind === 'checkbox') {
      if (typeof match.value !== 'boolean') return { status: 'pending', reason: '复选框仅接受明确的 true / false 常用问答' };
      el.checked = match.value;
      dispatchFieldEvents(el);
      return el.checked === match.value ? { status: 'filled', reason: match.reason } : { status: 'failed', reason: '写入后核验失败' };
    }
    if (kind === 'radio') {
      if (typeof match.value !== 'string') return { status: 'pending', reason: '单选项仅接受明确的文本常用问答' };
      const target = normalizeText(match.value);
      if (!target || !field.optionText.includes(target)) return { status: 'skipped', reason: '同组中未选中的单选项' };
      el.checked = true;
      dispatchFieldEvents(el);
      return el.checked ? { status: 'filled', reason: match.reason } : { status: 'failed', reason: '写入后核验失败' };
    }
    return { status: 'pending', reason: '不支持的控件类型' };
  }

  function ensureHighlightStyle() {
    if (document.getElementById('aja-autofill-highlight-style')) return;
    const style = document.createElement('style');
    style.id = 'aja-autofill-highlight-style';
    style.textContent = '[data-aja-autofill-state="filled"] { outline: 2px solid #10b981 !important; outline-offset: 2px !important; } [data-aja-autofill-state="attention"] { outline: 2px solid #f59e0b !important; outline-offset: 2px !important; }';
    (document.head || document.documentElement).appendChild(style);
  }

  function markField(el, state) {
    if (!el) return;
    ensureHighlightStyle();
    el.setAttribute('data-aja-autofill-state', state);
  }

  function summarize(items) {
    return items.reduce((summary, item) => {
      if (item.status === 'filled') summary.filled += 1;
      else if (item.status === 'skipped') summary.skipped += 1;
      else summary.pending += 1;
      return summary;
    }, { filled: 0, pending: 0, skipped: 0 });
  }

  async function fillPage() {
    const profile = await getProfile();
    const scanned = scanPage();
    const items = scanned.map(field => {
      const base = { label: field.label || `字段 ${field.index + 1}`, kind: field.kind };
      if (field.existing && !field.skipReason) return { ...base, status: 'skipped', reason: '已有用户输入，未覆盖' };
      const match = matchField(field, profile);
      if (match.status !== 'matched') {
        if (match.status === 'pending' && !field.skipReason) markField(field.el, 'attention');
        return { ...base, status: match.status, reason: match.reason, key: match.key || '' };
      }
      if (field.kind === 'radio' || field.kind === 'checkbox') {
        const result = writeField(field, match);
        if (result.status === 'filled') markField(field.el, 'filled');
        else if (result.status !== 'skipped') markField(field.el, 'attention');
        return { ...base, ...result, key: match.key };
      }
      const result = writeField(field, match);
      if (result.status === 'filled') markField(field.el, 'filled');
      else if (result.status !== 'skipped') markField(field.el, 'attention');
      return { ...base, ...result, key: match.key };
    });
    const report = { version: 1, url: location.href, title: document.title, createdAt: Date.now(), summary: summarize(items), items };
    await chrome.storage.local.set({ [REPORT_STORAGE_KEY]: report });
    return report;
  }

  function formatSummary(report) {
    const summary = report?.summary || { filled: 0, pending: 0, skipped: 0 };
    return `已填入 ${summary.filled} 项 · 待确认 ${summary.pending} 项 · 跳过 ${summary.skipped} 项`;
  }

  globalThis.AutumnAutofill = {
    STORAGE_KEY, REPORT_STORAGE_KEY, SCHEMA_VERSION, EMPTY_PROFILE: clone(EMPTY_PROFILE),
    normalizeProfile, getProfile, saveProfile, clearProfile, scanPage, fillPage, formatSummary
  };
})();
