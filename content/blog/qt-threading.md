---
title: "Qt 多线程与异步任务"
date: 2026-07-24
url: "/qt/qt-threading.html"
categories: ["Qt"]
tags: ["threading", "async"]
description: "Qt 中使用 QThread、任务对象和信号槽处理异步工作。"
---

Qt 多线程的首要目标是保持 UI 响应。耗时任务不要直接运行在主线程，结果通过信号槽回到 UI。

常见做法是把 worker 对象移动到 `QThread`，由信号触发工作，再用信号返回结果。

```cpp
auto thread = new QThread(this);
auto worker = new Worker;
worker->moveToThread(thread);
connect(thread, &QThread::started, worker, &Worker::run);
connect(worker, &Worker::finished, thread, &QThread::quit);
thread->start();
```

不要在 UI 线程等待子线程结束；用事件驱动完成状态同步。
