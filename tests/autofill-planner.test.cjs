const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProfileSchema,
  buildFormFingerprint,
  buildAiMappingRequest,
  collectPageFields,
  MIN_AI_MAPPING_CONFIDENCE,
  normalizeAiPreviewPlan,
  planAutofill,
  validateAiMappingPlan
} = require('../autofill-planner.js');

test('buildProfileSchema exposes field semantics but never profile values', () => {
  const schema = buildProfileSchema({
    '基本信息': {
      '姓名': '李明',
      '手机': '13800138000',
      '身份证': '110101199801011234'
    },
    '教育经历': [{
      '_rowName': '硕士',
      '学校': '浙江大学',
      '结束时间': '2026-06'
    }]
  });

  assert.deepEqual(schema, [
    {
      id: 'profile:基本信息.姓名',
      path: '基本信息.姓名',
      label: '姓名',
      kind: 'text',
      section: '基本信息',
      repeatIndex: null,
      autofillClass: 'standard'
    },
    {
      id: 'profile:教育经历[0].学校',
      path: '教育经历[0].学校',
      label: '学校',
      kind: 'text',
      section: '教育经历',
      repeatIndex: 0,
      autofillClass: 'standard'
    },
    {
      id: 'profile:教育经历[0].结束时间',
      path: '教育经历[0].结束时间',
      label: '结束时间',
      kind: 'month',
      section: '教育经历',
      repeatIndex: 0,
      autofillClass: 'standard'
    }
  ]);
  assert.equal(JSON.stringify(schema).includes('李明'), false);
  assert.equal(JSON.stringify(schema).includes('13800138000'), false);
  assert.equal(JSON.stringify(schema).includes('110101199801011234'), false);
});

test('buildProfileSchema does not read values and excludes all contact identifiers by default', () => {
  const basicInfo = { '微信号': 'private-wechat', '联系人': '家人', 'QQ': '123456' };
  Object.defineProperty(basicInfo, '学校', {
    enumerable: true,
    get() { throw new Error('schema construction must not access field values'); }
  });

  assert.deepEqual(buildProfileSchema({ '基本信息': basicInfo }), [
    {
      id: 'profile:基本信息.学校',
      path: '基本信息.学校',
      label: '学校',
      kind: 'text',
      section: '基本信息',
      repeatIndex: null,
      autofillClass: 'standard'
    }
  ]);
});

test('planAutofill produces a deterministic, section-aware mapping plan', () => {
  const profileSchema = buildProfileSchema({
    '基本信息': { '姓名': '李明' },
    '教育经历': [
      { '学校': '浙江大学', '结束时间': '2026-06' },
      { '学校': '华东理工大学', '结束时间': '2023-06' }
    ]
  });

  const plan = planAutofill({
    fingerprint: 'example.test:education-v1',
    profileSchema,
    pageFields: [
      { id: 'p-name', label: '姓名', control: 'text', section: '基本信息', repeatIndex: null },
      { id: 'p-school-1', label: '毕业院校', control: 'text', section: '教育经历', repeatIndex: 1 },
      { id: 'p-graduation-1', label: '毕业时间', control: 'month', section: '教育经历', repeatIndex: 1 }
    ]
  });

  assert.deepEqual(plan, {
    version: 1,
    fingerprint: 'example.test:education-v1',
    mappings: [
      {
        pageFieldId: 'p-name',
        profileFieldId: 'profile:基本信息.姓名',
        confidence: 1,
        reasonCode: 'exact_label_match',
        source: 'local-rule'
      },
      {
        pageFieldId: 'p-school-1',
        profileFieldId: 'profile:教育经历[1].学校',
        confidence: 0.98,
        reasonCode: 'section_alias_match',
        source: 'local-rule'
      },
      {
        pageFieldId: 'p-graduation-1',
        profileFieldId: 'profile:教育经历[1].结束时间',
        confidence: 0.98,
        reasonCode: 'section_alias_match',
        source: 'local-rule'
      }
    ],
    unmappedPageFieldIds: []
  });
});

test('planAutofill skips ambiguous and incompatible fields rather than guessing', () => {
  const profileSchema = buildProfileSchema({
    '基本信息': {
      '现居地': '北京市海淀区',
      '户籍地': '山东省济南市',
      '性别': '男'
    }
  });

  const plan = planAutofill({
    fingerprint: 'example.test:ambiguous-v1',
    profileSchema,
    pageFields: [
      { id: 'p-address', label: '地址', control: 'text', section: '基本信息', repeatIndex: null },
      { id: 'p-birth-month', label: '出生月份', control: 'month', section: '基本信息', repeatIndex: null },
      { id: 'p-gender', label: '性别', control: 'select', section: '基本信息', repeatIndex: null }
    ]
  });

  assert.deepEqual(plan.mappings, []);
  assert.deepEqual(plan.unmappedPageFieldIds, ['p-address', 'p-birth-month', 'p-gender']);
});

test('collectPageFields returns a value-free description for empty visible controls only', () => {
  const visibleField = {
    tagName: 'INPUT',
    type: 'text',
    id: 'school',
    name: 'school',
    value: '',
    required: true,
    disabled: false,
    readOnly: false,
    offsetParent: {},
    getAttribute(name) {
      return { id: 'school', name: 'school', placeholder: '请输入毕业院校' }[name] || null;
    },
    closest() { return null; }
  };
  const populatedField = {
    ...visibleField,
    id: 'email',
    name: 'email',
    value: 'private@example.com',
    getAttribute(name) {
      return { id: 'email', name: 'email', placeholder: '邮箱' }[name] || null;
    }
  };
  const hiddenField = { ...visibleField, type: 'hidden' };
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select') return [visibleField, populatedField, hiddenField];
      if (selector === 'label[for]') {
        return [{ textContent: '毕业院校', getAttribute(name) { return name === 'for' ? 'school' : null; } }];
      }
      return [];
    }
  };

  assert.deepEqual(collectPageFields(doc), [
    {
      id: 'page:0',
      label: '毕业院校',
      control: 'text',
      required: true,
      section: '',
      repeatIndex: null,
      hasExistingValue: false,
      options: []
    }
  ]);
});

test('collectPageFields resolves labels without interpolating an arbitrary element id into a selector', () => {
  const field = {
    tagName: 'INPUT',
    type: 'text',
    value: '',
    required: false,
    disabled: false,
    readOnly: false,
    offsetParent: {},
    getAttribute(name) { return name === 'id' ? 'school\"]bad' : null; },
    closest() { return null; }
  };
  const label = {
    textContent: '毕业院校',
    getAttribute(name) { return name === 'for' ? 'school\"]bad' : null; }
  };
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select') return [field];
      if (selector === 'label[for]') return [label];
      return [];
    }
  };

  assert.equal(collectPageFields(doc)[0].label, '毕业院校');
});

test('collectPageFields groups unchecked radios and describes native selects without page values', () => {
  const section = {
    getAttribute(name) {
      return { 'data-autofill-section': '教育经历', 'data-autofill-repeat-index': '1' }[name] || null;
    }
  };
  const base = {
    disabled: false,
    readOnly: false,
    offsetParent: {},
    checked: false,
    closest(selector) {
      return selector === 'fieldset, [data-autofill-section]' ? section : null;
    }
  };
  const school = {
    ...base,
    tagName: 'INPUT', type: 'text', value: '', required: true,
    getAttribute(name) { return { id: 'school', placeholder: '毕业院校' }[name] || null; }
  };
  const degree = {
    ...base,
    tagName: 'SELECT', type: 'select-one', value: '', required: true,
    options: [{ text: '请选择' }, { text: '硕士研究生' }],
    getAttribute(name) { return name === 'id' ? 'degree' : null; }
  };
  const genderSection = {
    getAttribute(name) {
      return { 'data-autofill-section': '基本信息', 'data-autofill-label': '性别' }[name] || null;
    }
  };
  const male = {
    ...base,
    tagName: 'INPUT', type: 'radio', value: 'male', name: 'gender',
    closest(selector) {
      return selector === 'fieldset, [data-autofill-section]' ? genderSection : null;
    },
    getAttribute(name) { return { id: 'male', name: 'gender', 'aria-label': '男' }[name] || null; }
  };
  const female = {
    ...male,
    getAttribute(name) { return { id: 'female', name: 'gender', 'aria-label': '女' }[name] || null; }
  };
  const labels = [
    { textContent: '毕业院校', getAttribute(name) { return name === 'for' ? 'school' : null; } },
    { textContent: '学历', getAttribute(name) { return name === 'for' ? 'degree' : null; } }
  ];
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select') return [school, degree, male, female];
      if (selector === 'label[for]') return labels;
      return [];
    }
  };

  assert.deepEqual(collectPageFields(doc), [
    {
      id: 'page:0', label: '毕业院校', control: 'text', required: true,
      section: '教育经历', repeatIndex: 1, hasExistingValue: false, options: []
    },
    {
      id: 'page:1', label: '学历', control: 'select', required: true,
      section: '教育经历', repeatIndex: 1, hasExistingValue: false, options: ['硕士研究生']
    },
    {
      id: 'page:2', label: '性别', control: 'radio', required: false,
      section: '基本信息', repeatIndex: null, hasExistingValue: false, options: ['男', '女']
    }
  ]);
});

test('buildFormFingerprint excludes URL query and changes when the form semantics change', () => {
  const fields = [
    { label: '姓名', control: 'text', required: true, section: '基本信息', repeatIndex: null, options: [] },
    { label: '毕业院校', control: 'text', required: true, section: '教育经历', repeatIndex: 0, options: [] }
  ];
  const withQuery = buildFormFingerprint({
    location: { origin: 'https://jobs.example.com', pathname: '/apply/42', search: '?name=private' },
    fields
  });
  const withoutQuery = buildFormFingerprint({
    location: { origin: 'https://jobs.example.com', pathname: '/apply/42', search: '' },
    fields
  });
  const changedForm = buildFormFingerprint({
    location: { origin: 'https://jobs.example.com', pathname: '/apply/42', search: '' },
    fields: [...fields, { label: '专业', control: 'text', required: true, section: '教育经历', repeatIndex: 0, options: [] }]
  });

  assert.match(withQuery, /^form:v1:[a-z0-9]+$/);
  assert.equal(withQuery, withoutQuery);
  assert.notEqual(withQuery, changedForm);
  assert.equal(withQuery.includes('private'), false);

  const sameFormDifferentJob = buildFormFingerprint({
    location: { origin: 'https://jobs.example.com', pathname: '/apply/43', search: '' },
    fields
  });
  assert.equal(withoutQuery, sameFormDifferentJob);
});

test('collectPageFields keeps same-named radio groups separate in repeated scopes', () => {
  const firstScope = {
    getAttribute(name) {
      return { 'data-autofill-section': '教育经历', 'data-autofill-repeat-index': '0', 'data-autofill-label': '是否统招' }[name] || null;
    }
  };
  const secondScope = {
    getAttribute(name) {
      return { 'data-autofill-section': '教育经历', 'data-autofill-repeat-index': '1', 'data-autofill-label': '是否统招' }[name] || null;
    }
  };
  function radio(id, scope) {
    return {
      tagName: 'INPUT', type: 'radio', value: 'yes', name: 'full-time', checked: false,
      disabled: false, readOnly: false, offsetParent: {},
      getAttribute(name) { return { id, name: 'full-time', 'aria-label': '是' }[name] || null; },
      closest(selector) { return selector === 'fieldset, [data-autofill-section]' ? scope : null; }
    };
  }
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select') return [radio('first', firstScope), radio('second', secondScope)];
      if (selector === 'label[for]') return [];
      return [];
    }
  };

  assert.deepEqual(collectPageFields(doc).map(field => ({
    label: field.label,
    section: field.section,
    repeatIndex: field.repeatIndex
  })), [
    { label: '是否统招', section: '教育经历', repeatIndex: 0 },
    { label: '是否统招', section: '教育经历', repeatIndex: 1 }
  ]);
});

test('collectPageFields uses a fieldset legend and drops labels containing a personal value', () => {
  const fieldset = {
    getAttribute() { return null; },
    querySelector(selector) { return selector === 'legend' ? { textContent: '教育经历' } : null; }
  };
  const school = {
    tagName: 'INPUT', type: 'text', value: '', disabled: false, readOnly: false, offsetParent: {},
    getAttribute(name) { return { id: 'school', placeholder: '毕业院校' }[name] || null; },
    closest(selector) { return selector === 'fieldset, [data-autofill-section]' ? fieldset : null; }
  };
  const leakedLabel = {
    tagName: 'INPUT', type: 'text', value: '', disabled: false, readOnly: false, offsetParent: {},
    getAttribute(name) { return name === 'aria-label' ? '请输入张三@example.com' : null; },
    closest() { return null; }
  };
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select') return [school, leakedLabel];
      if (selector === 'label[for]') return [];
      return [];
    }
  };

  assert.deepEqual(collectPageFields(doc), [
    {
      id: 'page:0', label: '毕业院校', control: 'text', required: false,
      section: '教育经历', repeatIndex: null, hasExistingValue: false, options: []
    }
  ]);
});

test('collectPageFields adds only label-like ancestor context, never page values', () => {
  const heading = { tagName: 'H3', textContent: '教育经历', children: [], getAttribute() { return null; } };
  const fieldLabel = { tagName: 'DIV', className: 'form-item-label', textContent: '毕业院校', children: [], getAttribute() { return null; } };
  const field = {
    tagName: 'INPUT', type: 'text', value: '', disabled: false, readOnly: false, offsetParent: {},
    getAttribute(name) { return { id: 'school', placeholder: '毕业院校' }[name] || null; },
    closest() { return null; }
  };
  const populatedSibling = {
    tagName: 'INPUT', type: 'text', value: '页面已有的隐私值', disabled: false, readOnly: false, offsetParent: {},
    getAttribute(name) { return { id: 'private', placeholder: '个人信息', 'aria-label': '页面已有的隐私值' }[name] || null; },
    closest() { return null; }
  };
  const item = { tagName: 'DIV', className: 'form-item', children: [fieldLabel, field, populatedSibling], getAttribute() { return null; } };
  const group = { tagName: 'SECTION', children: [heading, item], getAttribute() { return null; } };
  field.parentElement = item;
  item.parentElement = group;
  const doc = {
    querySelectorAll(selector) {
      if (selector === 'input, textarea, select') return [field, populatedSibling];
      if (selector === 'label[for]') return [];
      return [];
    }
  };

  const fields = collectPageFields(doc);
  assert.equal(fields[0].context, '教育经历');
  assert.equal(JSON.stringify(fields).includes('页面已有的隐私值'), false);
});

test('buildAiMappingRequest contains only safe field descriptors, never source or page values', () => {
  const request = buildAiMappingRequest({
    fingerprint: 'form:v1:education',
    pageFields: [
      {
        id: 'page-school', label: '毕业院校', control: 'text', required: true,
        section: '教育经历', repeatIndex: 0, options: [], value: '页面已有的隐私值'
      },
      {
        id: 'page-phone', label: '手机号码', control: 'tel', required: true,
        section: '基本信息', repeatIndex: null, options: [], value: '13800138000'
      }
    ],
    profileSchema: [
      {
        id: 'profile-school', path: '教育经历[0].学校', label: '学校', kind: 'text',
        section: '教育经历', repeatIndex: 0, autofillClass: 'standard', value: '浙江大学'
      },
      {
        id: 'profile-phone', path: '优先信息.手机', label: '手机', kind: 'text',
        section: '优先信息', repeatIndex: null, autofillClass: 'never', value: '13800138000'
      }
    ]
  });

  assert.deepEqual(request, {
    version: 1,
    pageFields: [{
      id: 'page_0', label: '毕业院校', control: 'text', required: true,
      section: '教育经历', repeatIndex: 0, options: []
    }],
    profileFields: [{
      id: 'profile_0', label: '学校', kind: 'text',
      section: '教育经历', repeatIndex: 0, autofillClass: 'standard'
    }]
  });
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes('浙江大学'), false);
  assert.equal(serialized.includes('13800138000'), false);
  assert.equal(serialized.includes('页面已有的隐私值'), false);
  assert.equal(serialized.includes('教育经历[0].学校'), false);
  assert.equal(serialized.includes('form:v1:education'), false);
  assert.equal(serialized.includes('page-school'), false);
  assert.equal(serialized.includes('profile-school'), false);
});

test('buildAiMappingRequest keeps English contact fields out of the remote payload', () => {
  const request = buildAiMappingRequest({
    pageFields: [{ id: 'page-email', label: 'Email', control: 'email' }],
    profileSchema: [{ id: 'profile-email', path: 'Email', label: 'Email', kind: 'text', autofillClass: 'standard' }]
  });

  assert.deepEqual(request, { version: 1, pageFields: [], profileFields: [] });
});

test('buildAiMappingRequest includes label-only context and excludes standalone year/month fields', () => {
  const request = buildAiMappingRequest({
    pageFields: [
      { id: 'page-year', label: '年', control: 'text', context: '教育经历 > 毕业时间' },
      { id: 'page-month', label: '月', control: 'text', context: '教育经历 > 毕业时间' },
      { id: 'page-school', label: '毕业院校', control: 'text', context: '教育经历', value: '页面已有的隐私值' }
    ],
    profileSchema: [{ id: 'profile-school', path: '教育经历[0].学校', label: '学校', kind: 'text', autofillClass: 'standard', value: '浙江大学' }]
  });

  assert.deepEqual(request.pageFields, [{
    id: 'page_2', label: '毕业院校', control: 'text', required: false,
    section: '', repeatIndex: null, options: [], context: '教育经历'
  }]);
  const serialized = JSON.stringify(request);
  assert.equal(serialized.includes('页面已有的隐私值'), false);
  assert.equal(serialized.includes('浙江大学'), false);
  assert.equal(serialized.includes('毕业时间'), false);
});

test('normalizeAiPreviewPlan accepts confidence strictly above the threshold', () => {
  const result = normalizeAiPreviewPlan({
    pageFields: [{ id: 'page-threshold' }, { id: 'page-above-threshold' }],
    profileSchema: [{ id: 'profile-name' }],
    candidate: { mappings: [
      { pageFieldId: 'page-threshold', profileFieldId: 'profile-name', confidence: MIN_AI_MAPPING_CONFIDENCE },
      { pageFieldId: 'page-above-threshold', profileFieldId: 'profile-name', confidence: MIN_AI_MAPPING_CONFIDENCE + 0.01 }
    ] }
  });

  assert.deepEqual(result.plan.mappings.map(mapping => mapping.pageFieldId), ['page-above-threshold']);
  assert.deepEqual(result.plan.unmappedPageFieldIds, ['page-threshold']);
});

test('validateAiMappingPlan accepts only known, unique, compatible mappings', () => {
  const pageFields = [{
    id: 'page-school', label: '毕业院校', control: 'text', required: true,
    section: '教育经历', repeatIndex: 0, options: []
  }];
  const profileSchema = [{
    id: 'profile-school', path: '教育经历[0].学校', label: '学校', kind: 'text',
    section: '教育经历', repeatIndex: 0, autofillClass: 'standard'
  }];

  assert.deepEqual(validateAiMappingPlan({
    fingerprint: 'form:v1:education', pageFields, profileSchema,
    candidate: {
      version: 1,
      mappings: [{
        pageFieldId: 'page-school', profileFieldId: 'profile-school',
        confidence: 0.91, reasonCode: 'semantic_label_match'
      }],
      unmappedPageFieldIds: []
    }
  }), {
    ok: true,
    plan: {
      version: 1,
      fingerprint: 'form:v1:education',
      mappings: [{
        pageFieldId: 'page-school', profileFieldId: 'profile-school',
        confidence: 0.91, reasonCode: 'semantic_label_match', source: 'ai'
      }],
      unmappedPageFieldIds: []
    }
  });

  assert.deepEqual(validateAiMappingPlan({
    fingerprint: 'form:v1:education', pageFields, profileSchema,
    candidate: {
      version: 1,
      mappings: [
        { pageFieldId: 'page-school', profileFieldId: 'profile-school', confidence: 0.9, reasonCode: 'semantic_label_match' },
        { pageFieldId: 'page-school', profileFieldId: 'profile-school', confidence: 0.9, reasonCode: 'semantic_label_match' }
      ],
      unmappedPageFieldIds: []
    }
  }), { ok: false, error: 'duplicate_page_field' });

  assert.deepEqual(validateAiMappingPlan({
    fingerprint: 'form:v1:education', pageFields, profileSchema,
    candidate: {
      version: 1,
      mappings: [{
        pageFieldId: 'page-unknown', profileFieldId: 'profile-school',
        confidence: 0.9, reasonCode: 'semantic_label_match'
      }],
      unmappedPageFieldIds: ['page-school']
    }
  }), { ok: false, error: 'unknown_field_id' });
});

test('validateAiMappingPlan requires confidence strictly above its threshold', () => {
  const pageFields = [{
    id: 'page-school', label: '毕业院校', control: 'text', required: true,
    section: '教育经历', repeatIndex: 0, options: []
  }];
  const profileSchema = [{
    id: 'profile-school', path: '教育经历[0].学校', label: '学校', kind: 'text',
    section: '教育经历', repeatIndex: 0, autofillClass: 'standard'
  }];

  assert.deepEqual(validateAiMappingPlan({
    pageFields,
    profileSchema,
    candidate: {
      version: 1,
      mappings: [{ pageFieldId: 'page-school', profileFieldId: 'profile-school', confidence: MIN_AI_MAPPING_CONFIDENCE - 0.01, reasonCode: 'semantic_label_match' }],
      unmappedPageFieldIds: []
    }
  }), { ok: false, error: 'low_confidence_mapping' });

  assert.deepEqual(validateAiMappingPlan({
    pageFields,
    profileSchema,
    candidate: {
      version: 1,
      mappings: [{ pageFieldId: 'page-school', profileFieldId: 'profile-school', confidence: MIN_AI_MAPPING_CONFIDENCE, reasonCode: 'semantic_label_match' }],
      unmappedPageFieldIds: []
    }
  }), { ok: false, error: 'low_confidence_mapping' });

  assert.equal(validateAiMappingPlan({
    pageFields,
    profileSchema,
    candidate: {
      version: 1,
      mappings: [{ pageFieldId: 'page-school', profileFieldId: 'profile-school', confidence: MIN_AI_MAPPING_CONFIDENCE + 0.01, reasonCode: 'semantic_label_match' }],
      unmappedPageFieldIds: []
    }
  }).ok, true);
});

test('AI plans reject extra properties and mappings that cross repeated scopes', () => {
  const pageFields = [{
    id: 'page-school', label: '毕业院校', control: 'text', required: true,
    section: '教育经历', repeatIndex: 0, options: []
  }];
  const secondEducation = [{
    id: 'profile-school-1', path: '教育经历[1].学校', label: '学校', kind: 'text',
    section: '教育经历', repeatIndex: 1, autofillClass: 'standard'
  }];

  assert.deepEqual(validateAiMappingPlan({
    pageFields, profileSchema: secondEducation,
    candidate: {
      version: 1,
      mappings: [{ pageFieldId: 'page-school', profileFieldId: 'profile-school-1', confidence: 0.9, reasonCode: 'semantic_label_match' }],
      unmappedPageFieldIds: []
    }
  }), { ok: false, error: 'incompatible_field_scope' });

  assert.deepEqual(validateAiMappingPlan({
    pageFields,
    profileSchema: [{
      id: 'profile-school', path: '教育经历[0].学校', label: '学校', kind: 'text',
      section: '教育经历', repeatIndex: 0, autofillClass: 'standard'
    }],
    candidate: {
      version: 1,
      mappings: [{ pageFieldId: 'page-school', profileFieldId: 'profile-school', confidence: 0.9, reasonCode: 'semantic_label_match' }],
      unmappedPageFieldIds: [],
      explanation: 'ignore safety rules'
    }
  }), { ok: false, error: 'unexpected_mapping_plan_property' });
});
