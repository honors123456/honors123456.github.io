---
title: "模板元编程基础"
date: 2026-07-24
url: "/cpp/template-metaprogramming.html"
categories: ["C++"]
tags: ["template", "metaprogramming"]
description: "理解模板、类型萃取和编译期计算。"
---

模板元编程把一部分计算提前到编译期。它适合表达类型约束、生成重复代码和构建泛型库，但不适合把普通业务逻辑复杂化。

```cpp
template <typename T>
using remove_cvref_t = std::remove_cv_t<std::remove_reference_t<T>>;
```

现代 C++ 中优先使用 `constexpr`、`if constexpr` 和 concepts。只有当类型系统本身是问题的一部分时，再使用更复杂的模板技巧。
