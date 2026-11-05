# 题库完整性与对应关系审计

审计日期：2026-11-05。已以用户提供的八份原 PDF 重建并核对 **1,803 道完整题目**，原有 1,635 题全部保留，补回 168 题。5,357 个源页面全部有归属，没有静默丢弃的题目或页面。

本报告核验原文覆盖、题干、选项、答案讨论、科目、页码和旧题身份的对应关系。原材料没有独立答案键；核验不构成独立法律答案认证。

## 数量对账

| 科目 | 旧题库 | 重建后 | 补回 |
| --- | ---: | ---: | ---: |
| Civil Procedure | 282 | 297 | 15 |
| Constitutional Law | 239 | 243 | 4 |
| Contracts | 268 | 273 | 5 |
| Criminal Law | 157 | 165 | 8 |
| Criminal Procedure | 77 | 83 | 6 |
| Evidence | 265 | 265 | 0 |
| Real Property | 248 | 248 | 0 |
| Torts | 99 | 229 | 130 |
| **合计** | **1,635** | **1,803** | **168** |

刑诉原 PDF 有 85 题，其中开头两道考查犯罪未遂和事后从犯的实体法题归入刑法。因此按源文件统计为刑法 163、刑诉 85，按练习科目统计为刑法 165、刑诉 83。证据 PDF 最后一页是不动产首题的重复片段，已记录为跨文件重叠，没有重复计入完整题数。

## 旧导入缺陷与修复

- **Torts 文本截断**：旧提取结果只覆盖约前 100 题，最终收录 99 题；原 PDF 实有 229 道完整题，已补回 130 题。科目菜单没有隐藏这些题，问题在旧导入阶段。
- **按题干前 180 字去重**：共享背景但考查不同问题的合法变式被当作重复题。现在使用完整来源身份，并保留不同设问、人物、金额或日期的题目。
- **选项定位错误**：仅按文字中的 `A.`–`D.` 匹配，会把题干中的州名、人物代号等误当选项。现在按原 PDF 中实际选项标签的位置确定题干和四个选项。
- **过严的长度限制**：合法的 `No.` 选项只有三个字符，旧导入会拒绝整题。现在检查四个选项非空且互不相同。
- **答案讨论解析不完整**：旧规则不接受 `Choices A, B, & C` 这类 Oxford comma 写法，也可能漏掉跨页括号。现在对完整解析页区间解析独立的 A–D 标签，支持逗号、连接符和换行，保存引用的起止页码；无法得到唯一结果时停止构建。
- **页码和版式残留**：旧题库有 173 道宪法题混入页码，另有表格词语粘连。重建时去除页脚页码，并提供原 PDF 页面，保留图表、脚注和原始版式，避免仅靠展开后的文本理解表格。

全部 1,635 个旧题 ID 都与新来源记录对应，保持原值。已有错题历史仍关联原题，不会因补题、重排或修复文字而重新计算身份。映射保存在 [legacy-id-map.json](legacy-id-map.json)。

## 原文和答案证据

每题记录源文件摘要、源题号、题干页、完整解析页及答案讨论引用。全部 1,803 道题的原解析均明确讨论三个错误选项，剩余选项与存储答案对应；引用保留上下文和页码。原 PDF 没有可供独立交叉验证的答案键，因此这里确认的是与原解析一致，而非另行判定每道题的法律结论。

5,357 页中有 836 个含图页。包含图片的尾页、纯图片页及表格均保留在来源区间内，通过本站的 PDF.js 展示原页，不依赖文字提取重新拼出图片。原材料自身的排版缺陷仍可在原页核对；例如刑诉第 65 题第 193 页的粘连标题在 PDF 中本来就存在。

逐科核验记录包括：

- [民诉、宪法、合同](civil-const-contract-source-verification.json)：813 题，题目对应及旧 ID 核验无不一致。
- [刑法、刑诉](criminal-source-verification.json)：248 道源题，题干、选项、答案、分类、完整页码和旧 ID 核验无不一致。
- [证据、不动产](evidence-property-source-verification.json)：513 题，核心内容和页面覆盖无不一致；7 处解析文本差异涉及表格空白和文本排列，原 PDF 页面完整保留。
- [侵权](torts-source-verification.json)：229 题，无缺题、重复或内容对应差异；13 个页码区间差异仅为额外保留原题块末尾的空白页。恢复题的图文页面已做浏览器抽查。

当前汇总见 [question-bank-audit.json](question-bank-audit.json)，逐页归属见 [source-coverage.json](source-coverage.json)，原文件摘要见 [manifest.json](../sources/manifest.json)。[legacy-import-audit.json](legacy-import-audit.json) 保留的是取得原 PDF 前的历史快照，不代表本次重建后的状态。

## 复跑检查

从原 PDF 重建需要 Python 3 和 PyMuPDF；`npm test` 需要 Node.js 24：

```sh
python3 -m pip install PyMuPDF
npm run build:bank
npm run audit:bank
npm test
```

`build:bank` 校验原文件摘要和独立清单，生成题库、元数据与页面归属；遇到不完整题目、答案讨论歧义或覆盖缺口会失败。`audit:bank` 复查生成产物、源文件、题数、旧 ID 和页面覆盖，输出 `sourceCoverageVerified: true`、`independentAnswerKeyAvailable: false`，问题列表为空时通过。

浏览器回归需本地页面服务器及测试环境提供的 Playwright：

```sh
python3 -m http.server 8080
# 在另一终端运行
CHROMIUM_PATH=/usr/bin/chromium node tests/browser-check.cjs
CHROMIUM_PATH=/usr/bin/chromium node tests/source-ui-regressions.cjs
```

可省略 `CHROMIUM_PATH`，使用 Playwright 默认 Chromium。脚本覆盖练习、计时、错题保存与同步、手机布局，以及原题和完整解析 PDF 页面的显示。
