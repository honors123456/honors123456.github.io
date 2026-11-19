---
title: "__try/__except：用 SEH 保护 MSVC 下的第三方库调用"
date: 2026-11-18
description: "为什么普通 try/catch 捕获不到第三方库初始化时的访问违例，以及如何用 __try/__except 加原子标志把一次崩溃降级为一次可控的失败。"
draft: false
---

第三方库（下文的 `trtinfe::createTrtInference`）在初始化阶段触发访问违例时，进程默认直接终止。普通 `try/catch` 拦不住，因为 `0xC0000005` 是 Windows 结构化异常（SEH），不是 C++ 异常。下面的方案把这次崩溃降级为一次可观测的失败，并让之后的调用直接短路。

## 1. 为什么 `try/catch` 无效

```cpp
// 直觉上最自然的写法，实际拦不住
try {
    m_obj = trtinfe::createTrtInference(modelPath, batch, logFile);
} catch (const std::exception& e) {
    // 不会进入
} catch (...) {
    // 也不会进入
}
// 结果：输出 "0xC0000005: 读取访问权限冲突"，进程退出
```

两者的差别在于**异常从哪里来、由谁分派**：

| 项目 | C++ 异常 | SEH（结构化异常） |
|---|---|---|
| 产生方式 | 代码主动 `throw` | CPU/OS 触发，如空指针解引用 |
| 分派入口 | `_CxxThrowException` | `KiUserExceptionDispatcher` |
| 典型代码 | `0xE06D7363` | `0xC0000005`（访问违例） |
| `/EHsc` + `catch(...)` | 能捕获 | **不能捕获** |
| `/EHa` + `catch(...)` | 能捕获 | 能捕获，但整模块按展开语义编译 |

所以要"接住"访问违例，只能使用 MSVC 的 SEH 语法 `__try` / `__except`。

## 2. 一次失败的完整执行路径

先看控制流，再看代码会更容易对上号：

```text
init(cfg)
  │
  ├─ trtCreationFaulted == true ? ── 是 ──▶ 日志 create_trt_rejected
  │                                        立即 return false（不再碰第三方库）
  └─ 否
      │
      ▼
  createTrtGuarded(...)            ← SEH 帧的边界
      │  __try
      ▼
  createTrt(...)                   ← 帧内无局部对象，可自由内联
      │
      ▼
  trtinfe::createTrtInference(...) ← 第三方库
      │
      ├─ 正常返回 ─▶ 指针非空 ─▶ setLogToFile / applyConfig ─▶ return true
      │
      └─ 触发 0xC0000005
             │
             ▼
         过滤器：GetExceptionCode() == EXCEPTION_ACCESS_VIOLATION ?
             │
             ├─ 是 ─▶ EXCEPTION_EXECUTE_HANDLER ─▶ 进入 __except 块
             │                                      accessViolation = true
             │                                      return nullptr
             └─ 否 ─▶ EXCEPTION_CONTINUE_SEARCH ─▶ 交给外层，最终进程终止
```

回到 `init`：看到 `accessViolation == true`，就把 `trtCreationFaulted` 置位并返回 `false`。

## 3. 最小版本：每个部分负责什么

去掉日志和业务代码后，核心只有两个函数，对应上图的两层：

```cpp
// ① 真正干活的函数：只做转发，没有需要析构的局部对象
__declspec(noinline)
void* createTrt(const std::string& model, int batch, const std::string& logFile)
{
    return trtinfe::createTrtInference(model, batch, logFile);
}

// ② SEH 帧只负责"接住"访问违例，③ 并把它翻译成一个布尔量
void* createTrtGuarded(const std::string& model, int batch,
                       const std::string& logFile, bool& accessViolation)
{
    __try {
        return createTrt(model, batch, logFile);
    } __except (GetExceptionCode() == EXCEPTION_ACCESS_VIOLATION
                    ? EXCEPTION_EXECUTE_HANDLER : EXCEPTION_CONTINUE_SEARCH) {
        accessViolation = true;   // ④ 只有走到这里才代表"被捕获"
        return nullptr;
    }
}
```

每一部分去掉之后会发生什么，比逐句解释代码更能说明它的必要性：

| 部分 | 作用 | 去掉后的后果 |
|---|---|---|
| ① `createTrt` + `noinline` | 把可能触发对象展开的代码移出 SEH 帧 | 帧内出现 `std::string` 局部对象或传值参数，编译报 C2712 |
| ② `__try` 块 | 划出被保护的区域 | 访问违例无人处理，进程立即终止 |
| ③ 过滤器表达式 | 只把访问违例当作"可处理"，其余继续上抛 | 其他故障也被吞掉，真正的问题被掩盖 |
| ④ `accessViolation` | 把控制流事实转成调用方可读的状态 | 分不清"库返回空"和"崩溃被拦下" |

返回值留给对象指针，所以"是否发生违例"只能通过出参 `bool&` 带出来——这也是 `createTrtGuarded` 签名看起来偏长的原因。

## 4. 完整实现

把上面的骨架放回真实代码，加上日志和进程级标志：

```cpp
#if defined(Q_OS_WIN) && defined(_MSC_VER)
#include <windows.h>
#include <atomic>
#endif

namespace {
#if defined(Q_OS_WIN) && defined(_MSC_VER)
std::atomic<bool> trtCreationFaulted{false};   // ⑤ 进程级"已故障"标记

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
    if (trtCreationFaulted.load()) {           // ⑥ 短路：不再进入 SEH 帧
        qWarning() << "[AnalysisTrace] event=create_trt_rejected reason=previous_access_violation";
        return false;
    }
    bool accessViolation = false;
    m_obj = createTrtGuarded(modelPath, batch, logFile, accessViolation);
    if (accessViolation) {
        trtCreationFaulted.store(true);        // ⑦ 一次失败即永久关闭创建路径
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

⑤⑥⑦ 合起来的效果，可以用"第几次调用"直接检验：

| 调用次序 | `trtCreationFaulted` | 行为 |
|---|---|---|
| 第 1 次 | `false` | 进入 SEH，捕获访问违例，置位，返回 `false` |
| 第 2 次及以后 | `true` | 立即返回 `false`，日志 `reason=previous_access_violation` |

## 5. 三个容易踩的坑

### 5.1 C2712：SEH 帧里不能有需要析构的对象

`/EHsc` 下编译器无法在 SEH 函数里安排对象析构，只能拒绝编译：

```cpp
// ✗ 编译报 C2712：无法在使用 __try 的函数中使用需要对象展开的对象
void* guarded(const std::string model)   // 按值传参，参数需要析构
{
    std::string log = "trt.log";         // 局部对象同样会触发
    __try {
        return trtinfe::createTrtInference(model, 1, log);
    } __except (EXCEPTION_EXECUTE_HANDLER) {
        return nullptr;
    }
}
```

修正方式就是第 3 节的两层拆分：**SEH 函数只用引用/指针传参，帧内不出现任何带析构函数的局部对象**。`__declspec(noinline)` 保证 `createTrt` 不会被内联回来，让这条界线不会被优化掉。

需要在别处权衡时，MSVC 给出的三条出路是：把 SEH 代码挪到独立函数、去掉带析构的局部变量和参数、或者不用 `/EHsc` 编译。`/EHa` 不会报 C2712，代价是整个模块的异常都走 C++ 展开路径。

### 5.2 原子标志是"事后止损"，不是"事前互斥"

检查和调用之间没有锁，多个线程可以同时通过检查：

```text
线程 A ──┐
线程 B ──┴── 同时看到 trtCreationFaulted == false ──▶ 各自执行一次创建
                                                     标志只能拦住"之后"的调用
```

`std::atomic<bool>` 只保证标志本身的读写不产生数据竞争。要防重复初始化，需要在 `init` 外层加互斥或使用一次性的初始化语义。

### 5.3 捕获之后，进程状态未知

SEH 处理程序执行前的栈展开**不会**调用中间帧的析构函数，第三方库内部已经分配的资源不会释放。再加上访问违例可能发生在库持有锁、改过全局状态之后，`__except` 只保证控制流回到你的代码，不保证进程状态一致。

因此这里选择"标记永久失败、不再重试"，而不是"回滚后重试"。是否允许进程继续运行，必须结合第三方库和应用的实际行为判断。

## 6. 如何确认这一步真的生效

- **调试器**：在"异常设置"里勾选 `Win32 Exceptions` → `0xC0000005 Access violation`，可以让程序在进入 `__except` 之前停下，直接查看故障调用栈。
- **日志**：应当看到 `event=create_trt_failed exception=0xC0000005`，随后每次都是 `event=create_trt_rejected reason=previous_access_violation`。
- **只有 rejected 没有 failed**：说明本次进程里没有真正捕获过异常（可能是重启过进程，标志已重置），需要回到第一次失败的位置重新确认。
- **异常类型不能替代定位**：究竟是驱动、模型还是版本问题，仍要结合调用栈、转储和环境信息判断。

## 参考资料

- [Microsoft Learn：`__try`/`__except` 语句](https://learn.microsoft.com/en-us/cpp/cpp/try-except-statement)
- [Microsoft Learn：编译器错误 C2712](https://learn.microsoft.com/en-us/cpp/error-messages/compiler-errors-2/compiler-error-c2712)
- [Microsoft Learn：MSVC 异常处理模型 `/EH`](https://learn.microsoft.com/en-us/cpp/build/reference/eh-exception-handling-model)