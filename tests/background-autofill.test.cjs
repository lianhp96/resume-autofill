const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');

const AutofillPlanner = require('../autofill-planner.js');
const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const LLM_STORAGE_KEY = 'autumnRecruitmentTracker.llm.v1';

function createBackgroundHarness({ modelContent }) {
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
    URL,
    chrome,
    clearTimeout,
    console,
    crypto: webcrypto,
    importScripts() {},
    performance,
    self: { AutofillPlanner, crypto: webcrypto },
    setTimeout,
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: modelContent } }] };
        }
      };
    }
  };
  vm.runInNewContext(source, context, { filename: 'background.js' });

  return {
    requests,
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
  assert.deepEqual(JSON.parse(JSON.stringify(response.plan.mappings)), [{
    pageFieldId: 'page-private-local-id',
    profileFieldId: 'profile:作品[0].链接',
    confidence: 0.9,
    reasonCode: 'semantic_label_match',
    source: 'ai'
  }]);
});

test('invalid AI output degrades to deterministic mappings without reuse of their profile fields', async () => {
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
  assert.deepEqual(response.plan.mappings, [{
    pageFieldId: 'page-name',
    profileFieldId: 'profile-name',
    confidence: 1,
    reasonCode: 'exact_label_match',
    source: 'local-rule'
  }]);
  assert.deepEqual(response.plan.unmappedPageFieldIds, ['page-homepage']);
  const remoteProfileLabels = JSON.parse(harness.requests[0].messages[1].content).profileFields.map(field => field.label);
  assert.deepEqual(remoteProfileLabels, ['作品链接']);
});
