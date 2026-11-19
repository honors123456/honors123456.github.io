# 技术博客

使用 Hugo 0.170.1 和 PaperMod v8.0。文章保存在 `content/` 中，以 Markdown 编写。

## 本地预览

双击 `preview.bat`，服务器启动后会打开默认浏览器。按 Ctrl+C 停止预览。脚本优先使用 `.tools/hugo/hugo.exe`，也支持 PATH 中的 Hugo。

## 创建文章

在项目根目录执行以下命令，将 `my-article` 替换为文章文件名。命令使用 `archetypes/default.md` 创建文章。

```powershell
.\.tools\hugo\hugo.exe new content/cpp/my-article.md
```

可将 `cpp` 换成 `qt`、`qt/qml`、`qt/qwidget`、`opencv` 或 `opengl`。编辑生成的文件，填写标题、摘要和正文。创建时自动填写日期，并设置 `draft: true`。

预览草稿时运行 `.\preview.bat -D`。准备发布时将 `draft: true` 改成 `draft: false`。文章归属由所在目录决定。

## 项目集

每个项目使用 `content/projects/<项目名>/` 目录。先创建 `_index.md` 作为项目入口，例如：

```markdown
---
title: "项目名称"
description: "项目简介"
---
```

然后在该目录创建多篇文章。

```powershell
.\.tools\hugo\hugo.exe new content/projects/my-project/first-article.md
```

项目集列出项目，项目页面列出该项目的文章。文章也会显示在首页。

## 发布

`.github/workflows/hugo.yml` 在推送到 `main` 后构建并部署到 GitHub Pages，所以发布只需要提交并推送。

| 入口 | 行为 |
|---|---|
| `publish.bat` | `git add -A`，提交信息为 `发布文章 <时间戳>`，然后 `git push` |
| `quick-publish.bat` | 提交信息固定为 `更新内容`，不暂停窗口 |
| `auto-publish.bat` | 每 30 秒检查一次改动并自动推送，按 Ctrl+C 停止 |

三个入口都是纯 ASCII 的批处理包装，真正的逻辑在 `scripts/publish.ps1`（UTF-8 with BOM）。改动这些脚本时保持 `.bat` 为 ASCII + CRLF，中文提示写进 PowerShell：批处理如果是 LF 行尾或含 UTF-8 中文，cmd 会按系统代码页解析，报出"不是内部或外部命令"。

只想本地生成静态文件，运行 `.\.tools\hugo\hugo.exe` 即可。
