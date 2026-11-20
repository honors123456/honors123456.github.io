# 项目协作指南

这是一个使用 Hugo 和 PaperMod 的静态技术博客。文章位于 `content/`，站点与菜单配置位于 `hugo.toml`，文章模板位于 `archetypes/default.md`。

- 普通文章按专题目录组织。项目集的每个项目使用独立目录及 `_index.md`，其下可包含多篇文章。
- 新文章默认正式发布（`draft: false`）；文章完成后运行 `publish.bat` 提交并推送，GitHub Actions 自动部署。模块来自文章所在专题或项目目录。
- 主题定制优先放在项目层。项目内 PaperMod v8.0 包含 Hugo 0.170.1 兼容修正。
- 本地预览和远程发布只保留 `preview.bat`、`publish.bat` 两个入口；文章默认正式发布，不采用草稿工作流。使用方法见 `README.md`，发布状态见 `ROADMAP.md`。
