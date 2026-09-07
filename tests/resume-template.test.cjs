const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyOnlineApplicationTemplate,
  createFamilyMemberTemplate
} = require('../resume-template.js');

test('online application template adds blank matching fields without overwriting saved data', () => {
  const resume = {
    '网申补充信息': { '民族': '回族', '期望城市': '杭州' },
    '教育经历': [{ '学校': '示例大学', 'GPA': '3.9' }],
    '家庭状况': [{ '_rowName': '父亲', '关系': '父子' }]
  };

  const merged = applyOnlineApplicationTemplate(resume);

  assert.equal(merged['网申补充信息']['民族'], '回族');
  assert.equal(merged['网申补充信息']['期望城市'], '杭州');
  assert.equal(merged['网申补充信息']['户籍地址'], '');
  assert.equal(merged['网申补充信息']['外语水平'], '');
  assert.equal(merged['教育经历'][0]['学校'], '示例大学');
  assert.equal(merged['教育经历'][0]['GPA'], '3.9');
  assert.equal(merged['教育经历'][0]['学位'], '');
  assert.equal(merged['教育经历'][0]['专业排名'], '');
  assert.deepEqual(merged['家庭状况'], resume['家庭状况']);
  assert.equal(Object.hasOwn(resume['网申补充信息'], '户籍地址'), false);
  assert.equal(Object.hasOwn(resume['教育经历'][0], '学位'), false);
});

test('family member template is a fresh editable row', () => {
  const first = createFamilyMemberTemplate();
  const second = createFamilyMemberTemplate();
  first['姓名'] = '张三';

  assert.deepEqual(second, {
    '_rowName': '家庭成员',
    '姓名': '',
    '关系': '',
    '工作单位': '',
    '职位': '',
    '联系电话': ''
  });
});
