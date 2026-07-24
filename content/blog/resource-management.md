---
title: "智能指针与资源管理"
date: 2026-07-24
url: "/cpp/resource-management.html"
categories: ["C++"]
tags: ["raii", "smart-pointer"]
description: "用 RAII 和智能指针管理资源所有权。"
---

资源管理的核心不是「使用智能指针」，而是先明确所有权。

`unique_ptr` 表达独占所有权，适合作为默认选择。`shared_ptr` 表达共享所有权，但会增加生命周期推理成本。`weak_ptr` 不拥有资源，主要用于打破循环引用或观察对象是否仍然存在。

```cpp
auto file = std::unique_ptr<FILE, decltype(&fclose)>(
  fopen("data.txt", "r"),
  &fclose
);
```

能用栈对象时不要上堆；能用 `unique_ptr` 时不要用 `shared_ptr`。
