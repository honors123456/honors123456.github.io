---
title: "OpenGL 渲染入门"
date: 2026-07-24
url: "/opengl/intro-rendering.html"
categories: ["OpenGL"]
tags: ["rendering", "shader"]
description: "OpenGL 渲染管线的基本概念。"
---

OpenGL 渲染可以从顶点数据、缓冲对象、着色器和绘制调用四个部分理解。

最小渲染路径是：准备顶点数据，上传到 GPU，编译 shader，绑定状态，调用 `glDrawArrays` 或 `glDrawElements`。
