# lxx 的技术笔记

这是一个基于 Hugo 的个人技术博客，使用 Yihui Xie 的 `hugo-paged` 主题。

## 当前结构

- `hugo.yaml`：Hugo 站点配置。
- `content/`：Markdown 内容源。
- `content/blog/`：技术文章。
- `content/topics.md`：专题索引。
- `themes/hugo-paged/`：Hugo 主题。
- `static/`：静态资源。
- `cpp/`、`qt/`、`opencv/`、`opengl/`、`projects/`：迁移前的静态 HTML 页面，暂时保留用于对照和回滚。

## 写作方向

- C++ 工程基础
- Qt 桌面开发
- OpenCV 视觉处理
- OpenGL 图形渲染
- 项目复盘与架构总结

## 使用方式

安装 Hugo 后，在项目根目录运行：

```powershell
hugo server
```

生成静态文件：

```powershell
hugo
```

## 后续

后续应逐步把旧 HTML 页面迁移为 `content/blog/` 下的 Markdown，并在确认 Hugo 构建和部署流程后删除旧静态页面。
