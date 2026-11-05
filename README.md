# MBE 练习室

GitHub Pages 提供页面，Fly.io 提供可选的私人错题同步 API；无需 Cloudflare 或邮件服务。前端不需要构建，后端只使用 Node.js 24 内置模块，无第三方运行依赖。

## 本地预览和验证

```sh
python3 -m http.server 8080
npm test
```

打开 `http://localhost:8080`。`npm test` 使用 Node.js 24，验证全部题库分类、稳定 ID、计时、错题合并、备份、API 登录、拒绝未授权访问及 SQLite 重启恢复。

浏览器回归脚本使用 Playwright（测试环境自行提供）和正在运行的本地页面服务器：

```sh
CHROMIUM_PATH=/usr/bin/chromium node tests/browser-check.cjs
```

省略 `CHROMIUM_PATH` 则使用 Playwright 默认安装的 Chromium。脚本验证八科筛选、正计时、倒计时自动交卷、刷新保留、错题重练、导出恢复、手机布局、多标签页并发、密码登录、断网后补传和跨设备恢复。

## 练习

八科下拉菜单包含民事诉讼法、宪法、合同法、刑法、刑事诉讼法、证据法、不动产法和侵权法，也可选择混合全部科目。每组可选 5、10、15、20 题；题目不足时使用实际数量。

自然计时从零开始。倒计时按实际题数 × 108 秒计算，时间到自动交卷；后台停留也计入用时。切换题目或答案不会重置时间，交卷和退出后停止计时。刷新或离开会提示本次进度尚未保存。

## 独立错题本和自动同步

`mistakes.html` 展示每次交卷的答错、未作答题，支持按科目查看和重练。保留题目、正确答案、解析、最近选择、首次/最近出错时间和累计出错次数。重练答对后仍保留历史。

本机数据存储在 IndexedDB（数据库 `mbe-mistakes`），可保存完整题目，不受 localStorage 的小容量限制。同一浏览器多标签页的修改在事务中合并。旧版本 `mbe.mistakes.v1` 的 localStorage 数据会自动迁移，并保留原副本。

启用云端后，输入一个私人密码即可登录，无需邮箱；设备记住登录 30 天。交卷后立即尝试同步，前台每 30 秒检查，恢复联网/返回页面时自动重试。仅上传变化的记录，云端未变化时不重复下载整本错题。未同步时显示本机保存状态，不会声称已云端保存。

不同设备使用各自的递增计数，合并时逐设备取最大值再相加，重复同步不会重复计数。导入旧备份时，旧的累计次数取最大值，后续新计数按设备独立累计。同步遇到并发本机操作时会继续补传。

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

### 本地 CLI 部署（替代方式）

当前 `cloud-config.json` 的 `apiBase` 留空，因此仅启用本机保存；不会向不存在的服务发送请求。需要 Fly.io 授权才能创建应用、机器和磁盘，代码中没有部署凭据或私人密码。

配置草案：应用名 `abcdwu-mbe-mistakes`、东京 `nrt`、共享 CPU、256 MB 内存、1 GB 持久化磁盘。应用名需在创建时确认可用。后台闲置时可停止机器，下次访问自动启动，首次连接可能稍慢。可在部署前改为新加坡 `sin`；国内网络体验需实测，地区本身不是可达性保证。

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

## 题库科目数据

原始 `questions.txt` 保持原样。`question-metadata.json` 为全部 1,635 道题提供科目和由题干、选项生成的稳定 ID，并保存原题库 SHA-256；加载时检查版本一致性。

科目来自现有题库连续分组：民诉 282、证据 265、刑诉 77、合同 268、侵权 99、刑法 157、宪法 239、不动产 248。原刑诉分组开头两道关于犯罪未遂、事后从犯的实体法题归入刑法。生成依据和范围见 `scripts/build_metadata.py`。替换或重排题库前应重新核对原始材料的分组，再运行 `python3 scripts/build_metadata.py`。

前端需要 HTTPS 或 localhost，以及支持 IndexedDB、DecompressionStream、Web Crypto 的现代浏览器。
