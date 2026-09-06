const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const AutofillPlanner = require('../autofill-planner.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const LLM_STORAGE_KEY = 'autumnRecruitmentTracker.llm.v1';

function createBackgroundHarness({ modelContent, stallUntilAbort = false, failJsonMode = false }) {
  const storage = {
    [LLM_STORAGE_KEY]: {
      enabled: true,
      baseUrl: 'https://example.test/v1',
      apiKey: 'test-key',
      model: 'test-model'
    }
  };
  let messageListener;
  const requests = [];
  const timeoutBudgets = [];
  const chrome = {
    runtime: {
      getURL: file => `chrome-extension://test/${file}`,
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { messageListener = listener; } }
    },
    storage: {
      local: {
        async get(keys) {
          return Object.fromEntries((Array.isArray(keys) ? keys : [keys])
            .filter(key => key in storage)
            .map(key => [key, storage[key]]));
        },
        async set(values) { Object.assign(storage, values); }
      }
    },
    tabs: { async query() { return []; }, async create() {}, async update() {} },
    windows: { async update() {} }
  };
  const context = {
    AbortController,
    Array,
    Date,
    Error,
    JSON,
    Map,
    Math,
    Object,
    Promise,
    RegExp,
    Set,
    String,
    TextEncoder,
    URL,
    chrome,
    clearTimeout,
    console,
    crypto: webcrypto,
    importScripts() {},
    performance,
    self: { AutofillPlanner, crypto: webcrypto },
    setTimeout(callback, delay) {
      timeoutBudgets.push(delay);
      return setTimeout(callback, stallUntilAbort ? 0 : delay);
    },
    fetch: async (_url, options) => {
      const requestBody = JSON.parse(options.body);
      requests.push(requestBody);
      if (stallUntilAbort) {
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
        });
      }
      if (failJsonMode && requestBody.response_format) {
        return {
          ok: false,
          status: 400,
          async text() { return '<html>json mode unsupported</html>'; }
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            choices: [{ message: { content: modelContent }, finish_reason: 'stop' }],
            usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
            model: 'test-model'
          });
        }
      };
    }
  };
  vm.runInNewContext(source, context, { filename: 'background.js' });

  return {
    requests,
    timeoutBudgets,
    getLogs() { return storage['autumnRecruitmentTracker.llmLogs.v1'] || []; },
    async plan(request) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('background response timed out')), 1000);
        const returned = messageListener({ type: 'PLAN_AUTOFILL_LLM', ...request }, {}, response => {
          clearTimeout(timer);
          resolve(response);
        });
        assert.equal(returned, true);
      });
    }
  };
}

test('AI mapping request uses anonymous IDs and restores them locally', async () => {
  const harness = createBackgroundHarness({
    modelContent: JSON.stringify({
      version: 1,
      mappings: [{ pageFieldId: 'page_0', profileFieldId: 'profile_0', confidence: 0.9, reasonCode: 'semantic_label_match' }],
      unmappedPageFieldIds: []
    })
  });

  const response = await harness.plan({
    fingerprint: 'form:v1:abc123',
    pageFields: [{ id: 'page-private-local-id', label: '个人主页', control: 'text', section: '', repeatIndex: null }],
    profileSchema: [{ id: 'profile:作品[0].链接', path: '作品[0].链接', label: '作品链接', kind: 'text', section: '', repeatIndex: null, autofillClass: 'standard' }]
  });

  const payload = JSON.stringify(harness.requests[0]);
  assert.equal(payload.includes('page-private-local-id'), false);
  assert.equal(payload.includes('profile:作品[0].链接'), false);
  assert.equal(payload.includes('form:v1:abc123'), false);
  assert.doesNotMatch(harness.requests[0].messages[0].content, /0\.85|0\.95/);
  assert.deepEqual(JSON.parse(JSON.stringify(response.plan.mappings)), [{
    pageFieldId: 'page-private-local-id',
    profileFieldId: 'profile:作品[0].链接',
    confidence: 0.9,
    reasonCode: 'preview_match',
    source: 'ai'
  }]);
  const log = harness.getLogs()[0];
  assert.match(log.requestContent, /字段映射助手/);
  assert.match(log.requestContent, /个人主页/);
  assert.equal(log.requestContent.includes('page-private-local-id'), false);
  const loggedRequest = JSON.parse(log.requestContent);
  const loggedResponse = JSON.parse(log.responseContent);
  assert.equal(loggedRequest.model, 'test-model');
  assert.equal(loggedRequest.temperature, 0);
  assert.deepEqual(loggedRequest.response_format, { type: 'json_object' });
  assert.equal(loggedRequest.apiKey, undefined);
  assert.equal(log.requestContent.includes('test-key'), false);
  assert.equal(JSON.parse(loggedResponse.choices[0].message.content).mappings[0].confidence, 0.9);
  assert.equal(loggedResponse.choices[0].finish_reason, 'stop');
  assert.equal(loggedResponse.usage.total_tokens, 150);
  assert.equal(log.confidenceThreshold, 0.85);
  assert.equal(log.candidateMappingCount, 1);
  assert.equal(log.acceptedMappingCount, 1);
});

test('unusable AI output leaves all fields unmapped instead of falling back to local mappings', async () => {
  const harness = createBackgroundHarness({ modelContent: 'Here is the requested JSON: {}' });
  const response = await harness.plan({
    pageFields: [
      { id: 'page-name', label: '姓名', control: 'text', section: '', repeatIndex: null },
      { id: 'page-homepage', label: '个人主页', control: 'text', section: '', repeatIndex: null }
    ],
    profileSchema: [
      { id: 'profile-name', path: '基本信息.姓名', label: '姓名', kind: 'text', section: '', repeatIndex: null, autofillClass: 'standard' },
      { id: 'profile-homepage', path: '作品.链接', label: '作品链接', kind: 'text', section: '', repeatIndex: null, autofillClass: 'standard' }
    ]
  });

  assert.equal(response.ok, true);
  assert.equal(response.degraded, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.plan.mappings)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(response.plan.unmappedPageFieldIds)), ['page-name', 'page-homepage']);
  const remoteProfileLabels = JSON.parse(harness.requests[0].messages[1].content).profileFields.map(field => field.label);
  assert.deepEqual(remoteProfileLabels, ['姓名', '作品链接']);
  assert.equal(harness.getLogs()[0].attemptCount, 1);
});

test('read-only preview keeps repeated sources but leaves low or missing confidence mappings blank', async () => {
  const harness = createBackgroundHarness({
    modelContent: '```json\n' + JSON.stringify({
      mappings: [
        { pageFieldId: 'page_0', profileFieldId: 'profile_0', confidence: 0.3 },
        { pageFieldId: 'page_1', profileFieldId: 'profile_0', confidence: 0.85 },
        { pageFieldId: 'page_2', profileFieldId: 'profile_0' },
        { pageFieldId: 'page_unknown', profileFieldId: 'profile_0' },
        { pageFieldId: 'page_3', profileFieldId: 'profile_unknown' }
      ],
      unmappedPageFieldIds: ['page_0', 'page_1', 'page_2']
    }) + '\n```'
  });
  const response = await harness.plan({
    pageFields: [
      { id: 'p0', label: '工作手机', control: 'text', section: '工作', repeatIndex: 0 },
      { id: 'p1', label: '备用手机', control: 'tel', section: '联系', repeatIndex: 1 },
      { id: 'p2', label: '联系手机', control: 'select' },
      { id: 'p3', label: '兴趣爱好', control: 'text' }
    ],
    profileSchema: [{ id: 'phone', path: '基本信息.手机', label: '手机', kind: 'text',
      section: '基本信息', autofillClass: 'never', value: '13800138000' }]
  });
  assert.equal(response.ok, true);
  assert.equal(response.degraded, undefined);
  assert.equal(response.plan.previewOnly, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.plan.mappings.map(m => [m.pageFieldId, m.profileFieldId]))),
    [['p1', 'phone']]);
  assert.deepEqual(JSON.parse(JSON.stringify(response.plan.unmappedPageFieldIds)), ['p0', 'p2', 'p3']);
  assert.equal(JSON.stringify(harness.requests).includes('13800138000'), false);
  assert.equal(JSON.stringify(harness.requests).includes('基本信息.手机'), false);
});

test('preview calls AI above former field limits and for consecutive requests', async () => {
  const harness = createBackgroundHarness({ modelContent: '{"mappings":[]}' });
  const request = {
    pageFields: Array.from({ length: 81 }, (_, i) => ({ id: `p${i}`, label: '目标岗位', control: 'text' })),
    profileSchema: Array.from({ length: 121 }, (_, i) => ({ id: `r${i}`, label: '岗位', kind: 'text', autofillClass: 'standard' }))
  };
  for (let i = 0; i < 2; i++) {
    const response = await harness.plan(request);
    assert.equal(response.degraded, undefined);
    assert.equal(response.plan.unmappedPageFieldIds.length, 81);
  }
  assert.equal(harness.requests.length, 2);
});

test('mapping logs every request and raw response when JSON mode falls back', async () => {
  const harness = createBackgroundHarness({ modelContent: '{"mappings":[]}', failJsonMode: true });
  const response = await harness.plan({
    pageFields: [{ id: 'page-name', label: '姓名', control: 'text' }],
    profileSchema: [{ id: 'profile-name', label: '姓名', kind: 'text', autofillClass: 'standard' }]
  });

  assert.equal(response.ok, true);
  const log = harness.getLogs()[0];
  assert.equal(log.attempts.length, 2);
  assert.equal(JSON.parse(log.attempts[0].requestContent).response_format.type, 'json_object');
  assert.equal(log.attempts[0].responseContent, '<html>json mode unsupported</html>');
  assert.equal(JSON.parse(log.attempts[1].requestContent).response_format, undefined);
  assert.equal(JSON.parse(log.attempts[1].responseContent).usage.total_tokens, 150);
});

test('mapping timeout uses a 30-second budget, leaves fields blank and records one attempt', async () => {
  const harness = createBackgroundHarness({ stallUntilAbort: true });
  const response = await harness.plan({
    pageFields: [
      { id: 'page-name', label: '姓名', control: 'text' },
      { id: 'page-homepage', label: '个人主页', control: 'text' }
    ],
    profileSchema: [
      { id: 'profile-name', label: '姓名', kind: 'text', autofillClass: 'standard' },
      { id: 'profile-homepage', label: '作品链接', kind: 'text', autofillClass: 'standard' }
    ]
  });
  assert.equal(harness.timeoutBudgets.length, 1);
  assert.ok(harness.timeoutBudgets[0] > 29000 && harness.timeoutBudgets[0] <= 30000);
  assert.equal(harness.requests.length, 1);
  assert.equal(response.ok, true);
  assert.equal(response.degraded, true);
  assert.deepEqual(JSON.parse(JSON.stringify(response.plan.mappings)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(response.plan.unmappedPageFieldIds)), ['page-name', 'page-homepage']);
  assert.match(response.message, /超时（30 秒）.*未生成字段映射/);
  const log = harness.getLogs()[0];
  assert.equal(log.kind, 'autofill_plan');
  assert.equal(log.status, 'timeout');
  assert.equal(log.attemptCount, 1);
  assert.match(log.error, /超时（30 秒）/);
  assert.equal(log.attempts.length, 1);
  assert.equal(JSON.parse(log.attempts[0].requestContent).response_format.type, 'json_object');
  assert.equal(log.attempts[0].responseContent, '');
  assert.match(log.requestContent, /字段映射助手/);
});
