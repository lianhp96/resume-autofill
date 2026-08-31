# Upstream 一键填入技术方案（`ljkss/autumn-job-assistant-tracker`）

研究范围：仅覆盖上游仓库的“一键填充当前页面”。已于 2026-08-30 核验 GitHub 默认分支为 `main`，其 HEAD 为 [`a24b328aef7d62bf81ee4d4581b701a45ebe848e`](https://github.com/ljkss/autumn-job-assistant-tracker/commit/a24b328aef7d62bf81ee4d4581b701a45ebe848e)；下文所有源码链接均固定至该提交。结论基于该仓库的 README、Manifest、源代码及提交；未执行仓库中的任何指令。

## 结论

上游采用的是**通用启发式填表器**，不是按招聘站拆分的 Adapter 架构：内容脚本在所有 HTTP(S) 页面注入一个 Shadow DOM 侧栏；用户显式点击按钮后，脚本读取本地简历，将其扁平化和派生，再扫描可见控件，通过标签/属性的同义词规则找值并尝试写入。它覆盖原生控件和一组常见 UI 库选择器，但没有“飞书/北森/Moka…”各自独立的 DOM Adapter、字段置信度模型或写后验证。上游自己也在 UI 和 README 中提示功能不完善、需要逐项核对。[实现](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1351-L2103) [README](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/README.md#L24-L25)

## 架构与触发

- Manifest V3 以 `content.js` 在 `document_end` 注入所有 `http(s)` 页面；扩展还拥有 `storage`、`tabs`、`activeTab` 与 `scripting` 权限。[manifest](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/manifest.json#L1-L52)
- `content.js` 在宿主页挂载 `#autumn-job-assistant-host` 和 open Shadow Root，因此侧栏样式与网站隔离；一键填充是侧栏中的 `#aja-autofill-btn`，用户点击后调用 `autoFillPageForm()`。这不是页面加载时自动执行。[侧栏与按钮](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1-L104) [绑定](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1929-L2103)
- 同一侧栏还保留“先聚焦字段、再点击简历条目”的精确手动路径：保存当前焦点和选区，调用原生 value setter、派发 `input/change`；失败时写剪贴板。这条路径与批量扫描共用同一份简历资料。[直接插入](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L82-L102) [写入逻辑](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1209-L1285)

## 存储与资料模型

- 主键为 `autumnRecruitmentTracker.resume.v1`，资料保存于 `chrome.storage.local`；content script 初次加载并订阅 `chrome.storage.onChanged`，看板保存后侧栏即时刷新。[content storage](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L8-L82) [同步](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L739-L763)
- Schema 是开放的中文分组对象：`优先信息`、`基本信息`、`竞赛与技能` 为键值对象；`教育经历`、`实习经历`、`项目经历` 为对象数组，其中 `_rowName` 是展示标签。看板允许新增/删除任意键和经历条目，并支持 JSON 导入/导出；因此字段库可由用户扩展。[默认模型](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/background.js#L8-L80) [编辑与保存](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/dashboard.js#L498-L725) [导入导出](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/dashboard.js#L727-L768)
- 看板另将“投递记录 + 简历”做 IndexedDB 快照用于恢复；这属于资料安全能力，不是填表事务或字段回滚机制。[快照](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/dashboard.js#L141-L176)

## 扫描与匹配

1. `buildResumeFlatMap()` 首先收集所有非空自定义键；数组第 0 项同时作为无后缀的默认值，所有数组项都有 `${key}_${index}` 键。随后派生姓名拆分、生日、身份证衍生生日、地点、紧急联系人、英语成绩和最高学历/本科教育字段，并补入一批 ATS 默认答案（例如民族、婚姻、调剂、到岗时间、渠道）。[扁平化与派生](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1443-L1691)
2. `extractFieldLabel()` 按优先顺序读取 ATS 风格 data 属性、`name/id/aria-label/placeholder/title`、`label[for]`、`aria-labelledby`、最近表单容器的 label/title，以及前序兄弟文本；清洗必填标记与提示词后返回**第一个**可用候选标签。[标签提取](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1693-L1727)
3. `findMatchedResumeValue()` 先按简历键名的相等/包含匹配，再按中文/英文正则同义词表匹配。表覆盖个人、证件、联系方式、住址、教育、技能、经历和开放题；没有分数、冲突消解或“低置信待确认”分支。[同义词表](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1352-L1441) [匹配函数](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1729-L1766)

## 写入、保护与反馈

- 阶段一扫描可见、未禁用的 `input, textarea, select`，排除 hidden、submit、button、reset、image、file 及侧栏自身。已有文本值和已选原生 select 会跳过；普通输入用原生原型的 setter（React/Vue 受控组件兼容手段）再派发 `input/change`。没有扫描 `contenteditable`，没有验证码/敏感信息禁止清单，也不会阻止同义词表中已有的身份证、政治面貌、民族、婚姻等字段写入。[扫描与文本写入](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1947-L2040)
- Radio 以 `name` 去重，遍历组内成员，用“字段标签或 radio value 与资料值互相包含/相等”决定勾选；原生 select 用 option 文本/value 的相等或包含匹配后设置 `selectedIndex`。Checkbox 未单独处理，因而会作为普通 input 被写 `value` 而不会勾选。[radio/select](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1966-L2013) [原生 select helper](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1911-L1927)
- 阶段二不是站点 Adapter，而是通用的 Ant Design、Element、ARIA combobox/listbox、名称含 select/trigger 的 wrapper，以及 readonly input 选择器；脚本模拟鼠标点击，等待 130ms，若存在搜索框则输入，再从可见下拉中按文本精确或包含匹配点击选项。[自定义下拉](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1769-L1910) [阶段二](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L2049-L2089)
- 计数是“已写入/跳过”总数 toast；它不逐字段展示标签、来源、失败原因或验证状态。代码写入后不读取 DOM 或应用状态来确认成功，也不触发 submit。[反馈](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L2091-L2103)

## 站点适配与验证现状

- 注释宣称“深度适配北森/Moka/大易/用友/24Talent/大厂门户”，实现证据实际为它们可能使用的 class/data 属性和通用下拉 selector；仓库中没有单独的站点 Adapter 模块、URL 路由、页面 fixture 或针对飞书招聘的选择器。因此飞书适配仍需以其真实 DOM 建立 Adapter，不能把上游的泛化 selector 当作已验证的飞书方案。[声明与实现位置](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1351-L1352) [容器 selector](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1693-L1714) [dropdown selector](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L2049-L2065)
- 仓库根目录只含扩展脚本、样式、图标、OCR 资源与文档，未见测试目录、fixture、自动化测试或成功率结果；README 同样只要求用户逐项核对。因此其验证策略目前是人工复核，而非可复现的自动化验证。[文件树](https://github.com/ljkss/autumn-job-assistant-tracker/tree/a24b328aef7d62bf81ee4d4581b701a45ebe848e) [README 警告](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/README.md#L24-L25)

## 相关提交（上游时区 +08:00）

| 日期 | 提交 | 影响 |
| --- | --- | --- |
| 2026-08-29 22:29 | [`1bd1892` — `auto write`](https://github.com/ljkss/autumn-job-assistant-tracker/commit/1bd1892ceb15f39f7882a9104b0da5b15686caf1) | 引入侧栏按钮与大部分扫描、匹配、原生/自定义控件写入逻辑。 |
| 2026-08-29 22:34 | [`8e5a9af` — `warning text`](https://github.com/ljkss/autumn-job-assistant-tracker/commit/8e5a9af538bd7fbadb2f11c4fd4e34e5f025275b) | 在按钮下增加“功能不完善，请逐条核对”。 |
| 2026-08-30 15:59 | [`a24b328` — `readme+auto write`](https://github.com/ljkss/autumn-job-assistant-tracker/commit/a24b328aef7d62bf81ee4d4581b701a45ebe848e) | README 升至 v2.1 并记录一键填充；本报告固定到这一提交。 |

## 可借鉴与不宜照搬

值得复用的是：用户显式触发、简历扁平化/字段派生、原生 setter + 事件、对原生与自定义下拉分阶段处理、以及手动“聚焦后点字段”回退路径。不要原样采用的是：会填入敏感字段和默认答案的宽松资料策略、无置信度的“包含”匹配、没有写后验证的计数，以及把 UI 库 selector 称作站点适配。对于飞书，应单列 `FeishuAdapter`：用真实题目容器定位字段，针对其组合框/单选项交互写入，写后读取组件状态验证，并逐题报告成功、待确认或跳过原因。
