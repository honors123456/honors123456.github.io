---
title: "__try/__except,MSVC中使用 SEH 保护第三方库调用"
date: 2026-11-18
description: "分析 Windows 下使用普通try/catch捕获第三方库失败崩溃， SEH 捕获访问违例与原子标志阻止后续重试的实现。"
draft: false
---

在 Windows/MSVC 下，可以使用 SEH（结构化异常处理）捕获第三方库调用期间发生的访问违例，并用原子标志阻止后续创建操作。

## 完整示例

```cpp
#if defined(Q_OS_WIN) && defined(_MSC_VER)
#include <windows.h>
#include <atomic>
#endif

namespace {
#if defined(Q_OS_WIN) && defined(_MSC_VER)
std::atomic<bool> trtCreationFaulted{false};

// Keep C++ argument construction outside the SEH frame.
__declspec(noinline) void* createTrt(const std::string& model, int batch,
                                     const std::string& logFile)
{
    return trtinfe::createTrtInference(model, batch, logFile);
}

void* createTrtGuarded(const std::string& model, int batch,
                       const std::string& logFile, bool& accessViolation)
{
    __try {
        return createTrt(model, batch, logFile);
    } __except (GetExceptionCode() == EXCEPTION_ACCESS_VIOLATION
                    ? EXCEPTION_EXECUTE_HANDLER : EXCEPTION_CONTINUE_SEARCH) {
        accessViolation = true;
        return nullptr;
    }
}
#endif
}

bool InferenceStage::init(const Config& cfg)
{
    const auto modelPath = qj::toS(cfg, "model", "Model/targetDetectModel_3050GPU_fp32.kj");
    const int batch = qj::toI(cfg, "batch_size", 1);
    const auto logFile = qj::toS(cfg, "log_file", "trtInference.log");
#if defined(Q_OS_WIN) && defined(_MSC_VER)
    if (trtCreationFaulted.load()) {
        qWarning() << "[AnalysisTrace] event=create_trt_rejected reason=previous_access_violation";
        return false;
    }
    bool accessViolation = false;
    m_obj = createTrtGuarded(modelPath, batch, logFile, accessViolation);
    if (accessViolation) {
        trtCreationFaulted.store(true);
        qWarning() << "[AnalysisTrace] event=create_trt_failed exception=0xC0000005";
        return false;
    }
#else
    m_obj = trtinfe::createTrtInference(modelPath, batch, logFile);
#endif
    if (!m_obj) return false;
    trtinfe::setLogToFile(m_obj, qj::toB(cfg, "log_to_file", false));
    applyConfig(cfg);
    return true;
}
```

## 1. 使用 SEH 捕获访问违例

`__try` 和 `__except` 是 MSVC 支持的 SEH 语法。过滤器只处理 `EXCEPTION_ACCESS_VIOLATION`，其他异常返回 `EXCEPTION_CONTINUE_SEARCH`，由系统继续搜索处理程序。

在 `/EHsc` 模型下，C++ 的 `catch(...)` 处理标准 C++ 异常。在 `/EHa` 下，它也可以捕获结构化异常。异常处理模型应结合编译选项判断。

## 2. 隔离需要对象展开的代码

使用 `/EHsc` 时，在包含 `__try` 的函数中使用需要析构的局部对象可能产生 C2712。示例将调用拆到 `createTrt`，并使 `createTrtGuarded` 使用引用参数，避免在 SEH 函数中引入需要析构的局部对象。

`__declspec(noinline)` 防止编译器将 `createTrt` 内联到调用处。是否发生 C2712 仍取决于函数中的具体对象和编译选项。

## 3. 原子标志与并发

首次捕获访问违例后，代码将 `trtCreationFaulted` 设为 `true`，后续看到该标志的调用会直接返回失败。

`std::atomic<bool>` 保证标志的并发读写不会产生数据竞争。检查标志和调用第三方库之间没有互斥保护，因此多个线程仍可能同时通过检查并进入创建操作。

## 4. 其他平台

条件编译只在 Windows 和 MSVC 条件成立时启用 SEH。其他构建环境直接调用第三方库，具体异常行为取决于平台和编译器。

## 注意事项

- 捕获访问违例只提供失败处理路径，异常发生时进程状态可能已经受损，是否继续运行需要根据第三方库和应用的实际情况判断。
- 访问违例的原因需要结合调用栈、转储和环境信息定位，无法仅凭异常类型确定是驱动或版本问题。
- 标志在当前实现中没有重置路径，其作用域为进程生命周期。
- 不同异常模型下的析构与栈展开行为需要结合实际调用链验证，SEH 函数自身没有局部对象不能保证第三方调用栈中的对象都已正确清理。

## 参考资料

- [Microsoft Learn：编译器错误 C2712](https://learn.microsoft.com/en-us/cpp/error-messages/compiler-errors-2/compiler-error-c2712)
- [Microsoft Learn：MSVC 异常处理模型](https://learn.microsoft.com/en-us/cpp/build/reference/eh-exception-handling-model)
