# 上游自动填写方案与稳定性评估

研究对象：[`ljkss/autumn-job-assistant-tracker`](https://github.com/ljkss/autumn-job-assistant-tracker)，核验于 2026-09-02。默认分支 `main` 的 HEAD 为 [`a24b328`](https://github.com/ljkss/autumn-job-assistant-tracker/commit/a24b328aef7d62bf81ee4d4581b701a45ebe848e)；以下源码链接均固定到该提交。

## 结论

这是一套**跨站点的启发式半自动填表器**，并非对具体招聘站建立、持续维护的 Adapter。它对简单、静态、原生控件页面可用；对 React/Vue 控件做了合理的事件兼容，但整体稳定性只有**中低**：页面 DOM、文案、组件库、异步加载或选项文本有变化时，都可能漏填或误填。上游也明确标注“功能不完善，请逐条核对”。[UI 警告](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L590-L595) [README](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/README.md#L24-L25)

更适合把它定位为“先填可确认字段、人工复核后提交”的效率工具，不能作为可靠的无人值守投递自动化。

## 方案拆解

1. **加载和资料来源。** MV3 content script 在所有 HTTP(S) 页面 `document_end` 注入；侧栏以 open Shadow DOM 挂载。简历存于 `chrome.storage.local`，资料变更通过 `storage.onChanged` 更新侧栏。[manifest](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/manifest.json#L11-L38) [挂载与读取](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L106-L110) [同步](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L739-L763)
2. **资料模型。** 编辑器维护自由的中文键值分组和经历数组；填表时将所有非空字段扁平化，数组第一项成为无下标默认值，并派生姓名、出生日期等字段。这方便扩展，但没有“表单第 N 段经历 ↔ 简历第 N 段经历”的明确绑定或站点字段映射。[编辑器](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/dashboard.js#L498-L558) [扁平化](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1443-L1467)
3. **字段识别。** `extractFieldLabel` 依次使用 data/name/id/ARIA/placeholder、`label[for]`、祖先容器类名和前序兄弟文本；`findMatchedResumeValue` 再按键名包含或中文/英文同义词正则表选择第一个值。所谓“北森/Moka/大易…”主要体现为属性、类名和通用控件选择器，而非独立的站点模块或 URL 路由。[标签抽取](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1649-L1727) [匹配](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1729-L1758) [声明](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1351-L1440)
4. **写入。** 点击按钮后，阶段一遍历可见的 `input/textarea/select`：非空文本和已有选择会跳过，空文本以原生 `value` setter 写入并派发 `input/change`；radio 按组尝试勾选。阶段二以 Ant Design、Element、ARIA 和含 `select/trigger` 的 class 为线索，模拟点击、固定等待 130ms、以选项文本精确或包含匹配后点击。[主循环](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1929-L2042) [自定义下拉](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1761-L1903) [包装器选择器](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L2044-L2089)

## 稳定性判断

| 维度 | 证据 | 判断 |
| --- | --- | --- |
| 原生输入与受控框架 | 原生 setter 加 `input/change` 能覆盖不少 React/Vue 受控输入；但写后只增加计数，不读回 DOM/应用状态验证。 | 中等：基础场景实用，失败会被当作“已填”。 |
| 字段匹配 | 标签只采用候选列表中第一个可用文本，键名/正则采用 `includes`，没有字段置信度、冲突消解或待确认队列。 | 低：相似字段（住址、学校、经历、开放题）有误配风险。 |
| 下拉/级联 | 依赖 class、ARIA 和固定 130/150ms 延时；把最后一个可见浮层当作目标；级联只点击一个文本选项。 | 低：网络慢、动画、portal、多开浮层、虚拟列表和省市两级选择都易失效。 |
| SPA/动态表单 | 内容脚本只在 `document_end` 注入，自动填充只在按钮点击时一次性扫描；源码未使用 `MutationObserver`、路由 hook 或重试等待。 | 中低：用户等页面稳定后再点可缓解；异步分步表单、字段后插入或页面重渲染没有恢复机制。 |
| 可回归性 | 仓库文件树没有测试目录、页面 fixture、端到端脚本或按站成功率；自动填充主要由一次 831 行新增提交引入。 | 低：上游变更或 ATS 改版时缺乏报警和回归保护。 |

## 风险与现有保护

- 正向保护：必须由用户点击触发；不会覆盖已有文本或已有原生 select 值；不自动提交表单。[触发与跳过规则](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1929-L1939) [跳过](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1996-L2022)
- 缺口：没有 checkbox 专项逻辑（会落入普通 input 的 value 写入路径），没有 `contenteditable` 的批量扫描，也没有验证码、证件号、政治面貌、民族、婚姻等敏感项的默认跳过清单；同义词表反而显式覆盖其中多个字段。[扫描范围](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1947-L1964) [敏感字段规则](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1358-L1379)
- 更严重的是，资料缺失时引擎会自行补入“汉族、未婚、共青团员、全日制统招、服从调剂、随时到岗、应届生、邮编 100000、全国、固定应聘理由”等申请答案，而不是跳过字段。这会将假设写入正式申请，属于高正确性风险。[ATS 默认答案](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L1632-L1644)
- 首次安装会写入含示例身份证、手机、邮箱的默认简历；若用户未先替换，自动填充可能把示例值带入页面。扩展虽宣称本地存储，但权限范围为 `http://*/*`、`https://*/*` 及 `file:///*`，部署面较宽。[默认资料](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/content.js#L15-L80) [安装初始化](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/background.js#L103-L110) [权限](https://github.com/ljkss/autumn-job-assistant-tracker/blob/a24b328aef7d62bf81ee4d4581b701a45ebe848e/manifest.json#L11-L21)

## 采用建议

若要用于实际网申，建议保留“用户触发 + 不提交”的边界，并改为按域名的 Adapter：用稳定语义/测试 ID 定位题目，等待控件可交互后写入，读取组件状态做逐字段验证，给出“成功 / 待确认 / 跳过原因”。默认禁填敏感字段、验证码、承诺类和开放题；每个 ATS 建立 HTML fixture 与端到端回归测试。通用启发式可仅作最后的低置信度建议，不能作为主路径。
