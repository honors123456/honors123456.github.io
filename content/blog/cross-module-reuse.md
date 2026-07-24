---
title: "跨模块复用策略"
date: 2026-07-24
url: "/projects/cross-module-reuse.html"
categories: ["Projects"]
tags: ["architecture", "reuse"]
description: "在 C++、Qt、OpenCV 和 OpenGL 项目中提取可复用模块。"
---

跨模块复用的前提是边界稳定。不要为了复用过早抽象，也不要把具体业务对象包装成通用库。

适合复用的内容通常包括日志、配置、数据模型、图像处理流水线、线程任务封装和基础 UI 控件。不适合复用的是仍在快速变化的业务流程。

复用模块应有清晰输入输出、少依赖、可单独测试。
