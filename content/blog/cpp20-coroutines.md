---
title: "C++20 协程入门与实践"
date: 2026-07-24
url: "/cpp/cpp20-coroutines.html"
categories: ["C++"]
tags: ["coroutine", "cpp20"]
description: "从协程模型、关键字和简单任务类型理解 C++20 协程。"
---

C++20 协程是可暂停、可恢复的函数。语言只定义协程转换机制，具体调度、返回值和异常处理由 `promise_type`、awaiter 和外部框架决定。

## 关键字

- `co_await`：等待一个 awaitable，并在需要时交出控制权。
- `co_yield`：产生中间结果，适合生成器。
- `co_return`：结束协程并返回结果。

## 最小结构

```cpp
struct Task {
  struct promise_type {
    Task get_return_object() noexcept { return {}; }
    std::suspend_never initial_suspend() noexcept { return {}; }
    std::suspend_never final_suspend() noexcept { return {}; }
    void return_void() noexcept {}
    void unhandled_exception() { std::terminate(); }
  };
};
```

实践中不要只看语法糖，重点要理解生命周期：协程帧什么时候创建、谁持有 handle、异常如何传播、最终挂起点由谁清理。
