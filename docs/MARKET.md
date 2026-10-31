# 上架 DSH 插件市场

收录的唯一入口是官方精选清单仓库
**<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>**。
`dshmarket`、「Plugins → Discover」、`awesome-dsh-plugin.com` 站点和 npm 包
`dsh-plugin-catalog` 都从这份清单派生，所以**只需向该仓库提一个 PR**。

## 1. 投稿形态：一个插件一个 YAML 文件

清单不再往 README 里加行。每个插件是一份独立文件：

```
data/plugins/<owner>__<repo>.yml        # 本插件 → data/plugins/EviMing__dsh-approval-timeout.yml
```

`README.md` / `README.zh.md` 由 CI 在合并后重新生成，**不要手改、也不需要提交**。
本仓库的 `docs/marketplace-entry.yml` 就是提交内容本体，复制成上面那个路径即可。

## 2. 收录门槛（由 PR CI 自动检查）

| 门槛 | 本仓库状态 |
| --- | --- |
| `package.json` 声明 `dsh.bundle`（只有 `dsh.client` 不算可安装） | ✅ `"bundle": { "patch": "./cordis.patch.yml" }` |
| 仓库根有 `cordis.patch.yml`，含 `insert: [{ id, name }]` | ✅ |
| 仓库创建满 **1 天** | ⏳ 建库后满 24 小时才能过 CI |
| 仓库带 `dsh-plugin` topic | ⏳ 建库后设置 |
| 仓库有真实可用代码（非占位/纯 README） | ✅ |
| `description.en` 说明功能、不带营销词、与代码一致 | ✅ 见 `docs/marketplace-entry.yml` |
| 文件必须落在 `data/plugins/*.yml`，PR 只 +1 文件 | ✅ |

推荐项（非强制）：发 npm 包（免 `allowBuilds` 授权）、把 `@deepseek-ai/*` 写成
`peerDependencies`、截图放自己仓库的 `screenshots.json`。本插件无运行时依赖，前两项不适用。

## 3. 提交内容

```yaml
url: https://github.com/EviMing/dsh-approval-timeout
name: EviMing/dsh-approval-timeout
category: ui
description:
  en: '...'
  zh: '...'
```

要点：

- `url` 必须与仓库地址完全一致。
- `category` 取贴合实际功能的分类，本插件 → `ui`（它的可见产出就是输入框下方那个控件）。
  合法值：`agi ui usage theme model identity session memory tools wsl browser vision voice docs skill workflow git notify dev security remote market fun`。
- 描述里出现 `: `（冒号加空格）必须整体加引号，否则 YAML 会解析成嵌套键。已加。
- `icon` 可选，省略则回退到作者头像。

## 4. 步骤

```bash
# 1) fork 并 clone
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
cd awesome-dsh-plugin

# 2) 加条目（内容 = 本仓库 docs/marketplace-entry.yml）
cp ~/Desktop/dsh-approval-timeout/docs/marketplace-entry.yml \
   data/plugins/EviMing__dsh-approval-timeout.yml

# 3) 提交并推送
git checkout -b add-dsh-approval-timeout
git add data/plugins/EviMing__dsh-approval-timeout.yml
git commit -m "Add dsh-approval-timeout"
git push -u origin add-dsh-approval-timeout

# 4) 开 PR（标题 "Add dsh-approval-timeout"）
gh pr create --repo awesome-dsh-plugin/awesome-dsh-plugin \
  --title "Add dsh-approval-timeout" \
  --body "Auto-rejects an unanswered approval prompt in the dsh Web UI after a configurable timeout (default 10 minutes, adjustable under the composer). Reject-only by design: no code path approves, no network or file access. Repo: https://github.com/EviMing/dsh-approval-timeout"
```

不用 `gh` 也可以：fork 后在网页上加文件、开 PR，效果一样。

没有 `gh` 时纯 REST 等价流程（本机可用，需 token）：

1. `POST /repos/awesome-dsh-plugin/awesome-dsh-plugin/forks` 建 fork
2. `PUT /repos/EviMing/awesome-dsh-plugin/contents/data/plugins/EviMing__dsh-approval-timeout.yml`
   （`branch` 指向新分支，body 带 `content`(base64) 与 `message`）
3. `POST /repos/awesome-dsh-plugin/awesome-dsh-plugin/pulls`（`head: "EviMing:add-dsh-approval-timeout"`）

合并后清单、站点、市场目录会自动跟上；`dsh-plugin-catalog` 包随清单变化发版。

## 5. 本机实测状态（2026-10-31）

- **GitHub 可达**：本机代理 SteamTools（BeyondDimension）用自签根证书做 TLS 中间人，Node 默认
  不信任 → `UNABLE_TO_VERIFY_LEAF_SIGNATURE`。加 `node --use-system-ca`（读 Windows 证书库）即通；
  `GET /zen` 200、`GET /users/EviMing` 200、清单仓库 200。
- **git CLI 在本会话不可用**：`git.exe` 执行被拒（`cannot create standard input pipe` /
  `拒绝访问`），与网络无关。因此仓库建立与首次提交走 REST API（blobs → tree → commit → ref），
  本目录的本地 commit 仅作为内容源。
- 匿名 API 配额 60 次/小时，足够建库 + 上传 + fork + PR。
