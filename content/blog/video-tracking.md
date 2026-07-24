---
title: "OpenCV 视频目标跟踪"
date: 2026-07-24
url: "/opencv/video-tracking.html"
categories: ["OpenCV"]
tags: ["tracking", "video"]
description: "视频目标跟踪流程和工程注意事项。"
---

目标跟踪通常包括检测、初始化、逐帧更新和丢失恢复。工程中要同时关注算法效果和实时性。

处理视频时，先稳定输入帧率和图像尺寸，再比较不同跟踪器。对实时应用，丢帧策略往往比单帧算法速度更重要。
