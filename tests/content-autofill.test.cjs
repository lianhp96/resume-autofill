const test = require('node:test');
const assert = require('node:assert/strict');

const { buildAutofillPlanningPayload } = require('../content.js');

test('buildAutofillPlanningPayload sends value-free field descriptors to the planner endpoint', () => {
  const calls = [];
  const planner = {
    collectPageFields(documentRef) {
      calls.push(['collectPageFields', documentRef]);
      return [{ id: 'page:0', label: '毕业院校', control: 'text' }];
    },
    buildProfileSchema(resume) {
      calls.push(['buildProfileSchema', resume]);
      return [{ id: 'profile:教育经历[0].学校', path: '教育经历[0].学校', label: '学校', kind: 'text', autofillClass: 'standard' }];
    },
    buildFormFingerprint(input) {
      calls.push(['buildFormFingerprint', input]);
      return 'form:v1:abc123';
    }
  };
  const documentRef = { marker: 'document' };
  const locationRef = { origin: 'https://jobs.example.test', pathname: '/apply/123', search: '?token=secret' };
  const resume = { 教育经历: [{ 学校: '浙江大学' }] };

  const payload = buildAutofillPlanningPayload({ planner, documentRef, locationRef, resume });

  assert.deepEqual(payload, {
    fingerprint: 'form:v1:abc123',
    pageFields: [{ id: 'page:0', label: '毕业院校', control: 'text' }],
    profileSchema: [{ id: 'profile:教育经历[0].学校', path: '教育经历[0].学校', label: '学校', kind: 'text', autofillClass: 'standard' }]
  });
  assert.deepEqual(calls, [
    ['collectPageFields', documentRef],
    ['buildProfileSchema', resume],
    ['buildFormFingerprint', { location: locationRef, fields: payload.pageFields }]
  ]);
});
