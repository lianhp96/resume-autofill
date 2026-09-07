(function initResumeTemplate(root, factory) {
  const exported = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
  if (root) root.ResumeTemplate = exported;
})(typeof globalThis !== 'undefined' ? globalThis : null, () => {
  'use strict';

  // Fields observed across campus-application forms. Values deliberately start
  // empty: the template must never invent personal information for a user.
  const ONLINE_APPLICATION_FIELD_DEFAULTS = Object.freeze({
    '民族': '',
    '户籍地址': '',
    '身高': '',
    '体重': '',
    '健康状况': '',
    '婚姻状况': '',
    '现住址': '',
    '党组织关系所在地': '',
    '兴趣爱好': '',
    '期望城市': '',
    '期望薪资': '',
    '外语水平': ''
  });

  const EDUCATION_FIELD_DEFAULTS = Object.freeze({
    '学位': '',
    'GPA': '',
    '专业排名': ''
  });

  const FAMILY_MEMBER_FIELD_DEFAULTS = Object.freeze({
    '_rowName': '家庭成员',
    '姓名': '',
    '关系': '',
    '工作单位': '',
    '职位': '',
    '联系电话': ''
  });

  function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function createFamilyMemberTemplate() {
    return { ...FAMILY_MEMBER_FIELD_DEFAULTS };
  }

  function applyOnlineApplicationTemplate(resume) {
    const source = isPlainObject(resume) ? resume : {};
    const education = Array.isArray(source['教育经历'])
      ? source['教育经历'].map(entry => ({
        ...EDUCATION_FIELD_DEFAULTS,
        ...(isPlainObject(entry) ? entry : {})
      }))
      : [];

    return {
      ...source,
      '网申补充信息': {
        ...ONLINE_APPLICATION_FIELD_DEFAULTS,
        ...(isPlainObject(source['网申补充信息']) ? source['网申补充信息'] : {})
      },
      '教育经历': education,
      '家庭状况': Array.isArray(source['家庭状况']) ? source['家庭状况'] : []
    };
  }

  return {
    ONLINE_APPLICATION_FIELD_DEFAULTS,
    EDUCATION_FIELD_DEFAULTS,
    applyOnlineApplicationTemplate,
    createFamilyMemberTemplate
  };
});
