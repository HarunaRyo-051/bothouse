# 交付卡（内嵌网页预览 + 就地验收）需求

状态：**未开工**（2026-11-12 晚上开工，用户说「做，做全套」后改为晚饭后再做）

## 用户原话

> 交付卡是什么需求 → （解释后）**做，做全套**

## 要什么

成员交回一条消息、附**网页**（HTML 文件或网页链接）时，频道里不要只显示一个附件名，而是：

```
[交付卡 · 待验收]
 ┌────────────────────────┐
 │  网页在里面直接显示       │   ← 沙盒 iframe，可点可滚
 └────────────────────────┘
 [全屏]  [新标签打开]   [继续改] [收下]
```

- **内嵌预览**：不用下载，频道里直接看；
- **全屏 / 新标签**：整页打开；
- **待验收时带两个按钮**：「继续改」（退回返工）、「收下」（验收通过）——在交付物旁边直接验收，不用去任务板。

## 参照实现（develop）

- `da535dbc feat(channels): 交付卡内嵌可点网页，频道页私聊入口`
- 各块：
  1. `?view=page` 附件接口：HTML 以内联方式返回，带 **CSP sandbox** 头；
  2. 前端 `DeliveryPreview.tsx`：识别"交回消息带网页"，渲染沙盒 iframe；
  3. `EmbedPage.tsx`：全屏页。

## 我们缺的三块

| 缺什么 | 现状 |
|---|---|
| 交付卡卡片类型 | 我们只有 `task` / `permission` / 进度卡片 |
| 附件网页内联接口 | `dsh/collab/plugin.mjs` 的 `/collab/api/attachments/<uuid>` 只有下载 |
| 验收动作挂在交付物旁 | 我们的验收只在任务板上（`POST /collab/api/tasks/:id/review`） |

## 落地顺序（自己实现，不搬 develop 代码）

1. **附件内联**：`GET /collab/api/attachments/:id?view=page`，`text/html` + `Content-Security-Policy: sandbox`；
2. **前端预览**：交回消息（`task.result_msg_id`）里 `text/html` 附件渲染进沙盒 iframe + 全屏链接；
3. **就地验收**：卡上「继续改 / 收下」，调已有的 `reviewTask`（`verdict: rework | done`）；
4. 测试：附件路由单测（含 CSP 头）、前端渲染用例、`pnpm bundle` + bundle 同步。

## 安全红线

- iframe 必须 `sandbox="allow-scripts allow-forms"`（**不给** `allow-same-origin`，否则可读宿主 cookie）；
- 服务端必须带 `Content-Security-Policy: sandbox`，双保险；
- 只允许预览**我们自己的附件**，不允许外链 URL 直接内嵌（防钓鱼）。

## 验收标准

- 交回带 HTML 附件 → 频道里直接看到页面；
- 全屏/新标签能打开；
- 待验收时点「收下」→ 任务变 done；点「继续改」→ 回到 rework，且都走已有 review 接口；
- 普通附件（图片/PDF）行为不变。
