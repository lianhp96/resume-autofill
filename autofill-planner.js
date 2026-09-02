(function initAutofillPlanner(root, factory) {
  const exported = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (root) root.AutofillPlanner = exported;
})(typeof globalThis !== 'undefined' ? globalThis : null, () => {
  'use strict';

  const DEFAULT_AUTOFILL_POLICY = Object.freeze({
    neverAutofillPattern: /身份证|证件|护照|银行卡|密码|验证码|手机|电话|邮箱|微信|qq|社交账号|联系人|民族|宗教|政治面貌|婚姻|婚育|健康|病史|残障|薪资|薪酬|调剂|授权|声明|签名|背景调查|开放题|自我评价|自我介绍|应聘理由|文件|附件|简历上传/i,
    confirmBeforeAutofillPattern: /性别|出生|籍贯|户籍|住址|地址/i
  });

  const FIELD_ALIASES = {
    '姓名': ['姓名', '中文名', '真实姓名', '申请人姓名'],
    '学校': ['学校', '毕业院校', '就读学校', '院校名称'],
    '结束时间': ['结束时间', '毕业时间', '毕业年月', '预计毕业时间'],
    '开始时间': ['开始时间', '入学时间', '入学年月'],
    '专业': ['专业', '所学专业', '专业名称'],
    '学历': ['学历', '最高学历', '教育程度'],
    '邮箱': ['邮箱', '电子邮箱', 'email'],
    '手机': ['手机', '手机号', '联系电话', '移动电话']
  };

  const scopeIds = new WeakMap();
  let nextScopeId = 0;

  function normalizeLabel(value) {
    return String(value || '')
      .replace(/[\s:*：()（）\[\]【】_-]/g, '')
      .toLowerCase();
  }

  function sanitizeDescriptorText(value) {
    const text = String(value || '')
      .replace(/^(?:请输入|请选择|请填写)\s*/i, '')
      .replace(/[\r\n\t]+/g, ' ')
      .trim()
      .slice(0, 80);
    if (!text) return '';
    if (/[^\s@]+@[\w.-]+\.[a-z]{2,}/i.test(text)) return '';
    if (/1[3-9]\d{9}/.test(text)) return '';
    if (/\d{15,18}[\dXx]?/.test(text)) return '';
    return text;
  }

  function classifyField(label, policy = DEFAULT_AUTOFILL_POLICY) {
    const text = String(label || '');
    if (policy.neverAutofillPattern.test(text)) return 'never';
    if (policy.confirmBeforeAutofillPattern.test(text)) return 'confirm';
    return 'standard';
  }

  function inferKind(label) {
    const normalized = normalizeLabel(label);
    if (/开始时间|结束时间|入学时间|毕业时间|毕业年月|预计毕业时间/.test(normalized)) return 'month';
    if (/日期|生日|出生年月/.test(normalized)) return 'date';
    return 'text';
  }

  function canonicalField(label) {
    const normalized = normalizeLabel(label);
    for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some(alias => normalizeLabel(alias) === normalized)) return canonical;
    }
    return null;
  }

  function buildProfileSchema(profile, policy = DEFAULT_AUTOFILL_POLICY) {
    if (!profile || typeof profile !== 'object') return [];
    const descriptors = [];

    for (const [section, sectionData] of Object.entries(profile)) {
      if (Array.isArray(sectionData)) {
        sectionData.forEach((entry, repeatIndex) => {
          if (!entry || typeof entry !== 'object') return;
          for (const label of Object.keys(entry)) {
            const autofillClass = classifyField(label, policy);
            if (label.startsWith('_') || autofillClass === 'never') continue;
            const path = `${section}[${repeatIndex}].${label}`;
            descriptors.push({
              id: `profile:${path}`,
              path,
              label,
              kind: inferKind(label),
              section,
              repeatIndex,
              autofillClass
            });
          }
        });
      } else if (sectionData && typeof sectionData === 'object') {
        for (const label of Object.keys(sectionData)) {
          const autofillClass = classifyField(label, policy);
          if (autofillClass === 'never') continue;
          const path = `${section}.${label}`;
          descriptors.push({
            id: `profile:${path}`,
            path,
            label,
            kind: inferKind(label),
            section,
            repeatIndex: null,
            autofillClass
          });
        }
      }
    }

    return descriptors;
  }

  function readAttribute(element, name) {
    return element && typeof element.getAttribute === 'function' ? element.getAttribute(name) : null;
  }

  function extractPageFieldLabel(element, documentRef) {
    const id = readAttribute(element, 'id');
    const explicitLabel = id && documentRef && typeof documentRef.querySelectorAll === 'function'
      ? Array.from(documentRef.querySelectorAll('label[for]')).find(label => readAttribute(label, 'for') === id)
      : null;
    const candidates = [
      explicitLabel && (explicitLabel.innerText || explicitLabel.textContent),
      readAttribute(element, 'aria-label'),
      readAttribute(element, 'placeholder'),
      readAttribute(element, 'name')
    ];
    for (const candidate of candidates) {
      const label = sanitizeDescriptorText(candidate);
      if (label) return label;
    }
    return '';
  }

  function isVisibleWritableControl(element) {
    if (!element || element.disabled || element.readOnly) return false;
    const tagName = String(element.tagName || '').toLowerCase();
    if (!['input', 'textarea', 'select'].includes(tagName)) return false;
    const type = String(element.type || readAttribute(element, 'type') || '').toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image', 'file', 'password'].includes(type)) return false;
    if ('offsetParent' in element && element.offsetParent === null) return false;
    if (typeof element.closest === 'function' && element.closest('#autumn-job-assistant-host')) return false;
    return true;
  }

  function extractSelectOptions(element) {
    if (String(element.tagName || '').toLowerCase() !== 'select' || !element.options) return [];
    return Array.from(element.options)
      .map(option => sanitizeDescriptorText(option.text || option.textContent || option.label))
      .filter(Boolean)
      .slice(0, 30);
  }

  function extractScope(element) {
    const scope = typeof element.closest === 'function'
      ? element.closest('fieldset, [data-autofill-section]')
      : null;
    const identityTarget = scope || element.form || null;
    const repeatIndexText = readAttribute(scope, 'data-autofill-repeat-index');
    const legend = scope && typeof scope.querySelector === 'function' ? scope.querySelector('legend') : null;
    return {
      section: sanitizeDescriptorText(readAttribute(scope, 'data-autofill-section') || readAttribute(scope, 'aria-label') || (legend && (legend.innerText || legend.textContent))),
      label: sanitizeDescriptorText(readAttribute(scope, 'data-autofill-label')),
      repeatIndex: /^\d+$/.test(String(repeatIndexText || '')) ? Number(repeatIndexText) : null,
      key: scopeIdentity(identityTarget)
    };
  }

  function scopeIdentity(element) {
    if (!element || (typeof element !== 'object' && typeof element !== 'function')) return 'root';
    if (!scopeIds.has(element)) {
      nextScopeId += 1;
      scopeIds.set(element, `scope:${nextScopeId}`);
    }
    return scopeIds.get(element);
  }

  function isAlreadyFilled(element) {
    const type = String(element.type || readAttribute(element, 'type') || '').toLowerCase();
    if (type === 'radio' || type === 'checkbox') return Boolean(element.checked);
    return Boolean(String(element.value || '').trim());
  }

  function describePageField(element, documentRef) {
    const tagName = String(element.tagName || '').toLowerCase();
    const inputType = String(element.type || readAttribute(element, 'type') || '').toLowerCase();
    const scope = extractScope(element);
    return {
      label: extractPageFieldLabel(element, documentRef),
      control: tagName === 'textarea' ? 'textarea' : (tagName === 'select' ? 'select' : (inputType || 'text')),
      required: Boolean(element.required || readAttribute(element, 'required') !== null),
      section: scope.section,
      repeatIndex: scope.repeatIndex,
      hasExistingValue: false,
      options: extractSelectOptions(element)
    };
  }

  function describeChoiceGroup(elements, documentRef) {
    const first = elements[0];
    const scope = extractScope(first);
    const options = elements
      .map(element => extractPageFieldLabel(element, documentRef))
      .filter(Boolean)
      .filter((label, index, labels) => labels.indexOf(label) === index)
      .slice(0, 30);
    return {
      label: scope.label || sanitizeDescriptorText(readAttribute(first, 'name') || first.name),
      control: String(first.type || readAttribute(first, 'type') || '').toLowerCase(),
      required: elements.some(element => Boolean(element.required || readAttribute(element, 'required') !== null)),
      section: scope.section,
      repeatIndex: scope.repeatIndex,
      hasExistingValue: false,
      options
    };
  }

  function collectPageFields(documentRef) {
    if (!documentRef || typeof documentRef.querySelectorAll !== 'function') return [];
    const entries = [];
    const groups = new Map();
    for (const element of Array.from(documentRef.querySelectorAll('input, textarea, select')).filter(isVisibleWritableControl)) {
      const type = String(element.type || readAttribute(element, 'type') || '').toLowerCase();
      if (type === 'radio' || type === 'checkbox') {
        const groupKey = `${type}:${extractScope(element).key}:${readAttribute(element, 'name') || element.name || entries.length}`;
        if (!groups.has(groupKey)) {
          const group = [];
          groups.set(groupKey, group);
          entries.push(group);
        }
        groups.get(groupKey).push(element);
      } else if (!isAlreadyFilled(element)) {
        entries.push(element);
      }
    }

    return entries
      .filter(entry => !Array.isArray(entry) || !entry.some(isAlreadyFilled))
      .map(entry => Array.isArray(entry)
        ? describeChoiceGroup(entry, documentRef)
        : describePageField(entry, documentRef))
      .filter(field => Boolean(field.label))
      .map((field, index) => ({ id: `page:${index}`, ...field }));
  }

  function stableHash(text) {
    let hash = 2166136261;
    for (const char of String(text || '')) {
      hash ^= char.codePointAt(0);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function buildFormFingerprint({ location, fields } = {}) {
    const origin = String(location?.origin || '');
    const pathname = normalizePathTemplate(location?.pathname);
    const fieldSignature = (Array.isArray(fields) ? fields : []).map(field => [
      normalizeLabel(field.label),
      String(field.control || ''),
      field.required ? 'required' : 'optional',
      normalizeLabel(field.section),
      field.repeatIndex ?? '',
      (Array.isArray(field.options) ? field.options : []).map(normalizeLabel).join(',')
    ].join('|')).join('\n');
    return `form:v1:${stableHash(`${origin}${pathname}\n${fieldSignature}`)}`;
  }

  function buildAiMappingRequest({ pageFields, profileSchema, policy = DEFAULT_AUTOFILL_POLICY, fingerprint = '' } = {}) {
    const safePageFields = (Array.isArray(pageFields) ? pageFields : [])
      .map(field => {
        const label = sanitizeDescriptorText(field.label);
        if (!label || classifyField(label, policy) !== 'standard') return null;
        return {
          id: String(field.id || ''),
          label,
          control: String(field.control || ''),
          required: Boolean(field.required),
          section: sanitizeDescriptorText(field.section),
          repeatIndex: Number.isInteger(field.repeatIndex) ? field.repeatIndex : null,
          options: (Array.isArray(field.options) ? field.options : []).map(sanitizeDescriptorText).filter(Boolean).slice(0, 30)
        };
      })
      .filter(field => field && field.id);
    const safeProfileFields = (Array.isArray(profileSchema) ? profileSchema : [])
      .map(field => {
        const label = sanitizeDescriptorText(field.label);
        if (!label || field.autofillClass !== 'standard' || classifyField(label, policy) !== 'standard') return null;
        return {
          id: String(field.id || ''),
          path: String(field.path || ''),
          label,
          kind: String(field.kind || ''),
          section: sanitizeDescriptorText(field.section),
          repeatIndex: Number.isInteger(field.repeatIndex) ? field.repeatIndex : null,
          autofillClass: 'standard'
        };
      })
      .filter(field => field && field.id && field.path);
    return {
      version: 1,
      fingerprint: String(fingerprint || ''),
      pageFields: safePageFields,
      profileFields: safeProfileFields
    };
  }

  function normalizePathTemplate(pathname) {
    return String(pathname || '/').split('/').map(segment => (
      /^\d+$/.test(segment)
      || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)
      || /^[0-9a-f]{16,}$/i.test(segment)
        ? ':id'
        : segment
    )).join('/') || '/';
  }

  function isCompatible(pageField, profileField) {
    const control = String(pageField.control || '').toLowerCase();
    if (['select', 'radio', 'checkbox', 'file', 'contenteditable'].includes(control)) return false;
    if (profileField.kind === 'month') return control === 'month';
    if (profileField.kind === 'date') return control === 'date';
    return control === 'text' || control === 'textarea' || control === 'email' || control === 'tel';
  }

  function validateAiMappingPlan({ candidate, pageFields, profileSchema, policy = DEFAULT_AUTOFILL_POLICY, fingerprint = '' } = {}) {
    if (!candidate || typeof candidate !== 'object' || candidate.version !== 1 || !Array.isArray(candidate.mappings)) {
      return { ok: false, error: 'invalid_mapping_plan' };
    }
    const pageById = new Map((Array.isArray(pageFields) ? pageFields : []).map(field => [field.id, field]));
    const profileById = new Map((Array.isArray(profileSchema) ? profileSchema : []).map(field => [field.id, field]));
    const usedPageIds = new Set();
    const usedProfileIds = new Set();
    const mappings = [];

    for (const mapping of candidate.mappings) {
      if (!mapping || typeof mapping !== 'object') return { ok: false, error: 'invalid_mapping' };
      const pageField = pageById.get(mapping.pageFieldId);
      const profileField = profileById.get(mapping.profileFieldId);
      if (!pageField || !profileField) return { ok: false, error: 'unknown_field_id' };
      if (usedPageIds.has(pageField.id)) return { ok: false, error: 'duplicate_page_field' };
      if (usedProfileIds.has(profileField.id)) return { ok: false, error: 'duplicate_profile_field' };
      if (classifyField(pageField.label, policy) !== 'standard' || profileField.autofillClass !== 'standard' || classifyField(profileField.label, policy) !== 'standard') {
        return { ok: false, error: 'forbidden_field' };
      }
      if (!isCompatible(pageField, profileField)) return { ok: false, error: 'incompatible_field_type' };
      if (typeof mapping.confidence !== 'number' || mapping.confidence < 0 || mapping.confidence > 1) {
        return { ok: false, error: 'invalid_confidence' };
      }
      const reasonCode = String(mapping.reasonCode || 'semantic_label_match');
      if (!/^[a-z_]{3,64}$/.test(reasonCode)) return { ok: false, error: 'invalid_reason_code' };
      mappings.push({
        pageFieldId: pageField.id,
        profileFieldId: profileField.id,
        confidence: mapping.confidence,
        reasonCode,
        source: 'ai'
      });
      usedPageIds.add(pageField.id);
      usedProfileIds.add(profileField.id);
    }

    return {
      ok: true,
      plan: {
        version: 1,
        fingerprint: String(fingerprint || ''),
        mappings,
        unmappedPageFieldIds: Array.from(pageById.keys()).filter(id => !usedPageIds.has(id))
      }
    };
  }

  function inSameScope(pageField, profileField) {
    if (pageField.section && profileField.section && pageField.section !== profileField.section) return false;
    if (pageField.repeatIndex !== null && pageField.repeatIndex !== undefined) {
      return pageField.repeatIndex === profileField.repeatIndex;
    }
    return profileField.repeatIndex === null || profileField.repeatIndex === undefined;
  }

  function matchingCandidates(pageField, profileSchema, policy) {
    if (classifyField(pageField.label, policy) !== 'standard') return [];
    const pageLabel = normalizeLabel(pageField.label);
    const canonical = canonicalField(pageField.label);

    return profileSchema.filter(profileField => {
      if (profileField.autofillClass !== 'standard') return false;
      if (!isCompatible(pageField, profileField) || !inSameScope(pageField, profileField)) return false;
      const profileLabel = normalizeLabel(profileField.label);
      return profileLabel === pageLabel || (canonical && canonicalField(profileField.label) === canonical);
    });
  }

  function planAutofill({ pageFields, profileSchema, policy = DEFAULT_AUTOFILL_POLICY, fingerprint = '' } = {}) {
    const mappings = [];
    const unmappedPageFieldIds = [];
    const usedProfileIds = new Set();

    for (const pageField of Array.isArray(pageFields) ? pageFields : []) {
      const candidates = matchingCandidates(pageField, Array.isArray(profileSchema) ? profileSchema : [], policy)
        .filter(candidate => !usedProfileIds.has(candidate.id));
      if (candidates.length !== 1) {
        unmappedPageFieldIds.push(pageField.id);
        continue;
      }

      const profileField = candidates[0];
      const exact = normalizeLabel(pageField.label) === normalizeLabel(profileField.label);
      mappings.push({
        pageFieldId: pageField.id,
        profileFieldId: profileField.id,
        confidence: exact ? 1 : 0.98,
        reasonCode: exact ? 'exact_label_match' : 'section_alias_match',
        source: 'local-rule'
      });
      usedProfileIds.add(profileField.id);
    }

    return {
      version: 1,
      fingerprint: String(fingerprint || ''),
      mappings,
      unmappedPageFieldIds
    };
  }

  return {
    DEFAULT_AUTOFILL_POLICY,
    buildAiMappingRequest,
    buildProfileSchema,
    buildFormFingerprint,
    collectPageFields,
    planAutofill,
    validateAiMappingPlan
  };
});
