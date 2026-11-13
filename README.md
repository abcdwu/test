# MBE 练习室

GitHub Pages 提供页面，Fly.io 提供可选的私人错题同步 API；无需 Cloudflare 或邮件服务。前端不需要构建，后端只使用 Node.js 24 内置模块，无第三方运行依赖。

## 本地预览和验证

```sh
python3 -m http.server 8080
```

打开 `http://localhost:8080`。在另一终端运行以下检查；测试需要 Node.js 24，题库审计需要 Python 3：

```sh
npm run audit:bank
npm test
```

审计核对原 PDF 摘要、题目和页面覆盖、答案引用及旧题 ID。程序测试验证八科题数、稳定 ID、计时、错题合并、备份、API 登录、拒绝未授权访问及 SQLite 重启恢复。

从仓库中的八份原 PDF 重新生成题库需要 [PyMuPDF](https://pypi.org/project/PyMuPDF/)；普通预览和运行前端不需要它：

```sh
python3 -m pip install PyMuPDF
npm run build:bank
npm run audit:bank
npm test
```

浏览器回归脚本使用 Playwright（测试环境自行提供）和正在运行的本地页面服务器：

```sh
CHROMIUM_PATH=/usr/bin/chromium node tests/browser-check.cjs
CHROMIUM_PATH=/usr/bin/chromium node tests/source-ui-regressions.cjs
CHROMIUM_PATH=/usr/bin/chromium node tests/progress-browser.cjs
CHROMIUM_PATH=/usr/bin/chromium node tests/loading-browser.cjs
```

省略 `CHROMIUM_PATH` 则使用 Playwright 默认安装的 Chromium。脚本验证八科筛选、正计时、倒计时自动交卷、刷新保留、错题重练、导出恢复、手机布局、多标签页并发、密码登录、断网后补传、跨设备恢复，以及原题和解析 PDF 页面的加载与显示。

## 练习

八科下拉菜单包含民事诉讼法、宪法、合同法、刑法、刑事诉讼法、证据法、不动产法和侵权法，也可选择混合全部科目。每组可选 5、10、15、20 题；题目不足时使用实际数量。

首页只读取约 1.5 KB 的科目清单，默认按单科练习；点击开始后才下载本科目，当前每科约 98–302 KB。混合练习首次需准备八科，下载并发限制为两个科目。题干、选项、答案、完整解析文字、稳定 ID 和 PDF 页码都保留；去掉的仅是审计用途的重复引用上下文，完整审计原库仍为 `questions.txt`。

GitHub Pages 是主下载源，600 ms 后仍未完成时才尝试现有东京 Fly.io 备用源，先通过完整性校验的结果生效，取消其他请求。Fly 不可用时不会拖住可用的 GitHub 下载。每条线路超时 12 秒；已校验的科目存入独立 IndexedDB 缓存，之后无需重复下载，两个下载源都失败时仍可使用已缓存科目。缓存不可用或已满不阻止正常联网练习。科目清单失败可重试，单科失败可单独重试。

备用完整网站为 `https://abcdwu-mbe-mistakes.fly.dev/`，包含相同页面、题库、PDF 和本地 PDF.js 资源；HTML 与科目清单使用可重新验证的缓存策略。原始 PDF 支持 Range 分段读取，页面也提供备用 PDF 链接。两个域名的本机数据独立，同一密码登录后读取同一个云端错题本；本机尚未同步的数据不会因换域名自动搬迁，请保留原站点数据。不得为了排查网络问题清空浏览器数据。

运行 `npm run build:client-bank` 可以从已审计原库重新生成科目文件和摘要清单；`npm run build:bank` 也会生成它们。测试逐题对比两套文件，防止优化时丢题、错位或删除解析。

自然计时从零开始。倒计时按实际题数 × 108 秒计算，时间到自动交卷；后台停留也计入用时。切换题目或答案不会重置时间，交卷和退出后停止计时。刷新或离开会提示本次进度尚未保存。

每次交卷显示本次正确率，以及跨所有已完成练习的累计正确率。累计按答对总数除以题目总数计算：先做 10 题对 8 题，再做 20 题对 10 题，累计是 18/30 = 60%，而不是平均两次百分比。重复练习重新计入，未作答按错误计入；未交卷的练习不计入。旧版只保留错题，无法准确还原历史总题数，累计从本功能启用后的首次交卷开始。

每次交卷使用唯一编号，在同一个本机事务中保存错题和成绩。保存重试、重复恢复备份和多设备同步不会重复累计；全部答对也会保存成绩。统计随错题本导出、恢复和云同步。升级浏览器数据库时会保留旧错题，并让仍打开的旧版本数据库连接关闭，避免旧页面覆盖新统计；旧页面需刷新后继续保存。

## 独立错题本和自动同步

`mistakes.html` 展示每次交卷的答错、未作答题，支持按科目查看和重练。保留题目、正确答案、解析、最近选择、首次/最近出错时间和累计出错次数。重练答对后仍保留历史。

本机数据存储在 IndexedDB（数据库 `mbe-mistakes`），可保存完整题目，不受 localStorage 的小容量限制。同一浏览器多标签页的修改在事务中合并。旧版本 `mbe.mistakes.v1` 的 localStorage 数据会自动迁移，并保留原副本。

启用云端后，输入一个私人密码即可登录，无需邮箱；设备记住登录 30 天。交卷后立即尝试同步，前台每 30 秒检查，恢复联网/返回页面时自动重试。仅上传变化的记录，云端未变化时不重复下载整本错题。未同步时显示本机保存状态，不会声称已云端保存。

不同设备使用各自的递增计数，合并时逐设备取最大值再相加，重复同步不会重复计数。导入旧备份时，旧的累计次数取最大值，后续新计数按设备独立累计。同步遇到并发本机操作时会继续补传。

`Verify deployed private sync` 工作流使用仓库中的 `LOGIN_PASSWORD` 验证线上健康、网站来源限制、两个独立会话的登录和一致读取，以及退出后令牌失效。该检查不写入错题，也不输出密码、令牌或错题内容。跨浏览器写入、断网补传与恢复由隔离的浏览器回归覆盖。

IndexedDB、云端 API 和备份均保存完整题目快照。所有题干、选项和解析输出前转义。错题页面另有折叠的 JSON 导出/导入选项；正常使用云同步时无需手动备份。清理网站数据前，应确认已同步。

## 首次部署 Fly.io（维护者操作一次）

### 通过 GitHub Secrets 授权（推荐）

先在自己已登录 Fly.io 的终端创建应用并生成仅限该应用、有效期 24 小时的部署令牌：

```sh
fly auth login
fly apps create abcdwu-mbe-mistakes
fly tokens create deploy --app abcdwu-mbe-mistakes --name github-deploy --expiry 24h
```

在 GitHub 仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加：

- `FLY_API_TOKEN`：上一步生成的完整部署令牌。
- `LOGIN_PASSWORD`：自行选择的网站私人密码，至少 1 个字符。

不要把令牌或密码写进代码、Issue、PR 或聊天。短期令牌到期不影响已部署的网站，只影响下次部署。

PR 合并后，在仓库 **Actions → Deploy private mistake sync → Run workflow** 手动启动部署。工作流先运行测试，再创建磁盘和共享 IPv4、把密码写入 Fly Secret、部署一台机器并验证登录/同步。它不会随普通代码推送自动创建付费资源。部署完成后，将实际 API 地址写入 `cloud-config.json` 并发布前端。

服务代码更新时，也可由维护者在合并提交标题中明确添加 `[deploy-sync]` 来触发同一部署流程。没有该标记的普通推送仍不部署。累计统计需要新后端：部署检查要求 `/health` 宣告 `quiz-attempts`，并验证同步响应包含统计列表。前端遇到旧后端时继续保留本机统计，显示尚未上传，待服务升级后自动补传。

### 本地 CLI 部署（替代方式）

当前 `cloud-config.json` 已接入 `https://abcdwu-mbe-mistakes.fly.dev`。用户在网站输入私人密码后自动同步；密码配置在 Fly Secret，部署令牌配置在 GitHub Actions Secret。前端每次重新获取同步配置，避免缓存旧的本机保存设置。

已部署配置：应用名 `abcdwu-mbe-mistakes`、东京 `nrt`、共享 CPU、256 MB 内存、1 GB 持久化磁盘，每日卷快照保留 30 天。后台闲置时可停止机器，下次访问自动启动，首次连接可能稍慢。国内网络体验需实测，地区本身不是可达性保证。

在已安装 flyctl 并完成 `fly auth login` 的终端中，从仓库根目录执行：

```sh
fly apps create abcdwu-mbe-mistakes
fly volumes create mistake_data --app abcdwu-mbe-mistakes --region nrt --size 1 --snapshot-retention 30
```

通过标准输入安全设置密码，避免把它放入仓库、命令历史或聊天：

```sh
read -r -s -p '设置私人密码（至少1个字符）: ' mbe_password
printf '\n'
printf 'LOGIN_PASSWORD=%s\n' "$mbe_password" | fly secrets import --app abcdwu-mbe-mistakes
unset mbe_password
fly deploy --ha=false
```

仅运行一台机器，**不要直接扩容多台**：该实现使用单个 SQLite 数据库，多个独立磁盘不会自动复制。`--ha=false` 避免 Fly 首次部署创建第二个独立实例。

部署后检查 `/health`，确认只有一台机器且磁盘挂载在 `/data`。再把 `cloud-config.json` 改为实际 API 地址并发布前端，例如：

```json
{ "apiBase": "https://abcdwu-mbe-mistakes.fly.dev" }
```

允许的页面来源由 Fly 环境变量 `ALLOWED_ORIGINS` 控制，目前为 `https://test.chaoxu.me` 和 `https://abcdwu.github.io`。不要设置为 `*`。如需自定义 API 域名，可在 Fly 配置证书和 DNS，再更新 `apiBase`。登录、保存、断网重试和新设备恢复均应从真实前端地址验证。

生产 API 强制 HTTPS，密码只配置在 Fly Secret 中，服务器使用 scrypt 校验；会话令牌只在浏览器本机保留，服务器只存令牌摘要。错误密码按来源限制为每 15 分钟 5 次；会话可退出撤销，30 天自动过期。`/api/sync` 全部需要登录。

SQLite 数据库位于持久化磁盘 `/data/mistakes.sqlite`。`fly.toml` 请求每日自动卷快照、保留 30 天，部署后须检查实际卷设置和快照生成情况。机器、磁盘和快照按 Fly.io 当前价格计费。快照不是实时复制，主机故障可能影响最近一次快照之后的云端数据；本机副本会在重新同步时补回。

官方文档：[区域](https://fly.io/docs/reference/regions/)、[磁盘快照](https://fly.io/docs/volumes/snapshots/)、[应用配置](https://fly.io/docs/reference/configuration/)、[费用](https://fly.io/docs/about/pricing/)。

## 题库来源与完整性

已按八份原 PDF 全量重建为 **1,803 题**，保留原有 1,635 题并补回 168 题。八科数量为：民诉 297、宪法 243、合同 273、刑法 165、刑诉 83、证据 265、不动产 248、侵权 229。Torts 从 99 题恢复为 229 题，补回 130 题。刑诉原文件开头两道实体法题归入刑法。

全部 5,357 页均有来源归属，包含 836 个含图页。每题保留原文件、题号、题干页、完整解析页和答案讨论引用；原题、图表和解析可直接通过本站托管的 PDF.js 查看。PDF.js 6.5.438 及其字体、解码资源随站点提供，不依赖外部 PDF 服务或 CDN。来源和许可见 [PDF.js 说明](vendor/pdfjs/README.md)。

本次核验确认题库与原文的覆盖及对应关系。原材料没有独立答案键；各题答案依据原解析明确讨论的三个错误选项确定，并保留页码引用，**不作独立法律答案认证**。逐科结果、旧提取缺陷和核验范围见 [完整性审计](audit/REPORT.md)。

`questions.txt`、`question-metadata.json` 由 `npm run build:bank` 一起生成，使用 SHA-256 检查版本一致性。原文件及摘要见 `sources/manifest.json`，完整页面归属见 `audit/source-coverage.json`。生成器不再按题干前缀去重，也不静默跳过无法解析的题目。全部 **1,635 个旧 ID 保持不变**，题目重排和补题后仍对应既有错题记录。

前端需要 HTTPS 或 localhost，以及支持 IndexedDB、DecompressionStream、Web Crypto 的现代浏览器。

## 题干高亮

在练习、交卷回顾或错题本中，选中题干文字（手机长按并拖动选择范围），点击“高亮选中”。可选中一部分文字后点击“取消选中高亮”，或使用“清除本题高亮”。黄色标记先保存在本机 IndexedDB，登录后自动上传到 Fly.io；换设备登录后可恢复，也包含在 JSON 备份中。旧 localStorage 标记自动迁移并保留原缓存。题干内容更新时旧标记不会错误套用。浏览器拒绝保存或空间不足时会提示。

## 练习记录与本轮不重复

每次交卷自动保存完成时间、开始时间、实际用时、题数、按顺序排列的题目 ID、当时所选答案和对错。首页与交卷页的“练习记录”只用数字列出错题的本次题号（未答计错）。每条记录下方直接显示当时的完整题干、选项和作答；打开练习记录后按滚动位置载入所需科目，保持首页轻量。点击完成时间可不限次数回看那次的具体题目、原作答、正确答案和完整解析，不再次计分，也不消耗本轮题目；题目通过稳定 ID 从现有题库及本机缓存恢复。

按科目维护轮次，混合练习沿用各科进度。本轮已交卷题目不再被抽中，剩余不足所选题数时只出剩余题，不混入下一轮。选定范围全部完成后，“开始下一轮练习”会开启新一轮。错题重练单独维护轮次；未交卷退出不消耗题目。轮次与练习记录由现有 SQLite/IndexedDB 自动保存，登录后随错题一起云同步，JSON 备份亦包含完整记录。

旧版累计记录只有日期、题数和分数，无法恢复缺失的用时、作答或题目 ID，仍保留原累计成绩但不能展开。轮次从支持明细记录后的交卷开始。多设备应先完成同步再继续练习；同时离线开始的练习无法互相预知抽题结果。

Apple Pencil：在题干工具栏开启“笔高亮”或“笔擦除”，用笔划过文字即可标记或局部擦除。再次点击当前模式恢复普通文字选择。笔模式下手指拖动可滚动，笔划期间忽略手掌触碰。标记保存在本机，登录后参与 Fly.io 云同步；翻题、刷新、回顾及换设备时可恢复。自动化覆盖 Pointer Events；真实 Apple Pencil/iPad Safari 手感需真机验证。

高亮同步按“题目 ID＋完整题干文字”区分版本，追加有逻辑时序的添加/擦除操作。离线独立添加合并保留，擦除和清除保留操作记录，旧缓存与重复同步不会让已清除标记复活。源文本更新不会把旧偏移套到新文字上。同一浏览器的数据版本升级为 v3，关闭旧连接后保留原记录，防止旧标签页写回不含高亮的数据。高亮单独同步事件不会关闭正在展开的错题。
