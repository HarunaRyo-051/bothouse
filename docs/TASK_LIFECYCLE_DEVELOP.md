# 任务状态机移植到 develop：试套记录

基线：classic `003f2ed2`；实现：`task-lifecycle` 第二段提交 `c60c833c`；目标：本地 `origin/develop` 快照。只解出快照到 `/tmp/task-lifecycle-develop-379` 做 `git apply --check`，没有切换主仓库、创建 worktree、修改 develop、推送或部署。

## 逐文件结果

检查方式：在 develop 快照目录，对每个文件执行 `git diff --binary 003f2ed2..c60c833c -- <file> | git apply --check`。`PASS` 只表示此处补丁上下文可套，不证明与 develop 全部业务代码兼容；每次套入后仍需测试和同步 bundle。

| 源文件 | 主要函数/作用 | 结果 | develop 需要的动作 |
| --- | --- | --- | --- |
| `dsh/collab/plugin.mjs` | `tasksRoute`, `ticketWorkspace`：迁移、取消/替代 API，转交不虚假验收 | PASS | 套入后核对原有路由鉴权 |
| `dsh/collab/store.mjs` | `ensureSchema`, `ensureTasks`, `migrateTaskStatuses`, `releaseIdleWorkspaces` | ADAPT，约 25 行冲突 | 合并 develop 现有 schema；旧库测试，不能直接替换整个表 |
| `dsh/collab/tasks.mjs` | `terminate`, `fromChat`, `relocate`, `awaitingUser` | ADAPT，约 405 行冲突 | 对照 develop 已有任务状态和交回逻辑，保留新版字段及验收入口；补迁移提问路由 |
| `dsh/collab/team-exit.mjs` | `TeamExit.bounce`：无效提问的频道可见提示 | PASS | 套入后检查频道消息去重 |
| `dsh/collab/collab.test.mjs` | 显式验收、空认领、迁移/提问、转交终态 | ADAPT，约 6073 行冲突 | 按 develop 测试夹具移植断言 |
| `dsh/collab/team-exit.test.mjs` | 无效提问工位/频道双向提示 | PASS | 回归执行 |
| `dsh/collab/workspace-pause.test.mjs` | 无效提问提示可见，正文不外泄 | PASS | 回归执行 |
| `dsh/packages/client-ui-discord/src/client/ChannelsPage.tsx` | `TaskBoard` 迁移动作注入 | ADAPT，约 290 行冲突 | 与新版页面 props 合并 |
| `dsh/packages/client-ui-discord/src/client/TaskBoard.tsx` | 迁移按钮和失败反馈 | ADAPT，约 22 行冲突 | 与新版任务卡操作区合并 |
| `dsh/packages/client-ui-discord/src/client/channel-source.ts` | `ChannelTask`, `relocateTask` API | ADAPT，约 223 行冲突 | 与新版任务 DTO/数据源合并 |
| `dsh/packages/client-ui-discord/src/client/index.ts` | 注入迁移动作 | ADAPT，约 47 行冲突 | 与新版插件注入表合并 |
| `dsh/packages/client-ui-discord/src/client/locales.ts` | 迁移与终态中英标签 | PASS | 套入后构建客户端 |
| `dsh/packages/client-ui-discord/src/client/task-board.ts` | 终态分组与用时 | ADAPT，约 12 行冲突 | 与新版分组定义合并 |

对应 Go 内嵌 `bridge/core/dsh_bundle/collab/`：`plugin.mjs`、`team-exit.mjs` 可试套；`store.mjs`、`tasks.mjs`、`collab.test.mjs` 需适配；`team-exit.test.mjs`、`workspace-pause.test.mjs` 在该 develop 快照不存在，不可直接套。**不要从 classic 把整个 bundle 目录覆盖 develop**：先适配 `dsh/collab/` 源码，再从同一 develop 源码同步内嵌文件、构建客户端并执行 `TestDSHBundle`。

## classic 验证及移植验收

- `cd dsh/collab && node --test --test-reporter=dot *.test.mjs test/*.test.mjs`：仅 2 个既有 CLI 记忆上下文用例失败（`after /new ... MEMORY.md`、`could not be resumed ... MEMORY.md`）；新增任务/工位/提问回归均通过。失败仍保留，不能宣称服务端全绿。
- `../bothouse/dsh/node_modules/.bin/vitest run --config dsh/vitest.config.mjs`：18 文件、228 用例通过。
- `cd dsh/packages/client-ui-discord && pnpm bundle`：通过；客户端产物复制到 Go 内嵌目录。
- `cd bridge && /Users/harunaryo/软件开发/.tools/go/bin/go test ./core/ -run TestDSHBundle`：`ok github.com/chenhg5/cc-connect/core 1.337s`。
- classic 的 `dsh/collab/*.mjs` 与 `bridge/core/dsh_bundle/collab/*.mjs` 逐文件 SHA-256 一致；哈希以交回时最后一次核对为准。

移植到 develop 的验收门槛：合并冲突并保留原有功能后，在 develop 自己的测试夹具下重跑服务端、前端、bundle 哈希及 Go 检查；通过之前的结论是“可移植但不是可整包直接套用”，并非已同时部署两版。
