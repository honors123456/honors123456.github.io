---
title: "Qt QML 与 C++ 混合架构"
date: 2026-07-24
url: "/projects/qt-architecture.html"
categories: ["Qt"]
tags: ["qml", "architecture"]
description: "Qt 项目中 UI、业务逻辑和数据层的分离方式。"
---

Qt 项目应把 UI 展示、状态管理和业务逻辑分开。QML 适合表达界面结构和交互状态，C++ 适合承载设备访问、计算逻辑、数据模型和长期状态。

## 分层

- UI 层：QML 或 QWidget，只负责展示和轻交互。
- 控制层：协调页面动作、状态转换和异步任务。
- 业务层：处理核心规则。
- 数据层：负责文件、数据库、设备或网络 IO。

```cpp
class AppController : public QObject {
  Q_OBJECT
public:
  Q_INVOKABLE void loadData();
signals:
  void dataReady(const QVariantList& items);
};
```

好的边界能减少 QML 中的隐式状态，也能让 C++ 逻辑更容易测试。
