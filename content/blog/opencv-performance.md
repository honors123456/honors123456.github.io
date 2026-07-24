---
title: "OpenCV 性能优化实践"
date: 2026-07-24
url: "/projects/opencv-performance.html"
categories: ["OpenCV"]
tags: ["performance", "video"]
description: "OpenCV 视频和图像处理中的常见性能优化方向。"
---

OpenCV 优化先看数据流，再看算法。很多性能问题来自重复分配、无意义拷贝、格式转换和 UI 线程阻塞。

## 检查顺序

1. 确认输入尺寸、帧率和颜色格式。
2. 避免在循环里反复创建大对象。
3. 尽量复用缓冲区。
4. 把耗时处理移出 UI 线程。
5. 用计时和 profile 定位瓶颈。

```cpp
cv::Mat gray;
cv::cvtColor(frame, gray, cv::COLOR_BGR2GRAY);
cv::GaussianBlur(gray, gray, cv::Size(5, 5), 0);
```

先测量，再优化。不要凭感觉替换算法。
