# dsh-approval-timeout

授权提示 / 提问提示的超时自动处理（DeepSeek Harness Web UI 插件）。

English: [README.en.md](README.en.md)

## 行为

Harness 在浏览器里等用户点击时会一直阻塞。本插件给这两种等待都加了截止时间，默认 **10 分钟**：

- **授权**（`approval`）：超时未点击即自动按「拒绝」处理，等价于你自己点了「拒绝」——
  写入同样的 `approval/decided: rejected` 审计事件，面板消失，工具调用以拒绝结束（fail closed）。
- **提问**（`ask_user_question`）：超时未回答即自动按「跳过」处理——等价于你把每道题都留空点
  「跳过」，agent 收到的是 `{ answers: [{ id, selected: [] }, ...] }`，也就是明确的「用户没作答」，
  不会被当成默许，也不会伪造一个回复；面板消失，工具返回空答案并继续。
  如果你正在作答（面板聚焦 / 输入框编辑中），截止时间会顺延 60 秒，不打断手里的答案。

没有等待时插件完全静默。选「关闭」即恢复 dsh 原生行为（无限等待）。

## 安装

```bash
dsh plugin --profile web add github:EviMing/dsh-approval-timeout
# 或用 npm 包（如有发布）：
dsh plugin --profile web add dsh-approval-timeout
```

重启 / 刷新 `dsh web`。输入框（composer）下方会出现一行：

```
审批/提问超时   [10 分钟 ▾]
```

## 使用

- 下拉框调时间：**关闭 / 1 / 3 / 5 / 10 / 15 / 30 / 60 分钟**，立即生效并记住。
- 有授权在等待时，这一行变成黄色并显示倒计时，例如 `bash: 9:58 后自动拒绝`。
- 有提问在等待时同样变黄，例如 `提问：9:58 后自动跳过`。
- 设置存在浏览器 `localStorage`（键 `dsh.approval-timeout.minutes`）：按浏览器 profile 持久化，
  没有服务端配置，也不改任何 profile 文件。

## 不会被接管的等待

只处理「当前真的阻塞着 agent、且面板还活着」的请求，其余一律不碰：

- 已结算、只读的提问卡片（没有回答通道，回答它等于向 agent 注入不存在的回复）；
- 已经断开实时通道的旧卡片（`continued`）；
- 客户端自己已有倒计时的提问（`ask_user_question` 的 timed 模式）；
- 计划审批（`plan-review`）**故意不自动跳过**：它唯一非批准的结果是「继续规划」，agent 会改完
  再提一次，超时只会变成反复循环，所以这里宁可按原生无限等待；
- 没有 callId、又无法取消的卡片（只收起面板，不结束请求）。

## 为什么在客户端实现

授权面板由 `@deepseek-ai/dsh-client-ui-approval`、提问面板由 `@deepseek-ai/dsh-client-ui-user-questions`
在浏览器里渲染。HOST 侧的 `approval/request`、`user-questions/request` waterfall 只负责把请求转发给
浏览器并等待客户端作答；gateway 只在「客户端作答」或「请求 signal 中止」时收尾。如果插件在 HOST 侧
抢先 return，面板不会消失、工具却已经结束，用户之后再点按钮就变成空操作。

因此本插件直接读取 `ctx.uiSession.sessionStatus` 里当前会话的 `pendingInteraction`（即真实的
`PendingApproval` / `PendingQuestion` 实例），到点调用它自己的方法——`pending.answer('rejected')`
（授权）、`pending.answer({ answers: [...] })`（提问）、或 `pending.dismiss()`（无法回答、只能取消的
卡片）——和用户点按钮走完全同一条路径，审计、面板与工具结局因此保持一致。

## 安全

- 永远只会「拒绝」或「跳过」，没有任何自动批准的代码路径。
- 无网络请求、不读凭据、不发会话事件、不写 `document.body`。
- 只有两类副作用：一次 `pending.answer(...)` 调用，以及 `localStorage` 里的一个整数。
- 卸载：`dsh plugin --profile web remove dsh-approval-timeout`（或在插件页禁用）后刷新，不留残留。

## 开发

```bash
node verify/offline.mjs
```

离线自测不需要浏览器：它用假的 `window.__ModuleLoader__`、React、Client services、假
`PendingApproval` 与假 `PendingQuestion` 驱动 `client.js`，覆盖默认 10 分钟、倒计时文案、
改时间后重排、到点审批 `answer('rejected')`、多选题一次发出跳过批、rpc/continued/timed/只读卡
/plan 卡不跟踪、编辑中顺延 60 秒、无 callId 卡只 `dismiss()`、以及选「关闭」时完全不动。

## 兼容性

在 dsh `0.2.0-rc.2`（`dsh web`）上测试，依赖 `@deepseek-ai/dsh-client-ui-session`、
`@deepseek-ai/dsh-client-ui-approval`，提问部分与 `@deepseek-ai/dsh-client-ui-user-questions` 协作
（按鸭子类型读取，不强制注入）。桌面版若捆绑了更旧的 dsh、缺少 `uiSession.sessionStatus`，
插件会保持静默而不是报错。

## License

MIT
