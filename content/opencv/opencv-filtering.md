---
title: "图像滤波详解：从卷积核到保边降噪"
date: 2026-11-20
description: "梳理线性与非线性滤波：相关与卷积的区别、核归一化、边界处理、均值/高斯/中值/双边/导向/非局部均值、频域低通与高通，以及 OpenCV C++ 实现与选型建议。"
draft: false
---

[《OpenCV 图像调整》]({{< relref "opencv-image-adjustments.md" >}})把常见调节归纳成两类操作：逐像素变换和邻域运算。前者只看当前像素，后者要读取周围像素。滤波属于第二类，也是图像处理里最常用、最容易被低估的一类运算。

本文讨论的是通用的邻域滤波：平滑、去噪、保边、频域低通/高通和基于它的锐化。所有示例基于 OpenCV 4.x 的 C++ API，输入默认是 8 位三通道 `BGR` 图像，个别算法会明确要求 `CV_32F`。

## 1. 滤波在做什么

滤波的输出像素由输入图像的一个邻域决定。可以写成：

```text
output(x, y) = F( input(x+i, y+j) ),  (i, j) ∈ [-r, r] × [-r, r]
```

`F` 决定滤波器的性质：

- **线性滤波**：`F` 是加权求和，权重由核（kernel）给出。均值、高斯、Sobel、拉普拉斯都属于这一类，可以用卷积表示，也能在频域实现。
- **非线性滤波**：`F` 是排序、取极值、按相似度加权等运算。中值、双边、非局部均值、形态学滤波属于这一类，不能用单个核描述。

线性滤波擅长处理高斯型噪声和频率选择；非线性滤波擅长在去噪的同时保留边缘。选错类型的典型现象是：用高斯滤波去椒盐噪声，结果椒盐点被抹成一团模糊；用中值滤波去除高斯噪声，效果聊胜于无。

## 2. 卷积核：相关、卷积与归一化

### 相关与卷积

严格来说，卷积要把核翻转 180° 再做加权求和，而不翻转的叫相关（cross-correlation）。`cv::filter2D` 实现的是相关：

```text
filter2D:  out(x,y) = Σ Σ K(i,j) · src(x+i, y+j)
convolution: out(x,y) = Σ Σ K(i,j) · src(x-i, y-j)
```

两者只差一次核翻转。对称核（均值核、高斯核、拉普拉斯核）没有区别；不对称核（例如某些方向性核、模板匹配用的核）会得到转置后的结果。写图像处理代码时，“滤波器”和“卷积”经常混用，但实现层面需要清楚这一点。

### 一个手写的 3×3 均值核

```cpp
// 3×3 均值核，权重和为 1，输出整体亮度不变。
cv::Mat meanKernel3 = (cv::Mat_<float>(3, 3) <<
    1.f / 9, 1.f / 9, 1.f / 9,
    1.f / 9, 1.f / 9, 1.f / 9,
    1.f / 9, 1.f / 9, 1.f / 9);

cv::Mat smooth;
cv::filter2D(src, smooth, CV_8UC3, meanKernel3);
```

`filter2D` 的 `ddepth` 设为 `-1` 表示输出与输入同类型，超出范围会被饱和截断。若核含负系数（锐化、拉普拉斯、边缘检测），中间结果会超出 `[0, 255]`，此时必须用 `CV_32F` 或 `CV_16S` 作为 `ddepth`，再决定如何映射回 8 位。

### 为什么要归一化

对“平滑类”核，权重之和应为 1，否则直流分量被放大或缩小，整幅图变亮或变暗。例如：

```cpp
cv::Mat kernel = cv::Mat::ones(5, 5, CV_32F);
kernel /= static_cast<float>(kernel.total()); // 5×5 均值核
```

边缘检测核是反例：Sobel 的核和接近 0，它本意就是去掉直流、只保留梯度。归一化规则取决于滤波器想保留什么，不是无条件除以权重和。

## 3. 边界处理

核窗口在图像边缘会越界。OpenCV 用 `borderType` 决定越界像素如何取值：

| 模式 | 行为 | 典型用途 |
|---|---|---|
| `BORDER_REFLECT_101` | 以边界像素为轴镜像，边界像素不重复 | 高斯、双边等多数滤波器的默认值 |
| `BORDER_REFLECT` | 镜像且重复边界像素 | 少数需要对称延拓的场合 |
| `BORDER_REPLICATE` | 复制边界像素 | 纹理边缘延拓、快速实现 |
| `BORDER_CONSTANT` | 用指定常数填充 | 明确知道图像外是黑色的场合 |
| `BORDER_WRAP` | 从对侧循环取值 | 周期性图案、频域处理 |

`cv::filter2D`、`cv::blur`、`cv::GaussianBlur` 的默认 `borderType` 都是 `BORDER_DEFAULT`，等价于 `BORDER_REFLECT_101`；只有显式传 `BORDER_CONSTANT` 时 `borderValue` 才起作用。核半径大于 1 时，边缘 1~r 个像素的结果与内部像素口径不同；做严格定量分析（例如计算图像梯度、模板匹配）时，通常应先扩展边界或裁剪结果。

```cpp
cv::Mat padded;
cv::copyMakeBorder(src, padded, r, r, r, r, cv::BORDER_REFLECT_101);
// 在 padded 上滤波后裁剪回原尺寸，可避免多次滤波时的边界污染累积。
```

## 4. 均值滤波与方框滤波

均值滤波把邻域内所有像素等权平均：

```text
out(x,y) = (1 / (k·k)) · Σ Σ src(x+i, y+j)
```

它是低通滤波器：高频（噪声、边缘、细节）被平均掉，代价是边缘变模糊。核越大越模糊。

```cpp
cv::Mat meanBlur;
cv::blur(src, meanBlur, cv::Size(5, 5));          // 归一化方框滤波

cv::Mat sumBlur;
cv::boxFilter(src, sumBlur, CV_8UC3, cv::Size(5, 5),
              cv::Point(-1, -1), false);          // normalize = false，输出是邻域和
```

`normalize = false` 时输出是邻域和，5×5 核会让数值放大 25 倍，8 位图像会大面积饱和，一般只在后面还要除以像素数或做归一化时使用。

**复杂度**：滑动窗口实现让每个像素的计算量与核大小无关，整体是 O(N)。也可以用积分图（`cv::integral`）实现任意矩形窗口求和，同样 O(1)。

均值滤波适合：快速预览、需要极低延迟的降采样前平滑、以及作为“参考基线”比较其他滤波器。它不适合作为最终降噪手段，因为它对边缘和噪声一视同仁。

## 5. 高斯滤波

### 原理

高斯核用二维高斯函数采样得到：

```text
G(x, y) = 1 / (2πσ²) · exp( -(x² + y²) / (2σ²) )
```

`σ` 控制平滑尺度：σ 越大，权重分布越宽，模糊越强。核尺寸只需覆盖约 ±3σ 的范围，更远的权重已经可以忽略。

高斯滤波的两个重要性质：

1. **可分离**：`G(x, y) = g(x) · g(y)`，二维卷积可以拆成先横向一维、再纵向一维，每像素运算量从 O(k²) 降到 O(k)。
2. **可叠加**：连续做 σ₁、σ₂ 两次高斯滤波，等价于一次 `σ = sqrt(σ₁² + σ₂²)` 的滤波。这解释了为什么“多次轻微模糊”和“一次强模糊”在数学上等价。

### OpenCV 的尺寸与 σ 关系

`GaussianBlur` 在参数缺省时会互相推导：

- 给 `sigma`、`ksize = (0,0)`：8 位图像取 `ksize ≈ round(6σ + 1) | 1`，保证覆盖 ±3σ。
- 给 `ksize`、`sigma = 0`：由核大小反推 `σ ≈ 0.3·((ksize-1)/2 - 1) + 0.8`。

这两个公式决定了“调 σ”和“调核大小”并不独立。希望精确控制平滑尺度时，只指定 `sigma`，让 OpenCV 自己算核大小。

```cpp
cv::Mat gauss;
cv::GaussianBlur(src, gauss, cv::Size(0, 0), 2.0); // 只给 σ，核大小自动推导

// 等价的可分离写法：显式生成一维核，便于和其他一维滤波组合。
cv::Mat kx = cv::getGaussianKernel(9, 2.0, CV_32F);
cv::Mat ky = cv::getGaussianKernel(9, 2.0, CV_32F);
cv::Mat gaussSep;
cv::sepFilter2D(src, gaussSep, CV_8UC3, kx, ky);
```

`GaussianBlur` 针对 8 位图像做了定点运算和 SIMD 优化，通常比手写 `filter2D`（浮点核）快数倍。除非要自定义边界或与其他核拼接，否则优先使用它。

### 用在哪里

- **轻降噪**：σ 在 0.8~1.5，去掉传感器噪声和 JPEG 块，代价可接受。
- **抗锯齿**：缩小图像前先按缩放比例做高斯模糊，避免混叠。
- **图像金字塔**：`cv::pyrDown` 内部就是高斯模糊加隔点采样。
- **作为其他算法的前置**：Canny 的边缘检测、模板匹配的预处理。

高斯滤波不保边。σ 越大，边缘越糊。想保边就要用后面的双边、导向滤波或非局部均值。

## 6. 中值滤波

### 原理

中值滤波取邻域内所有像素的中位数：

```text
out(x,y) = median{ src(x+i, y+j) | (i,j) ∈ [-r, r]² }
```

它是排序统计滤波器，不是加权求和，因此无法写成卷积核。中值的稳健性来自“少数极端值不影响中位数”：椒盐噪声（接近 0 或 255 的孤立点）在排序后落到两端，被直接丢弃，而边缘两侧的像素仍占多数，所以边缘能较好保留。

### 实现与限制

朴素实现需要对每个像素的 k² 个值排序，复杂度 O(N·k²·log k)。OpenCV 对 8 位图像使用滑动直方图，逐像素更新直方图并定位中位，整体接近 O(N)，因此大核也不至于慢得无法接受。

```cpp
cv::Mat median;
cv::medianBlur(src, median, 5);
```

参数约束：

- `ksize` 必须是大于 1 的奇数（3、5、7……）。
- `ksize` 大于 5 时，输入只能是 `CV_8U`；3 和 5 支持 `CV_8U`、`CV_16U`、`CV_32F`。
- 三通道图像是**逐通道**取中值，通道之间可能来自不同像素，彩色边缘可能出现杂色点。

最后一点常被忽略：对彩色图逐通道中值，等效于在每个通道上独立丢弃极值，结果可能出现原图中不存在的颜色。对颜色敏感的场景，可以先转到 Lab 或 YCrCb，只对亮度通道做中值，再合并。

### 用在哪里

椒盐噪声、孤立坏点、扫描件的灰尘与划痕、红外/深度图中孤立的无效值。对高斯噪声，中值滤波不如小 σ 的高斯或双边有效。

## 7. 双边滤波

### 原理

双边滤波在空间距离之外再加一个“值域距离”权重：

```text
w(p, q) = exp( -|p - q|² / (2σs²) ) · exp( -|I(p) - I(q)|² / (2σc²) )
out(p)  = Σ w(p, q) · I(q) / Σ w(p, q)
```

- `σs`（`sigmaSpace`）：空间尺度，决定参与加权的邻域半径。
- `σc`（`sigmaColor`）：值域尺度，决定“多大亮度差以内还算同类”。差值远大于 `σc` 的像素权重趋近 0，于是边缘两侧不会互相混合。

这正是它保边的原因：平坦区域内部亮度差很小，权重接近高斯，噪声被平均；跨越边缘时亮度差很大，权重被压制，边缘得以保留。

```cpp
cv::Mat bilateral;
cv::bilateralFilter(src, bilateral, 9, 75, 75);
```

参数说明：

- `d` 是邻域直径。`d <= 0` 时按 `d ≈ 2·round(1.5σs) + 1` 自动推导；`d > 5` 时算法会变慢，`d = 5` 对多数 8 位图像已足够。
- `sigmaColor` 取 50~150 是常见区间；值越大越接近高斯模糊，越小越“只平滑非常相似的颜色”。
- 输入支持 `CV_8U` 的 1/3 通道和 `CV_32F` 的单通道。浮点三通道需要自己拆通道处理。

**代价**：权重依赖像素值，核不能预计算，也不能分离，复杂度约 O(N·d²)。σs 或 d 翻倍，耗时大致翻四倍。实时视频里通常只在降采样后的预览上跑双边，或者改用导向滤波。

**已知伪影**：强边缘附近会出现梯度反转（gradient reversal）和“光晕”，因为值域权重让边缘两侧的估计彼此割裂。需要严格保边且不能有光晕时，导向滤波通常更稳。

### 联合双边

把值域权重换成“另一张引导图”的差值，就得到联合双边（joint bilateral）。典型用法是用高分辨率灰度图或深度图作引导，给低分辨率彩色图上采样，同时保持边缘对齐。

## 8. 导向滤波

### 原理

导向滤波（guided filter）假设输出在局部窗口内是引导图的线性函数：

```text
q_i = a_k · I_i + b_k,  i ∈ ω_k
```

在每个以 k 为中心、半径为 r 的窗口 ω_k 内，用最小二乘拟合 `a_k`、`b_k`：

```text
a_k = cov(I, p) / (var(I) + ε)
b_k = mean(p) − a_k · mean(I)
```

然后对所有覆盖该像素的窗口结果取平均：

```text
q_i = mean(a) · I_i + mean(b)
```

所有均值都能用方框滤波一次算完，因此复杂度是 O(N)，与半径 r 无关。`ε` 是正则项：ε 越大，输出越接近引导图的平滑版本；ε 越小，越信任引导图的细节。

这个模型天然保边：边缘处 `var(I)` 很大，`a_k ≈ 1`，输出跟随引导图；平坦处 `var(I) ≈ 0`，`a_k ≈ 0`，输出接近 `mean(p)`，即被平滑。它也不会产生双边滤波的梯度反转。

### 实现

OpenCV 核心模块没有导向滤波，`cv::ximgproc::guidedFilter` 在 contrib 里。自己实现只需几行：

```cpp
// guide: CV_32FC1 引导图；src: CV_32FC1 输入；返回 CV_32FC1
cv::Mat guidedFilter(const cv::Mat& guide, const cv::Mat& src,
                     int radius, double eps)
{
    CV_Assert(guide.type() == CV_32FC1 && src.type() == CV_32FC1);
    CV_Assert(guide.size() == src.size() && radius > 0 && eps > 0.0);

    const cv::Size ksize(radius * 2 + 1, radius * 2 + 1);
    cv::Mat meanI, meanP, corrI, corrIp;
    cv::boxFilter(guide, meanI, CV_32F, ksize);
    cv::boxFilter(src, meanP, CV_32F, ksize);
    cv::boxFilter(guide.mul(guide), corrI, CV_32F, ksize);
    cv::boxFilter(guide.mul(src), corrIp, CV_32F, ksize);

    // 方差与协方差：E[xy] - E[x]E[y]
    cv::Mat varI = corrI - meanI.mul(meanI);
    cv::Mat covIp = corrIp - meanI.mul(meanP);

    cv::Mat a, b;
    cv::divide(covIp, varI + eps, a);
    b = meanP - a.mul(meanI);

    cv::Mat meanA, meanB;
    cv::boxFilter(a, meanA, CV_32F, ksize);
    cv::boxFilter(b, meanB, CV_32F, ksize);
    return meanA.mul(guide) + meanB;
}
```

使用时把 8 位图归一化到 `[0,1]` 再处理，`ε` 的量级才直观：

```cpp
cv::Mat srcF, guideF;
src.convertTo(srcF, CV_32FC3, 1.0 / 255.0);
cv::cvtColor(srcF, guideF, cv::COLOR_BGR2GRAY);

std::vector<cv::Mat> channels;
cv::split(srcF, channels);

const double eps = 0.01 * 0.01;   // 对应 8 位下约 2.55 的亮度差
for (auto& c : channels) {
    c = guidedFilter(guideF, c, 8, eps);
}

cv::Mat outF;
cv::merge(channels, outF);
cv::Mat out;
outF.convertTo(out, CV_8UC3, 255.0);
```

`ε` 常用 `0.01²`~`0.1²`（按 `[0,1]` 归一化），`r` 取 4~16。彩色图可用三通道引导（每通道单独算 `a`、`b`），也可像上面那样用灰度引导，让三个通道共享同一组结构判断。

## 9. 非局部均值

### 原理

非局部均值（non-local means）不再比较单个像素，而是比较**小块**的相似度：对每个像素开一个模板窗（默认 7×7），在搜索窗（默认 21×21）里找所有相似的小块，用相似度加权平均。相同纹理上的小块相似度高，于是纹理被保留并被反复平均，噪声被抵消。

```text
out(p) = Σ_q w(p, q) · I(q) / Σ_q w(p, q)
w(p, q) = exp( -||P(p) - P(q)||² / h² )
```

`P(p)` 是以 p 为中心的模板窗内像素组成的向量。`h` 控制过滤强度：越大越平滑，也越容易抹掉细节。

```cpp
cv::Mat denoised;
cv::fastNlMeansDenoisingColored(src, denoised,
                                /*h=*/6, /*hColor=*/6,
                                /*templateWindowSize=*/7,
                                /*searchWindowSize=*/21);
```

参数与限制：

- 只接受 8 位三通道图像；`h` 常用 3~10，越大越强。
- 两个窗口尺寸必须是奇数；搜索窗加倍，耗时约变为四倍。
- 复杂度约为 O(N·s²·t²)，是本文所有滤波器里最慢的。1080p 图像通常需要数百毫秒到数秒。

它适合离线处理高质量照片和医学/遥感图像的最终降噪，不适合实时视频。若只是想去掉轻微噪声，双边或导向滤波的性价比更高。

## 10. 频域滤波

### 原理

卷积定理：空间域卷积等于频域相乘。因此可以先做二维 DFT，把频谱按传递函数 `H(u,v)` 加权，再逆变换回空间域。

常见传递函数：

- **理想低通**：`H = 1 if d ≤ d0 else 0`。边缘最锐利，但会产生振铃（ringing）。
- **高斯低通**：`H = exp(-d²/(2d0²))`，没有振铃，最平滑。
- **Butterworth 低通**：`H = 1 / (1 + (d/d0)^(2n))`，阶数 `n` 越大越接近理想低通，振铃也越明显。

把 `H` 取反（`1 - H`）就得到高通，用于锐化或提取边缘。

```cpp
namespace {
// 把频谱的四个象限中心化，或反向还原。
void fftShift(cv::Mat& m)
{
    const int cx = m.cols / 2;
    const int cy = m.rows / 2;
    cv::Mat q0(m, cv::Rect(0, 0, cx, cy));
    cv::Mat q1(m, cv::Rect(cx, 0, m.cols - cx, cy));
    cv::Mat q2(m, cv::Rect(0, cy, cx, m.rows - cy));
    cv::Mat q3(m, cv::Rect(cx, cy, m.cols - cx, m.rows - cy));

    cv::Mat tmp;
    q0.copyTo(tmp); q3.copyTo(q0); tmp.copyTo(q3);
    q1.copyTo(tmp); q2.copyTo(q1); tmp.copyTo(q2);
}
} // namespace

cv::Mat gaussianLowPass(const cv::Mat& gray, double cutoffRatio)
{
    CV_Assert(gray.type() == CV_8UC1);

    // DFT 对 2、3、5 的幂次尺寸最快。
    cv::Mat padded;
    const int m = cv::getOptimalDFTSize(gray.rows);
    const int n = cv::getOptimalDFTSize(gray.cols);
    cv::copyMakeBorder(gray, padded, 0, m - gray.rows, 0, n - gray.cols,
                       cv::BORDER_REPLICATE);

    cv::Mat planes[] = {cv::Mat_<float>(padded),
                        cv::Mat::zeros(padded.size(), CV_32F)};
    cv::Mat spectrum;
    cv::merge(planes, 2, spectrum);
    cv::dft(spectrum, spectrum);   // 输出仍是双通道：实部、虚部
    fftShift(spectrum);

    // 在中心化后的频谱上构造高斯低通
    cv::Mat mask(spectrum.size(), CV_32FC2, cv::Scalar::all(0));
    const double d0 = cutoffRatio * 0.5 * std::min(spectrum.rows, spectrum.cols);
    const double cx = spectrum.cols / 2.0;
    const double cy = spectrum.rows / 2.0;
    for (int y = 0; y < mask.rows; ++y) {
        for (int x = 0; x < mask.cols; ++x) {
            const double dx = x - cx;
            const double dy = y - cy;
            const double d2 = dx * dx + dy * dy;
            mask.at<cv::Vec2f>(y, x)[0] =
                static_cast<float>(std::exp(-d2 / (2.0 * d0 * d0)));
        }
    }

    cv::mulSpectrums(spectrum, mask, spectrum, 0);
    fftShift(spectrum);                                   // 还原到 DFT 的原始排列
    cv::idft(spectrum, spectrum, cv::DFT_SCALE | cv::DFT_REAL_OUTPUT);

    // idft 的输出是 CV_32F，数值范围仍是 0~255；convertTo 会饱和掉振铃产生的负值。
    cv::Mat result;
    spectrum(cv::Rect(0, 0, gray.cols, gray.rows)).convertTo(result, CV_8U);
    return result;
}
```

要点：

- `cv::dft` 输出是复数平面（双通道），`mulSpectrums` 逐元素相乘，正好对应频域滤波。
- 直接在原始排列上构造掩模也可以，但距离要按环绕计算，容易写错；先中心化再构造更直观。
- `DFT_SCALE` 是逆变换必须的归一化，漏掉它结果会整体放大 `M·N` 倍。
- 理想低通会在边缘留下明显的振铃条纹，这是截断高频的吉布斯现象，不是实现 bug。

频域滤波特别适合处理**周期性噪声**（摩尔纹、电源干扰、扫描线）：在频谱上表现为离开中心的亮点，用陷波（notch）掩模精确去掉，比空间域滤波干净得多。

## 11. 高通与锐化

滤波同样可以用来增强细节。拉普拉斯核是二阶微分，对边缘响应强：

```cpp
cv::Mat laplacianKernel = (cv::Mat_<float>(3, 3) <<
     0, -1,  0,
    -1,  4, -1,
     0, -1,  0);

cv::Mat edges;
cv::filter2D(src, edges, CV_16S, laplacianKernel); // 有负值，必须用有符号类型
cv::convertScaleAbs(edges, edges);                  // 取绝对值并转回 8 位
```

把“原图 + 拉普拉斯响应”就是最朴素的锐化：

```text
 sharpenKernel = [ 0, -1,  0 ]
                 [-1,  5, -1 ]
                 [ 0, -1,  0 ]
```

它等价于反遮罩（unsharp mask）的一种形式：`original + (original - blurred)`。区别在于反遮罩用高斯得到低频，可以控制半径和强度，效果更可控；拉普拉斯核固定 3×3，容易放大噪声和压缩块。

```cpp
cv::Mat blur, sharp;
cv::GaussianBlur(src, blur, cv::Size(0, 0), 1.2);
cv::addWeighted(src, 1.8, blur, -0.8, 0.0, sharp); // 反遮罩
```

`Sobel` 是带方向的一阶微分，`gx` 与 `gy` 组合可以得到梯度幅值：

```cpp
cv::Mat gray, gx, gy;
cv::cvtColor(src, gray, cv::COLOR_BGR2GRAY);
cv::Sobel(gray, gx, CV_32F, 1, 0, 3);
cv::Sobel(gray, gy, CV_32F, 0, 1, 3);
cv::Mat magnitude;
cv::magnitude(gx, gy, magnitude);
```

逐像素变换的锐化与色阶细节见[《OpenCV 图像调整》]({{< relref "opencv-image-adjustments.md" >}})，这里只强调一点：**先降噪再锐化**。锐化放大的是高频，噪声也是高频，顺序反了会把噪声一起增强，然后再也无法去掉。

## 12. 如何选型和调参

| 滤波器 | 类型 | 保边 | 每像素复杂度 | 典型场景 |
|---|---|---|---|---|
| 均值/方框 | 线性 | 否 | O(1) | 预览、降采样前平滑、基线对比 |
| 高斯 | 线性 | 否 | O(k)（可分离） | 轻降噪、抗锯齿、金字塔 |
| 中值 | 非线性（排序） | 较好 | O(1)（8 位直方图法） | 椒盐噪声、坏点、扫描灰尘 |
| 双边 | 非线性（值域加权） | 好 | O(d²) | 保边磨皮、HDR 色调映射前置 |
| 导向 | 非线性（局部线性拟合） | 好 | O(1)（与半径无关） | 保边去噪、抠图、上采样 |
| 非局部均值 | 非线性（块相似） | 好 | O(s²·t²) | 离线高质量降噪 |
| 频域低通/高通 | 线性 | 否 | O(N log N) | 周期噪声、陷波、全局模糊 |

实践中的顺序通常是：

1. **判断噪声类型**：椒盐用中值，高斯用高斯/双边，周期性用频域陷波。
2. **从弱到强试参**：σ 从 0.8 起、`d` 从 5 起、`h` 从 3 起，逐级加大，每级保存结果对比。
3. **只在需要的通道上处理**：彩色噪声多集中在色度，转到 YCrCb 只滤 Cb/Cr，比三通道一起滤更快也更少破坏亮度细节。
4. **最后锐化**：用反遮罩，强度 0.5~1.0、半径 1.0~2.0，比固定拉普拉斯核可控。
5. **保留原图**：每次调参都从原始图像重算，避免多轮滤波累积误差。

常见坑：

- **核未归一化**：正系数核不除以权重和，图像整体变亮。
- **负系数核用 8 位输出**：`filter2D` 的 `ddepth = -1` 会把负值截断，边缘只剩一半。
- **默认边界**：边缘像素结果与内部不同，定量分析前要么扩展边界，要么裁掉边缘。
- **彩色图逐通道滤波**：中值、双边、导向在通道间不共享判断，可能出现色斑；必要时转 Lab/YCrCb 只处理亮度。
- **`ksize` 为偶数**：大多数滤波要求奇数核，否则没有唯一的中心像素。
- **多次高斯等价于更大 σ**：σ² 相加，别指望“滤两次小 σ”能得到不同的效果。

## 13. 完整示例

把上面几个函数串起来，得到一条“去噪 → 保边 → 锐化”的流水线：

```cpp
#include <opencv2/opencv.hpp>
#include <iostream>

int main()
{
    cv::Mat src = cv::imread("input.jpg", cv::IMREAD_COLOR);
    if (src.empty()) {
        std::cerr << "Failed to read input.jpg\n";
        return 1;
    }

    // 1. 去椒盐噪声（对高光点、坏点也有效）
    cv::Mat despeckled;
    cv::medianBlur(src, despeckled, 3);

    // 2. 保边平滑：抑制剩余高斯噪声，同时尽量保住边缘
    cv::Mat smooth;
    cv::bilateralFilter(despeckled, smooth, 7, 45, 45);

    // 3. 反遮罩锐化
    cv::Mat blurred, sharp;
    cv::GaussianBlur(smooth, blurred, cv::Size(0, 0), 1.2);
    cv::addWeighted(smooth, 1.6, blurred, -0.6, 0.0, sharp);

    if (!cv::imwrite("output.jpg", sharp)) {
        std::cerr << "Failed to write output.jpg\n";
        return 1;
    }
    return 0;
}
```

以 CMake 构建：

```cmake
cmake_minimum_required(VERSION 3.16)
project(ImageFiltering LANGUAGES CXX)

find_package(OpenCV REQUIRED)
add_executable(image_filtering main.cpp)
target_link_libraries(image_filtering PRIVATE ${OpenCV_LIBS})
target_include_directories(image_filtering PRIVATE ${OpenCV_INCLUDE_DIRS})
```

滤波是几乎所有图像算法的前置步骤：边缘检测、特征提取、模板匹配、深度估计都默认输入已经过合适的平滑。理解核的形状、参数的含义和代价的量级，比记住某个函数的调用方式更有用——同一个“模糊”，在高斯核、双边核和频域掩模里是完全不同的东西。
