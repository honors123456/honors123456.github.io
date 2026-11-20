---
title: "OpenCV 图像调整：亮度、色阶、白平衡与滤镜"
date: 2026-11-20
description: "从像素变换和卷积理解常见图像调整，并用 C++ 与 OpenCV 实现亮度、对比度、饱和度、色阶、伪彩、白平衡、负片、Gamma、锐化和滤镜。"
draft: false
---

图像编辑器里的“亮度”“色阶”“锐化”看起来是独立功能，底层大多可以归为两类操作：逐像素变换和邻域卷积。逐像素变换只看当前像素的颜色；卷积则会读取周围像素。理解这两类操作后，就能自己组合出常见的调色和滤镜效果。

本文约定输入是 OpenCV 常见的 8 位三通道 `BGR` 图像，像素范围为 `[0, 255]`。示例使用 OpenCV 4.x 的 C++ API。

## 1. 准备代码

下面的头文件和读取代码供后续示例共用。OpenCV 的 `imread` 默认按 BGR 顺序读入彩色图像。

```cpp
#include <opencv2/opencv.hpp>

#include <algorithm>
#include <cmath>
#include <iostream>

int main()
{
    cv::Mat src = cv::imread("input.jpg", cv::IMREAD_COLOR);
    if (src.empty()) {
        std::cerr << "Failed to read input.jpg\n";
        return 1;
    }

    // 在这里调用后文的处理函数。
    return 0;
}
```

以 CMake 构建时，可以使用 OpenCV 提供的 CMake 配置：

```cmake
cmake_minimum_required(VERSION 3.16)
project(ImageAdjustments LANGUAGES CXX)

find_package(OpenCV REQUIRED)
add_executable(image_adjustments main.cpp)
target_link_libraries(image_adjustments PRIVATE ${OpenCV_LIBS})
target_include_directories(image_adjustments PRIVATE ${OpenCV_INCLUDE_DIRS})
```

## 2. 亮度与对比度

### 原理

最直接的线性亮度与对比度变换是：

\[
y = \operatorname{clip}(\alpha x + \beta, 0, 255)
\]

`x` 是输入通道值，`y` 是输出值；`β` 控制整体变亮或变暗，`α` 控制与中间灰度的距离。`α > 1` 会拉开明暗差异，`0 < α < 1` 会压缩差异。截断到 `[0,255]` 是必要的，因为 8 位图像无法表示范围之外的值。

这个变换简单、快速，但大幅调节会把亮部压成纯白或把暗部压成纯黑，丢掉细节。它也不是感知上均匀的“亮度”，只是对编码后的通道值做线性运算。

```cpp
cv::Mat adjustBrightnessContrast(const cv::Mat& src,
                                 double alpha,
                                 double beta)
{
    CV_Assert(src.type() == CV_8UC3);

    cv::Mat dst;
    src.convertTo(dst, CV_8UC3, alpha, beta);
    return dst;
}

// 示例：对比度增加 20%，整体提亮 12。
// cv::Mat dst = adjustBrightnessContrast(src, 1.2, 12.0);
```

`convertTo` 会按目标类型饱和转换，结果超出范围时被截到合法值。对交互式滑块，可将 `alpha` 限制在合理区间，并把 `beta` 设为以 0 为中心的偏移量。

## 3. 饱和度

### 原理

饱和度描述颜色偏离灰色的程度。常见做法是把像素转到 HSV 空间，只缩放 `S`（饱和度）通道，保持色相 `H` 与明度 `V` 不变。乘数大于 1 增艳，小于 1 去饱和；最后将 `S` 限制在 OpenCV 8 位 HSV 的 `[0,255]` 范围。

这是一种直观的颜色编辑方式，但 HSV 的 `V` 并非严格的物理亮度。若需要颜色科学意义上的亮度或跨设备一致性，应考虑线性 RGB、Lab 或相机色彩管理流程。

```cpp
cv::Mat adjustSaturation(const cv::Mat& src, float scale)
{
    CV_Assert(src.type() == CV_8UC3);

    cv::Mat hsv;
    cv::cvtColor(src, hsv, cv::COLOR_BGR2HSV);

    std::vector<cv::Mat> channels;
    cv::split(hsv, channels);
    channels[1].convertTo(channels[1], CV_8U, scale);
    cv::merge(channels, hsv);

    cv::Mat dst;
    cv::cvtColor(hsv, dst, cv::COLOR_HSV2BGR);
    return dst;
}

// cv::Mat vivid = adjustSaturation(src, 1.35f);
```

## 4. 左右色阶（输入黑白场与输出黑白场）

### 原理

色阶通常有四个端点：输入黑场 `inBlack`、输入白场 `inWhite`，以及输出黑场 `outBlack`、输出白场 `outWhite`。先把输入区间 `[inBlack, inWhite]` 线性映射到 `[outBlack, outWhite]`：

\[
y = outBlack + \frac{x-inBlack}{inWhite-inBlack}(outWhite-outBlack)
\]

超出输入区间的值被夹到端点。左右黑白滑块常用于裁切和拉伸输入动态范围；输出黑白滑块则用于限制最终范围。若 `inBlack == inWhite`，分母为零，因此参数必须满足 `inWhite > inBlack`。

```cpp
cv::Mat adjustLevels(const cv::Mat& src,
                     int inBlack, int inWhite,
                     int outBlack = 0, int outWhite = 255)
{
    CV_Assert(src.type() == CV_8UC3);
    CV_Assert(0 <= inBlack && inBlack < inWhite && inWhite <= 255);
    CV_Assert(0 <= outBlack && outBlack <= outWhite && outWhite <= 255);

    cv::Mat lut(1, 256, CV_8U);
    const double scale = static_cast<double>(outWhite - outBlack)
                       / (inWhite - inBlack);

    for (int x = 0; x < 256; ++x) {
        const double clipped = std::clamp(x, inBlack, inWhite);
        const int y = cvRound(outBlack + (clipped - inBlack) * scale);
        lut.at<uchar>(x) = cv::saturate_cast<uchar>(y);
    }

    cv::Mat dst;
    cv::LUT(src, lut, dst); // 同一曲线分别作用于 B、G、R 三个通道。
    return dst;
}

// 将输入 16..235 拉伸到完整输出范围。
// cv::Mat stretched = adjustLevels(src, 16, 235);
```

这里的“左右色阶”按常见色阶面板理解为黑场与白场端点。如果界面还提供中间调（Gamma）滑块，可对归一化后的结果再做幂函数映射；它与下文的 Gamma 校正是同一类非线性曲线。

## 5. 伪彩（颜色映射）

### 原理

伪彩把单通道灰度值映射成彩色，用颜色区分原本只有明暗差别的数值。它不会恢复图像中不存在的颜色信息，主要用于深度图、热力图、响应强度和分割结果的可视化。

```cpp
cv::Mat makePseudoColor(const cv::Mat& gray, int colorMap)
{
    CV_Assert(gray.type() == CV_8UC1);

    cv::Mat color;
    cv::applyColorMap(gray, color, colorMap);
    return color; // 输出为 BGR 三通道图像。
}

// cv::Mat heat = makePseudoColor(gray, cv::COLORMAP_TURBO);
```

`applyColorMap` 的输入应是 8 位单通道数据。若原始测量值是浮点数或范围很大，先按实际有效区间归一化到 `[0,255]`，并记录映射范围，否则同一颜色无法对应稳定的数值含义。用于分析的图表优先选择感知上较均匀的色图；彩虹色图可能制造虚假的边缘感。

## 6. 白平衡

### 原理

白平衡的目标是让拍摄场景中的中性物体（灰、白）在输出图像里仍接近中性。一个简单的“灰度世界”假设认为整幅场景的平均 R、G、B 应接近相等，于是分别计算每个通道的增益，把通道均值拉到共同目标值。

这个假设在颜色种类丰富的场景中通常尚可，但遇到大面积单色物体（例如草地、蓝天）会误判。它也可能放大噪声或造成高光裁切。更可靠的白平衡通常利用灰卡、相机元数据或局部光源估计。

```cpp
cv::Mat grayWorldWhiteBalance(const cv::Mat& src)
{
    CV_Assert(src.type() == CV_8UC3);

    cv::Scalar meanBgr = cv::mean(src);
    const double target = (meanBgr[0] + meanBgr[1] + meanBgr[2]) / 3.0;

    cv::Mat dst;
    const double gainB = target / std::max(meanBgr[0], 1.0);
    const double gainG = target / std::max(meanBgr[1], 1.0);
    const double gainR = target / std::max(meanBgr[2], 1.0);

    // OpenCV 通道顺序是 B、G、R。逐通道缩放并饱和到 8 位。
    std::vector<cv::Mat> channels;
    cv::split(src, channels);
    channels[0].convertTo(channels[0], CV_8U, gainB);
    channels[1].convertTo(channels[1], CV_8U, gainG);
    channels[2].convertTo(channels[2], CV_8U, gainR);
    cv::merge(channels, dst);
    return dst;
}
```

在高质量工作流中，可先把 sRGB 解码到线性光空间再估计和应用通道增益，最后重新编码；上面针对普通 8 位照片的简化实现直接处理编码值，适合作为入门示例。

## 7. 负片

### 原理

8 位负片反相就是每个通道执行 `y = 255 - x`。黑色变白色、白色变黑色，颜色通道也分别反相。它不是曝光校正，也不会自动生成传统胶片的色彩响应。

```cpp
cv::Mat makeNegative(const cv::Mat& src)
{
    CV_Assert(src.type() == CV_8UC3);

    cv::Mat dst;
    cv::bitwise_not(src, dst);
    return dst;
}
```

若数据不是 8 位无符号整数，`bitwise_not` 表示按位取反，并不等价于“最大值减去像素”。此时应根据像素类型和数据范围明确计算反相公式。

## 8. Gamma 校正

### 原理

先把像素归一化到 `[0,1]`，再计算：

\[
y = x^{\gamma}
\]

在这个定义下，`γ < 1` 会提亮暗部，`γ > 1` 会压暗图像。Gamma 曲线是非线性的，因此比简单偏移更能按比例调整不同亮度段。注意有些软件用 `1/γ` 参数化，滑块方向可能相反；应以公式和测试样例确认。

```cpp
cv::Mat gammaCorrection(const cv::Mat& src, double gamma)
{
    CV_Assert(src.type() == CV_8UC3);
    CV_Assert(gamma > 0.0);

    cv::Mat lut(1, 256, CV_8U);
    for (int x = 0; x < 256; ++x) {
        const double normalized = x / 255.0;
        const double corrected = std::pow(normalized, gamma) * 255.0;
        lut.at<uchar>(x) = cv::saturate_cast<uchar>(cvRound(corrected));
    }

    cv::Mat dst;
    cv::LUT(src, lut, dst);
    return dst;
}

// cv::Mat brighterShadows = gammaCorrection(src, 0.75);
```

查找表让每个 8 位输入值只计算一次幂函数，整张图只需快速查表。处理 RAW 或 HDR 浮点数据时，不应把数据随意压成 8 位再做校正；应保留浮点范围并使用符合工作色彩空间的变换。

## 9. 锐化

### 原理

锐化常用反遮罩（unsharp mask）：先对图像做模糊，得到低频部分；再把原图与模糊图的差（高频细节）按强度加回：

\[
sharp = original + amount \times (original - blurred)
\]

`amount` 越大，边缘越明显，但噪声、压缩块和光晕也会一起增强。先轻微降噪、再锐化通常比持续增大强度更稳妥。

```cpp
cv::Mat sharpen(const cv::Mat& src, double amount = 1.0,
                double sigma = 1.0)
{
    CV_Assert(src.type() == CV_8UC3);
    CV_Assert(amount >= 0.0 && sigma > 0.0);

    cv::Mat blurred;
    cv::GaussianBlur(src, blurred, cv::Size(), sigma);

    cv::Mat dst;
    cv::addWeighted(src, 1.0 + amount,
                    blurred, -amount,
                    0.0, dst);
    return dst;
}

// cv::Mat crisp = sharpen(src, 0.8, 1.2);
```

`addWeighted` 会饱和转换到输入类型。若需要控制只锐化亮度，可转到 Lab 或 YCrCb，仅处理亮度通道，再合并色度通道，避免彩色边缘产生明显色晕。

## 10. 常见滤镜：模糊、中值与双边

“滤镜”是一个很宽泛的词。以下三种滤波器都读取邻域，但保留的信息不同：

| 滤镜 | 主要效果 | 适合场景 | 代价或局限 |
|---|---|---|---|
| 高斯模糊 | 加权平均，抑制高频细节 | 柔化、降噪、构造锐化用的低频图 | 边缘也会变软 |
| 中值滤波 | 邻域排序后取中值 | 去除孤立的黑白椒盐点 | 大核会抹掉细小结构 |
| 双边滤波 | 同时考虑空间距离和颜色差异 | 尽量保边的平滑 | 通常比高斯模糊更慢，参数需调节 |

```cpp
cv::Mat gaussianFilter(const cv::Mat& src, int kernelSize, double sigma)
{
    CV_Assert(kernelSize > 0 && kernelSize % 2 == 1);
    cv::Mat dst;
    cv::GaussianBlur(src, dst, cv::Size(kernelSize, kernelSize), sigma);
    return dst;
}

cv::Mat medianFilter(const cv::Mat& src, int kernelSize)
{
    CV_Assert(kernelSize > 0 && kernelSize % 2 == 1);
    cv::Mat dst;
    cv::medianBlur(src, dst, kernelSize);
    return dst;
}

cv::Mat bilateralFilterImage(const cv::Mat& src, int diameter,
                             double sigmaColor, double sigmaSpace)
{
    cv::Mat dst;
    cv::bilateralFilter(src, dst, diameter,
                        sigmaColor, sigmaSpace);
    return dst;
}
```

高斯核大小必须是正奇数；中值滤波的核大小也必须是正奇数，且 OpenCV 对 8 位图像的中值核有实现限制。双边滤波的 `sigmaColor` 控制颜色相近程度，`sigmaSpace` 控制空间邻域范围；增大参数会更强地平滑，也会增加计算量。

还可以使用卷积核实现自定义线性滤镜。例如 3×3 均值核把邻域平均，拉普拉斯核突出二阶变化。卷积核元素之和及锚点会影响亮度和边缘行为，使用前应明确其设计目的。

```cpp
cv::Mat customSharpenKernel(const cv::Mat& src)
{
    const cv::Mat kernel = (cv::Mat_<float>(3, 3) <<
         0, -1,  0,
        -1,  5, -1,
         0, -1,  0);

    cv::Mat dst;
    cv::filter2D(src, dst, -1, kernel);
    return dst;
}
```

## 11. 组合处理与实践建议

下面展示如何把函数串起来。顺序会影响结果：例如先大幅拉伸色阶再锐化，容易把噪声放大；先做白平衡再调饱和度通常更容易控制颜色。

```cpp
cv::Mat result = grayWorldWhiteBalance(src);
result = adjustBrightnessContrast(result, 1.05, 3.0);
result = adjustSaturation(result, 1.10f);
result = sharpen(result, 0.5, 1.0);

if (!cv::imwrite("output.jpg", result)) {
    std::cerr << "Failed to write output.jpg\n";
    return 1;
}
```

实际项目还应注意：

1. **保留原图**：每次滑块变化都从原始图重新计算，避免反复处理造成量化误差累积。
2. **确认颜色空间和通道顺序**：OpenCV 默认彩色顺序是 BGR；HSV、Lab 等转换必须使用匹配的转换码。
3. **控制裁切**：亮度、色阶、白平衡和锐化都可能让通道饱和。必要时在浮点图像中处理并检查直方图。
4. **区分预览与测量**：伪彩适合可视化数值，不应把伪彩结果误当成原始颜色数据。
5. **验证边界输入**：检查空图、错误类型、非法 Gamma、反向色阶端点和核尺寸。本文函数用 `CV_Assert` 表达基本前置条件。

这些操作提供了图像调节的基础积木。了解公式和数据范围后，可以把它们连接到 Qt 滑块、批量处理工具或实时视频流水线中，并按目标图像和色彩空间选择合适算法。
