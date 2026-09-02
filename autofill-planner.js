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

  function normalizeLabel(value) {
    return String(value || '')
      .replace(/[\s:*：()（）\[\]【】_-]/g, '')
      .toLowerCase();
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
      const label = String(candidate || '')
        .replace(/^(?:请输入|请选择|请填写)\s*/i, '')
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, 80);
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
      .map(option => String(option.text || option.textContent || option.label || '').trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 30);
  }

  function collectPageFields(documentRef) {
    if (!documentRef || typeof documentRef.querySelectorAll !== 'function') return [];
    return Array.from(documentRef.querySelectorAll('input, textarea, select'))
      .filter(isVisibleWritableControl)
      .filter(element => !String(element.value || '').trim())
      .map((element, index) => {
        const tagName = String(element.tagName || '').toLowerCase();
        const inputType = String(element.type || readAttribute(element, 'type') || '').toLowerCase();
        return {
          id: `page:${index}`,
          label: extractPageFieldLabel(element, documentRef),
          control: tagName === 'textarea' ? 'textarea' : (tagName === 'select' ? 'select' : (inputType || 'text')),
          required: Boolean(element.required || readAttribute(element, 'required') !== null),
          section: '',
          repeatIndex: null,
          hasExistingValue: false,
          options: extractSelectOptions(element)
        };
      })
      .filter(field => Boolean(field.label));
  }

  function isCompatible(pageField, profileField) {
    const control = String(pageField.control || '').toLowerCase();
    if (['select', 'radio', 'checkbox', 'file', 'contenteditable'].includes(control)) return false;
    if (profileField.kind === 'month') return control === 'month';
    if (profileField.kind === 'date') return control === 'date';
    return control === 'text' || control === 'textarea' || control === 'email' || control === 'tel';
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
    buildProfileSchema,
    collectPageFields,
    planAutofill
  };
});
