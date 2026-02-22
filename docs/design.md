# Smart Clip 设计说明

## 愿景

跨平台极简剪贴板：代码片段高亮、Markdown 预览，并通过 AME 协议记录重要剪贴历史。

## 技术选型


| 层级  | 技术                | 说明                 |
| --- | ----------------- | ------------------ |
| 前端  | Vite + React TS   | 轻量、与 Tauri 官方模板一致  |
| 桌面壳 | Tauri 2           | Rust 后端、小体积、系统 API |
| 持久化 | SQLite (rusqlite) | 本地历史，无服务依赖         |


## 快捷键策略

- **Windows / macOS**: `Alt+C` 唤出剪贴板列表窗口。
- **Linux**: 默认 `Super+C`，避免 Alt 与窗口管理器/输入法冲突（技术债务见 prj-smart-clip-fix-shortcut-linux）。

## 数据模型

- **workspaces**: `id`, `name`, `description`, `icon`, `bg_type`, `bg_gradient` (JSON), `bg_image_url`, `sort_order`, `created_at`
- **clips**: `id`, `content` (TEXT), `created_at` (ISO8601), `workspace_id` (FK → workspaces.id)

## 与 AME 的对接（规划）

- 重要剪贴可由前端或后端调用 `save_memory`（或 MCP）写入 AME。
- 需定义「重要」的规则（如标签、手动星标、或 ELAP 阈值）。

