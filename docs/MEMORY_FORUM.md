# 记忆论坛（轻量版）实装说明

状态：**未开工**。2026-11-13 下午一口气做完（用户：「下午再一口气做吧」）。
上一轮派给成员的任务 #404 因工作区不可写已取消，改由主角色自己做。

## 要什么

develop 的「记忆论坛」靠常驻 gate 进程（每轮推送 + 引用投票 + 徽标）。**我们不跑 gate**，
所以做一套等价但更轻的东西：

| # | 能力 | 落点 |
|---|---|---|
1 | **存储**：一条记忆一页 markdown | `~/.conest-collab/roles/<成员>/wiki/memory/*.md`，frontmatter 带 `name`/`description` |
2 | **每轮推送**：挑最多 3 条相关记忆，前缀 `[#短编号]` | 成员指令拼装处（`dsh-member.mjs` / `memory-index.mjs`） |
3 | **引用记录**：回复里出现 `[#编号]` 即算用过 | 新表 `memory_uses`（member, room, entry, message_id, created_at），走 `store.mjs` 的 `COLUMNS` 迁移 |
4 | **徽标**：消息下方「用了 N 条记忆」，点开列条目 | 前端 `MessageRow`，**没用到不渲染** |
5 | **交回写入**：`[report]` 时把这一轮的一条教训写进 `memory/` | 交回流程 |

**明确不做**：向量检索、去重算法、启动 gate、记忆论坛的投票/评分体系。

## 为什么不做成 develop 那样

- 依赖 gate 常驻进程，我们没跑它，也不打算跑（任务板会两套打架）；
- 我们已经有「每会话一次」的 MEMORY.md 索引（`memory-index.mjs`），这套是它的延伸。

## 验收标准

- 新建一条记忆后，**下一轮**成员指令里能看到 `[#编号]` 与标题；
- 成员回复里写了 `[#编号]` → `memory_uses` 落库，消息下方出现徽标；
- 没引用的回复**不显示徽标**；
- 交回时 `memory/` 多一页，内容是一句话教训；
- 全部有测试：推送挑选、引用记录、徽标渲染、交回写入。

## 测试与构建

```bash
cd dsh/collab && node --test *.test.mjs        # 2 个既有 CLI 失败是 classic 原有
./dsh/node_modules/.bin/vitest run --config dsh/vitest.config.mjs
cd dsh/packages/client-ui-discord && pnpm bundle
# 然后把 lib/{client.js,style.css,build.json} 同步到 bridge/core/dsh_bundle/packages/client-ui-discord/lib/
```

## 环境备注（踩过的坑）

- 成员工作区**不可写**（`bothouse-memforum` 被拒），所以这活不再派给成员；
- `dsh/collab/later.mjs` 会被测试**单独复制**到临时目录运行，**不要给它加 import 依赖**；
- `pnpm bundle` 后必须同步 `bridge/core/dsh_bundle/`，否则运行中的 App 用的是旧包。
