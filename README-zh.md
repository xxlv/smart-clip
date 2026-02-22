# Smart Clip

跨平台极简剪贴板：支持剪贴历史、工作区、全局快捷键唤出列表。

[English](README.md)

## 界面截图

<img src="docs/main.png" width="640" alt="Smart Clip 界面" />

*主界面：工作区切换、剪贴列表、设置。*

- **技术栈**: Vite + React (TypeScript) + Tauri 2 (Rust) + SQLite
- **目录**: `/src-tauri` 后端与本地 DB，`/src` 前端界面，`/docs` 设计文档

## 功能

- **复制即入历史**：每 2 秒检测系统剪贴板，有新内容自动写入历史（与最新一条相同则跳过）
- **工作区**：可切换不同工作区（如「默认」「日常任务」），每个工作区独立剪贴列表、名称、描述、图标与背景
- 剪贴板历史列表（SQLite 持久化，每工作区最多 100 条）
- 全局快捷键唤出窗口：**Windows/macOS** `Alt+C`，**Linux** `Super+C`
- **选中即关窗**：点击某条 → 复制到剪贴板并自动隐藏窗口
- **单条删除**：每条右侧 × 删除该条
- **清空历史**：有历史时标题栏显示「清空」
- **中/英**：标题栏「EN」/「中」切换界面语言，默认中文，设置持久化
- **悬停预览**：鼠标放在某条上可看到完整内容及大小（字符数 · 字节）
- **自定义背景**：设置 ⚙ 内可选「默认 / 渐变 / 背景图」；渐变可设两色与方向；背景图支持本地图片或网络地址；背景按工作区保存
- 使用系统剪贴板 API（Tauri 插件），复制即入历史，无需再点粘贴或添加

## 开发

```bash
# 安装依赖
npm install

# 开发（会启动 Vite + Tauri 窗口）
npm run tauri dev
```

## 构建

```bash
npm run tauri build
```

产物在 `src-tauri/target/release/`（或 debug 目录）。

## 数据

- SQLite 数据库路径：
  - **macOS**: `~/Library/Application Support/smart-clip/clips.db`
  - **Linux**: `~/.local/share/smart-clip/clips.db`
  - **Windows**: `%APPDATA%/smart-clip/clips.db`

## 后续规划

- 代码片段高亮
- Markdown 预览
- AME 协议对接（重要剪贴历史同步）

## 许可

MIT — 见 [LICENSE](LICENSE)。
