# dsh-approval-timeout

给 DeepSeek Harness（dsh）Web UI 的授权提示加一个截止时间：**超过设定时间没人点「允许/拒绝」，就自动按「拒绝」处理**。默认 **10 分钟**，可随时改。

English: [README.en.md](README.en.md)

## 行为

- 任何需要你点头的动作（跑命令、写文件、装插件……）都会弹出授权面板；本插件给它计时。
- 到点自动拒绝，和你亲手点「拒绝」完全一样：面板消失、工具调用以拒绝结束、写入同一条 `rejected` 审计事件。
- 只会拒绝，**永远不会自动放行**——超时后 fail closed。
- 没有审批在等时插件完全静默；选「关闭」即恢复 dsh 原生行为（无限等待）。

## 安装

```bash
dsh plugin --profile web add github:EviMing/dsh-approval-timeout   # 从 GitHub 安装
# 或发布到 npm 之后：
dsh plugin --profile web add dsh-approval-timeout
```

装完重启 / 刷新 `dsh web` 页面，输入框下方会出现控件：

```
审批超时自动拒绝   [10 分钟 ▾]
```

## 使用

- 下拉框调整时间：**关闭 / 1 / 3 / 5 / 10 / 15 / 30 / 60 分钟**，选完立即生效并记住。
- 有审批在等待时，这一行变黄并显示倒计时，例如 `bash：9:58 后自动拒绝`。
- 时间存在浏览器 `localStorage` 的 `dsh.approval-timeout.minutes` 里，按浏览器 profile 持久化（不写服务端配置，不改 profile 的 patch）。

## 为什么在客户端实现

授权面板由 `@deepseek-ai/dsh-client-ui-approval` 在浏览器里渲染；宿主侧的 `approval/request` waterfall 只负责把请求转给浏览器并等待客户端作答，网关只在「客户端作答」或「请求 signal 中止」时收尾。若插件在宿主抢先返回 `'rejected'`：工具已被拒绝，但面板不会消失，你之后再点按钮只会变成空操作。

所以本插件读取 `ctx.uiSession.sessionStatus` 中当前会话的 `pendingInteraction`（即那个 `PendingApproval` 实例），到点调用它自己的 `pending.answer('rejected')`——与用户点击走同一条路径，审计、面板、工具结果三者一致。

## 安全

- 只做「拒绝」，不做「批准」；不存在超时放行的代码路径。
- 无网络请求，不读凭据，不写会话事件，不碰 `document.body`。
- 唯一副作用：调一次 `answer('rejected')` 并在 `localStorage` 存一个整数。
- 撤销：`dsh plugin --profile web remove dsh-approval-timeout`（或插件管理里停用），刷新即可，无残留。

## 开发与自测

```bash
node verify/offline.mjs
```

离线自测不需要浏览器：用假的 `window.__ModuleLoader__`、React、Client services 和一个会记录调用的假 `PendingApproval` 驱动 `client.js`，断言

1. 默认计时是 10 分钟；
2. 有待审批时渲染倒计时文案；
3. 改成 1 分钟后按原始开始时间重排；
4. 到点只调用一次 `answer('rejected')`；
5. 选「关闭」时任何审批都不被动。

## 兼容性

实测环境：dsh `0.2.0-rc.2`（`dsh web`），依赖的客户端包为
`@deepseek-ai/dsh-client-ui-session` 与 `@deepseek-ai/dsh-client-ui-approval`（两者的 `pendingInteraction` 契约）。
桌面版 dsh 若自带更老的 dsh，可能没有 `uiSession.sessionStatus`，此时插件会静默不生效（不会报错）。

## 目录

| 文件 | 作用 |
| --- | --- |
| `package.json` | bundle 清单：`dsh.bundle.patch` + `dsh.client`（web 客户端半） |
| `cordis.patch.yml` | 插入 Loader 行 `approval-timeout` |
| `index.js` | 宿主半：空 `apply()`，只为让客户端模块随包加载 |
| `client.js` | 客户端半：计时、倒计时、自动拒绝、下拉设置 |
| `locale/{zh,en}.json` | 插件列表里的名称与描述 |
| `verify/offline.mjs` | 离线自测 |
| `docs/MARKET.md` | 上架插件市场要做的步骤与门槛 |
| `docs/marketplace-entry.yml` | 提交给 awesome-dsh-plugin 清单的条目文件 |

## License

MIT
