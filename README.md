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

## 生成与发布

运行 `.\.tools\hugo\hugo.exe` 生成 `public/`。当前 GitHub Pages 发布方式尚未切换到 Hugo 构建产物。将 Markdown 改为已发布状态后，仍需完成站点部署才能在线访问。
