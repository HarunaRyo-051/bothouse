# classic ↔ develop 移植台账

记录「develop 上有什么、classic 能不能搬、搬了没有」，免得下次从零再查一遍。

- **classic**：我们自己的版本，只在这里发布。
- **develop**：上游主线（`fork/develop`，镜像 `zuiho-kai/bothouse`）。
- 2026-11-13 基准：classic `75221c4b`，两边差 87 个文件 / 约 +4900 行。

## 一、判定方法（重要）

**不要用「文件存在」判断可搬**——classic 的这些文件内容早就分叉了：

```bash
# 1. 模拟合并，看这个提交会给我们带进多少行、又删掉多少行
tree=$(git merge-tree --write-tree classic <commit> | head -1)
git diff --numstat "$tree" classic | awk '{a+=$1; d+=$2} END{print "+"a, "-"d}'
```

- **净新增为 0** → 内容在 classic 里已经有了（很可能是 squash 合过）；
- **净删几百到几千行** → 它是旧状态，合并等于回滚我们的活；
- **补丁 `git apply --check` 失败** → 上下文对不上，只能「读懂意图后自己写」。

## 二、已经搬到 classic 的

| 来源 | 内容 | classic 提交 |
|---|---|---|
| develop watch 系列 6 条 | 看门：无编号过期即关、后到 `[report]` 结看门、只认【接】登记、暂停不收催办等 | `c8160dff` … `47694b80` |
| develop 3 条干净补丁 | 改负责人保留工位、队友状态列空位、无路由模型只在被叫时回答 | `6a197f22` … `c3de45ea` |
| develop `da535dbc` | **交付卡**：网页内嵌预览 + 就地验收（自己写，未搬 gh 相关） | `bc5b0df1` |
| develop `351c4104` 的思路 | **派活人忙 → 转空闲队友验收**（只取选人逻辑，不含 PR CI 自动收口） | `f5e3db97` |
| develop `40429475` | **交回前自查**（`report-check.mjs` + 交接自带骨架） | `a23c429d` |
| develop `ed50a611` | **桥重启后旧进度卡关成已取消** | `ad240888` |
| develop `7d3e1a56` / `#991` / `#988` | 暂停任务不算忙碌、连续 bash 合并、单步不画 chip | `09f3379d` `75221c4b` |
| 频道体验（照效果重写） | 进展卡、头部忙碌数、阅读位置、按活跃排序、步骤 chips | `8072c9e7` … |

## 三、查过、classic 里已经有的（别再搬）

| develop | classic 现状 |
|---|---|
| `#917` 消息撤回 | **已有**：`DELETE /collab/api/messages/:id`，撤回会停下该消息发起的回答，前端有二次确认 |
| 成员失败提示分类 | **已有**：连不上/没 Key/模型不可用/被中断，各自一句人话 |
| `#970` 白底默认 | 用户明确**不做**（会跟宿主暗色主题打架） |
| `#926` 刷新回上次频道 | 已由「阅读位置记忆」覆盖 |

## 四、明确搬不了的（不是懒，是不适用）

| develop | 原因 |
|---|---|
| `board.py` 系列（没交回就 done 放回工位等） | gate 是另一套看板程序，我们流程不走它 |
| `page.html` 系列（空态/排版） | 那是桥渲染的静态页，我们用的是 React 频道页 |
| 数字码配对、固定 bot 端口 | 依赖桥的配对协议 / DSH 宿主启动参数 |
| Wiki 星河、desk 工作台、记忆论坛、`ctx` 目录注入 | develop 的「工作台 + 记忆」体系，classic 没有这些概念 |
| 审核模型两档、审核会话调度 | 依赖「审核会话」，我们的验收是人在频道里点 |
| `ghPrStatus` 小活自动收口 | 依赖 GitHub PR + CI，我们不走 PR 流程（用户已决定不做） |
| Windows 相关（升级依赖、文件锁、LF 换行）、面板路径 | 平台问题，我们用不到 |

## 五、下次怎么继续

1. 拉 develop：`git fetch fork develop`（本仓库 `fork` = 我们的 GitHub 仓）；
2. 列出共有文件上的未搬提交：
   ```bash
   git log --no-merges --format='%h %s' classic..fork/develop -- \
     'dsh/collab/*' 'bridge/core/team_*.go' 'bridge/contrib/gate/*' 'dsh/packages/client-ui-discord/*'
   ```
3. 用第一部分的 `merge-tree` 判据逐个过一遍：净新增 0 → 已有；净删很多 → 旧状态；能干净打 → 直接打；打不上 → 读意图自己写；
4. **一次只做一条，做完跑测试**（服务端 `node --test *.test.mjs`，前端 `vitest`，Go `go test ./core/`），全绿再推 classic。

## 六、已知的既有失败（不是我们引入的）

- 服务端：`CLI member: after /new …`、`CLI member: a session that could not be resumed …`（2 条）
- Go：`TestGateContextWiki`、`TestLeadSelectionForRemovedRoleFallsBackToConfiguredLead`（2 条）
