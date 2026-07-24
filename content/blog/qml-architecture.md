---
title: "QML + C++ 混合应用架构"
date: 2026-07-24
url: "/qt/qml/architecture.html"
categories: ["Qt"]
tags: ["qml", "cpp"]
description: "QML 与 C++ 组合时的职责划分。"
---

QML 负责界面表达，C++ 负责稳定逻辑。不要把复杂业务流程写进 QML，也不要让 C++ 直接操纵过多界面细节。

推荐把 C++ 对象注册为上下文属性、单例或模型，让 QML 通过属性、方法和信号访问状态。
