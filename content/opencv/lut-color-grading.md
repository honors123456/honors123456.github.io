---
title: "从富士胶片模拟到经典 LUT：色彩查找表的原理、代码与风格"
date: 2026-11-20
description: "拆解 1D/3D LUT 的数学原理与插值实现，说明富士胶片模拟和经典电影 LUT 的调色逻辑，给出 OpenCV C++ 查表代码，并用自制素材对比胶片模拟与经典 LUT 的效果。"
draft: false
---

调色软件里的“LUT”看起来像个黑盒：套上去，画面立刻换了一种气质。它本质上只是**一张颜色查找表**——输入一个 RGB 值，查表得到另一个 RGB 值。真正有意思的是表里的内容是怎么来的：胶片的特性曲线、染料串色、冲洗工艺，以及几十年里形成的审美偏好，最后都被压缩进几万到几十万个数字里。

本文从 LUT 的数学与代码讲起，再解释富士胶片模拟这一类“风格”的色彩处理逻辑，最后巡礼几款最出名的经典 LUT，并用同一组素材做效果对比。

> 文中所有对比图使用程序化生成的测试素材（无人像与第三方照片），效果由下面给出的“曲线 + 矩阵 + 饱和度 + 分离色调”管线近似模拟，**不是**富士或柯达的官方 LUT。目的是说明原理与调色方向，不涉及任何厂商的私有数据。

{{< figure src="/images/lut/look-hero.jpg" title="同一素材的四种处理" caption="左上：原图；右上：Classic Chrome 近似；左下：Kodak Portra 400 近似；右下：Teal & Orange。" >}}

## 1. 一个 LUT 到底是什么

LUT（Look-Up Table）的核心是一个函数：

```text
out = L(in),  in ∈ [0,1]³, out ∈ [0,1]³
```

按定义域的形式，分成两类：

| 类型 | 形式 | 能表达什么 | 不能表达什么 | 常见尺寸 |
|---|---|---|---|---|
| 1D LUT | 三个独立的一维曲线 | 亮度/对比、通道曲线、色阶、Gamma | 通道之间的混合（饱和度、色相旋转、串色） | 256、1024、4096 点 |
| 3D LUT | 一个立方体网格 | 任意 RGB→RGB 映射：矩阵、饱和度、色相偏移、分离色调 | 空间操作（锐化、光晕、颗粒） | 17³、33³、65³ |

1D LUT 便宜、精确、好插值，几乎所有相机和显示器的 Gamma/色阶校正都是 1D 的。但它的三个通道互不影响，做不出“把红色往橙色推、同时保持蓝色不动”这种效果。

3D LUT 把整个 RGB 立方体离散成网格，每个网格点存一个输出颜色。33³ 只有 35937 个条目（约 430 KB 的浮点数据），却能表达几乎任何逐像素的颜色变换。影视调色、游戏色调映射、手机滤镜，用的都是 3D LUT。

为什么行业偏爱 LUT 而不是直接跑一套算法？三个原因：

1. **一致**：同一张表在 DaVinci、Photoshop、Premiere、游戏引擎里查出来的结果完全相同，不依赖各家对“对比度”“饱和度”的实现细节。
2. **便宜**：运行期只有查表和插值，复杂管线（曲线 + 矩阵 + 多级色调分离）被预先烘焙掉。
3. **可交换**：`.cube`、Hald CLUT 是通用格式，人能看懂、能版本管理。

### Hald CLUT

Hald CLUT 是把 3D LUT 存成一张图片的约定：level 为 `n` 时，图片含 `n⁶` 个像素，排成 `n³ × n³` 的方阵，每个像素代表立方体里的一个采样位置。常见的 Hald CLUT level 8 就是 512×512。它的好处是可以直接在 Photoshop 里用“图像 → 应用图像”加普通混合模式应用，或者当成一张普通图片分发。

## 2. 数学：三线性插值

3D LUT 只在 `N³` 个格点上定义了输出，任意颜色都要插值。最常用的是三线性插值。

先把输入归一化到网格坐标：

```text
x = c.r · (N-1),  y = c.g · (N-1),  z = c.b · (N-1)
i = floor(x),     j = floor(y),     k = floor(z)
fx = x - i,       fy = y - j,       fz = z - k
```

取包围该点的 8 个格点，沿三个轴依次线性插值：

```text
c000 = T[i  ][j  ][k  ],  c100 = T[i+1][j  ][k  ]
c010 = T[i  ][j+1][k  ],  c110 = T[i+1][j+1][k  ]
c001 = T[i  ][j  ][k+1],  c101 = T[i+1][j  ][k+1]
c011 = T[i  ][j+1][k+1],  c111 = T[i+1][j+1][k+1]

c00 = lerp(c000, c100, fx)   c10 = lerp(c010, c110, fx)
c01 = lerp(c001, c101, fx)   c11 = lerp(c011, c111, fx)

c0  = lerp(c00, c01, fy)     c1  = lerp(c10, c11, fy)
out = lerp(c0,  c1,  fz)
```

三线性插值的误差在网格单元内部最大，网格越密误差越小。33³ 的网格在 8 位精度下，纯色区域也可能看到 1~2 个色阶的偏差，配合量化误差会在渐变区形成色带（banding）。

### 四面体插值

更常见的替代是四面体插值（tetrahedral interpolation）：把立方体切成 6 个四面体，判断点落在哪个四面体内，只用 4 个顶点做重心插值。

```text
以 fx ≥ fy ≥ fz 为例（其余五种情况是对称的）：
out = c000
    + fx · (c100 - c000)
    + fy · (c110 - c100)
    + fz · (c111 - c110)
```

它的优势：

- 参与运算的顶点更少（4 个），速度略快。
- 不会沿着灰轴（r = g = b）产生偏色——三线性插值在网格对角的灰色线上会有轻微色偏，四面体插值沿对角线的行为与 LUT 本身一致。
- DaVinci Resolve、大多数 GPU 实现默认用它。

代价是分支更多，SIMD 实现更复杂。33³ 网格下两者的视觉差异很小，除非 LUT 本身变化剧烈。

## 3. `.cube` 文件格式

`.cube` 是 Adobe 提出的纯文本格式，也是最通用的 LUT 交换格式：

```text
TITLE "Classic Chrome (approx)"
LUT_3D_SIZE 33
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

0.000000 0.030000 0.031000
0.001000 0.030500 0.031000
...
```

要点：

- `TITLE` 是任意描述，可省略。
- `LUT_3D_SIZE N` 表示每个轴 N 个采样点；也可能是 `LUT_1D_SIZE`，表示这是 1D LUT。
- `DOMAIN_MIN`/`DOMAIN_MAX` 定义输入范围，默认 `[0,1]`。有些 Log 素材的 LUT 用 `[0,1]` 之外的域，需要先归一化。
- 数据行按 **红变化最快、绿次之、蓝最慢** 排列：索引为 `r + g·N + b·N·N`。
- `#` 开头的行是注释。

解析本身很简单，容易被忽略的是**色彩空间约定**：`.cube` 文件不记录自己是给哪个色彩空间、哪种传递函数用的。一个 `LogC → Rec.709` 的 LUT 套在普通 sRGB 素材上会严重过曝、颜色发灰。文件名和 README 往往才是唯一的说明。

## 4. 用 C++ 加载并应用 3D LUT

### 数据结构与解析

```cpp
#include <opencv2/opencv.hpp>

#include <algorithm>
#include <cmath>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>

struct Lut3D
{
    int size = 0;
    std::vector<cv::Vec3f> table;   // r + g*N + b*N*N，输入输出均为 [0,1]
    cv::Vec3f domainMin{0.f, 0.f, 0.f};
    cv::Vec3f domainMax{1.f, 1.f, 1.f};
};

bool loadCube(const std::string& path, Lut3D& lut)
{
    std::ifstream file(path);
    if (!file) {
        return false;
    }

    std::string line;
    std::vector<cv::Vec3f> entries;

    while (std::getline(file, line)) {
        if (line.empty() || line[0] == '#') {
            continue;
        }

        std::istringstream ss(line);

        // 先尝试按数据行解析：三个浮点数
        float r = 0.f, g = 0.f, b = 0.f;
        if (ss >> r >> g >> b) {
            entries.emplace_back(r, g, b);
            continue;
        }

        // 否则是关键字行
        std::string key;
        ss.clear();
        ss.str(line);
        ss >> key;

        if (key == "TITLE" || key == "LUT_1D_SIZE") {
            continue;                          // 只处理 3D LUT
        }
        if (key == "LUT_3D_SIZE") {
            ss >> lut.size;
            entries.reserve(static_cast<size_t>(lut.size) * lut.size * lut.size);
            continue;
        }
        if (key == "DOMAIN_MIN") {
            ss >> lut.domainMin[0] >> lut.domainMin[1] >> lut.domainMin[2];
            continue;
        }
        if (key == "DOMAIN_MAX") {
            ss >> lut.domainMax[0] >> lut.domainMax[1] >> lut.domainMax[2];
            continue;
        }
    }

    const size_t expected =
        static_cast<size_t>(lut.size) * lut.size * lut.size;
    if (lut.size < 2 || entries.size() != expected) {
        return false;
    }

    lut.table = std::move(entries);
    return true;
}
```

### 三线性采样

```cpp
cv::Vec3f sampleTrilinear(const Lut3D& lut, const cv::Vec3f& in)
{
    const int N = lut.size;
    const float last = static_cast<float>(N - 1);

    // 先按 DOMAIN 归一化，再映射到网格坐标
    cv::Vec3f c;
    for (int ch = 0; ch < 3; ++ch) {
        const float span = lut.domainMax[ch] - lut.domainMin[ch];
        c[ch] = (in[ch] - lut.domainMin[ch]) / (span > 0.f ? span : 1.f);
        c[ch] = std::clamp(c[ch], 0.f, 1.f);
    }

    const float x = c[0] * last;
    const float y = c[1] * last;
    const float z = c[2] * last;

    const int i = std::min(static_cast<int>(x), N - 2);
    const int j = std::min(static_cast<int>(y), N - 2);
    const int k = std::min(static_cast<int>(z), N - 2);
    const float fx = x - i;
    const float fy = y - j;
    const float fz = z - k;

    const auto at = [&](int r, int g, int b) -> const cv::Vec3f& {
        return lut.table[static_cast<size_t>(r + N * (g + N * b))];
    };

    const auto lerp = [](const cv::Vec3f& a, const cv::Vec3f& b, float t) {
        return a + (b - a) * t;
    };

    const cv::Vec3f c00 = lerp(at(i, j, k),     at(i + 1, j, k),     fx);
    const cv::Vec3f c10 = lerp(at(i, j + 1, k), at(i + 1, j + 1, k), fx);
    const cv::Vec3f c01 = lerp(at(i, j, k + 1), at(i + 1, j, k + 1), fx);
    const cv::Vec3f c11 = lerp(at(i, j + 1, k + 1),
                               at(i + 1, j + 1, k + 1), fx);

    const cv::Vec3f c0 = lerp(c00, c10, fy);
    const cv::Vec3f c1 = lerp(c01, c11, fy);
    return lerp(c0, c1, fz);
}
```

### 应用与并行

```cpp
cv::Mat applyLut(const cv::Mat& src, const Lut3D& lut)
{
    CV_Assert(src.type() == CV_8UC3 && !lut.table.empty());

    cv::Mat dst(src.size(), CV_8UC3);

    cv::parallel_for_(cv::Range(0, src.rows), [&](const cv::Range& range) {
        for (int y = range.start; y < range.end; ++y) {
            const cv::Vec3b* s = src.ptr<cv::Vec3b>(y);
            cv::Vec3b* d = dst.ptr<cv::Vec3b>(y);

            for (int x = 0; x < src.cols; ++x) {
                // BGR -> 归一化 RGB
                const cv::Vec3f in(s[x][2] / 255.f,
                                   s[x][1] / 255.f,
                                   s[x][0] / 255.f);
                const cv::Vec3f out = sampleTrilinear(lut, in);

                d[x] = cv::Vec3b(cv::saturate_cast<uchar>(out[2] * 255.f + 0.5f),
                                 cv::saturate_cast<uchar>(out[1] * 255.f + 0.5f),
                                 cv::saturate_cast<uchar>(out[0] * 255.f + 0.5f));
            }
        }
    });

    return dst;
}
```

### 性能优化

逐像素查表的朴素实现在 1080p 上大约几十毫秒（开启 `parallel_for_` 后更少），已经够用。要更快，有几条常规路线：

1. **缓存唯一颜色**：8 位 RGB 理论上有 1677 万种颜色，一张照片通常只有几十万种，UI 预览图更少。用 `std::unordered_map<uint32_t, uint32_t>` 缓存 `输入 → 输出`，重复查表的成本可以降到十分之一以下。
2. **预展开成 256³**：把 LUT 展开成完整的 8 位立方体（50 MB），运行期只剩三次数组索引，不做插值。适合固定 LUT 的批处理，不适合多 LUT 切换。
3. **1D LUT 用 `cv::LUT`**：如果 LUT 只是三条通道曲线，`cv::LUT(src, lut1x256, dst)` 是 OpenCV 高度优化的查表，比手写循环快得多，也更省心。
4. **GPU**：把 LUT 上传成 3D 纹理（OpenGL `GL_TEXTURE_3D` 或 D3D 的 `Texture3D`），片元着色器里做一次硬件三线性采样。视频实时调色的标准做法。
5. **半精度/定点**：视频管线里常用 16 位定点表示，插值用整数运算，避免浮点转换开销。

### 量化与色带

8 位输入意味着 LUT 的实际输入网格只有 256 级，再叠加三线性插值的误差，暗部渐变很容易出现色带。三条缓解办法：

- 处理链内部用 16 位或浮点，只在最终输出时量化。
- 增加一点抖动（dither），用噪声掩盖量化台阶。
- 用更密的 LUT（65³），代价是内存和缓存命中率变差。

## 5. 富士胶片模拟的原理

富士把自家数码相机里的色彩风格叫“胶片模拟”（Film Simulation）。它的设计目标不是“还原真实”，而是**还原记忆中的颜色**——富士官方称这套理念为 memory color：人记住的天空比实际的更蓝，记住的肤色比实际的更均匀。所有胶片模拟都是朝这个方向调，而不是朝色度计读数调。

从实现角度看，一款胶片模拟大致由五层构成：

1. **特性曲线（tone curve）**：胶片有趾部（toe，暗部压缩）和肩部（shoulder，高光柔化）。数码传感器是线性的，直接截断会得到生硬的高光；胶片模拟用 S 形曲线把高光滚降、暗部抬起，模拟乳剂的响应。
2. **色彩矩阵（3×3 或更复杂的混色）**：胶片的三层乳剂会互相串色，冲洗过程也会引入交叉污染。用一个矩阵把 RGB 混合，能模拟“红里带一点黄”“蓝里带一点青”这种整体色偏。
3. **饱和度与色相偏移**：不是全局等比缩放，而是按色域分别处理。Velvia 会把绿和蓝推得更深、更饱和，同时略微压住肤色；Classic Chrome 会把大面积的高饱和色整体降下来。
4. **分离色调（split toning）**：阴影和高光分别染色。胶片常见的“青影 + 暖高光”就是这一步做出来的。
5. **颗粒与锐度**：颗粒是随亮度变化的单色噪声；锐度则是边缘增强的强度设定，和胶片的 MTF 曲线有关。

{{< figure src="/images/lut/look-fuji.jpg" title="富士胶片模拟的近似实现" caption="按“曲线 + 矩阵 + 饱和度 + 分离色调 + 颗粒”的思路复刻的八种风格。这是本文代码的近似结果，不是富士官方 LUT；同一场景下更接近的是一个调色方向，而不是逐像素相等的还原。" >}}

### 各款模拟的取向

| 模拟 | 对比度 | 饱和度 | 色彩倾向 | 典型用途 |
|---|---|---|---|---|
| Provia / Standard | 中等 | 中等 | 中性、略偏品红 | 通用、新闻、需要后续再调色的素材 |
| Velvia | 高 | 很高 | 深绿、深蓝，红偏洋红 | 风光、花卉、日落 |
| Astia / Soft | 低 | 中等偏低 | 肤色偏暖、柔和 | 人像、婚礼、柔和光线 |
| Classic Chrome | 中等 | 低 | 青蓝阴影、克制的红 | 纪实、街拍、有年代感的场景 |
| Classic Neg. | 高 | 中高 | 琥珀高光、青绿阴影 | 城市夜景、强烈风格化的纪实 |
| Nostalgic Neg. | 中低 | 中高 | 琥珀色高光、泛黄整体 | 复古、怀旧、暖调环境 |
| Acros | 高 | —（黑白） | 通道混合偏重绿与红，暗部深 | 建筑、静物、强结构感画面 |
| Eterna | 很低 | 低 | 略偏青，肩部极柔 | 视频、电影感、后期还要调色的素材 |
| Reala Ace | 中等 | 中等 | 更接近“准确”的还原 | 商业、需要忠实色彩的场合 |

几个容易混淆的点：

- **Classic Chrome 不是“更灰的 Provia”**。它同时压低了饱和度、改变了阴影的色相（偏青），并把高光滚降得更平。只降饱和度会显得脏，青影 + 暖高光的组合才是它“像杂志印刷品”的原因。
- **Acros 不是简单的去色**。它的通道混合权重偏重红色和绿色，蓝色被压得很低，所以蓝天会变暗、绿植层次更丰富；这也是黑白滤镜（黄镜、橙镜）的原理。
- **Eterna 的对比度低是有意为之**。它的高光肩部很长，暗部抬起，留给后期调色的空间大；直接拿来当成品会显得“灰”。

### 用代码生成一款近似 LUT

思路就是把上面五层写成一个函数，然后在整个 RGB 立方体上求值，输出 `.cube`。下面用 Python 演示（图像处理原型在 Python 里更快，运行期仍建议用 C++ 查表）：

```python
import numpy as np
from scipy.interpolate import PchipInterpolator

LUMA = np.array([0.2126, 0.7152, 0.0722])

def curve(x, knots):
    """单调三次插值，knots 是 [(in, out), ...]，保证曲线单调、不过冲。"""
    xs = np.array([k[0] for k in knots])
    ys = np.array([k[1] for k in knots])
    return np.clip(PchipInterpolator(xs, ys)(x), 0.0, 1.0)

# Classic Chrome 的近似参数
CURVE = [(0, 0.03), (0.25, 0.26), (0.5, 0.515), (0.75, 0.755), (1, 0.955)]
MATRIX = np.array([[1.00, 0.02, 0.00],
                   [-0.01, 1.00, 0.02],
                   [0.01, 0.02, 0.96]])
SATURATION = 0.74
SHADOW = np.array([0.0, 0.02, 0.035]) * 0.55    # 阴影压向青蓝
HIGHLIGHT = np.array([0.05, 0.03, -0.04]) * 0.55 # 高光略暖

def look(rgb):
    out = np.stack([curve(rgb[..., i], CURVE) for i in range(3)], -1)
    out = out @ MATRIX.T

    luma = out @ LUMA
    out = luma[..., None] + (out - luma[..., None]) * SATURATION

    luma = out @ LUMA
    out = out + np.clip(1 - 2 * luma, 0, 1)[..., None] * SHADOW
    out = out + np.clip(2 * luma - 1, 0, 1)[..., None] * HIGHLIGHT
    return np.clip(out, 0.0, 1.0)

def write_cube(path, size=33, title="Classic Chrome (approx)"):
    axis = np.linspace(0.0, 1.0, size)
    r, g, b = np.meshgrid(axis, axis, axis, indexing="ij")
    rgb = np.stack([r, g, b], -1)
    out = look(rgb)

    # .cube 的顺序：红变化最快，蓝最慢
    data = out.transpose(2, 1, 0, 3).reshape(-1, 3)

    with open(path, "w", encoding="ascii") as f:
        f.write(f'TITLE "{title}"\n')
        f.write(f"LUT_3D_SIZE {size}\n")
        f.write("DOMAIN_MIN 0 0 0\nDOMAIN_MAX 1 1 1\n")
        for c in data:
            f.write(f"{c[0]:.6f} {c[1]:.6f} {c[2]:.6f}\n")

write_cube("classic-chrome.cube")
```

生成的 `.cube` 就可以交给前面的 C++ `loadCube` + `applyLut` 使用。参数不同，就得到不同的风格；真正决定“像不像”的，是曲线拐点、矩阵系数和分离色调的取舍。

{{< figure src="/images/lut/lut-cube.png" title="3D LUT 在立方体上做了什么" caption="上排：原始 RGB 立方体的四个切面（B = 0、1/3、2/3、1）。下排：经过 Classic Chrome 近似映射后的同一批切面。可以看到暗部被抬起（左下角不再是纯黑）、整块颜色向青色偏移、高饱和区域被压缩。" >}}

## 6. 经典 LUT 巡礼

除了富士的胶片模拟，调色行业里还有一批“人人都听过”的 LUT。它们大致分三类：**胶片仿真**、**风格化**、**技术转换**。

{{< figure src="/images/lut/look-classic.jpg" title="经典胶片与风格 LUT 的近似实现" caption="上排：Portra 400、Ektar 100、Cinestill 800T；下排：Tri-X 400、Bleach Bypass、Teal & Orange。均为同一管线的近似模拟。" >}}

### Kodak Portra 400

最出名的人像负片，几乎是人像调色的默认参考答案。

- **曲线**：低到中等对比，趾部抬起（暗部不会死黑），肩部极长且柔（高光慢慢滚到接近白，不突变）。
- **颜色**：整体饱和度偏低但明度偏高，高光偏暖（偏黄橙），阴影偏青；肤色的红通道被适度压缩，避免“数码红”那种发闷的红。
- **观感**：柔和、通透、宽容度大，过曝一档也能救回来。

实现要点：低对比 S 曲线 + 轻微的青影暖高光 + 全局降饱和到 0.9 左右 + 一点点颗粒。

### Kodak Ektar 100

与 Portra 完全相反的取向：高饱和、高反差、极细颗粒，风光片常用。

- **颜色**：红色和蓝色非常浓，绿色偏冷，天空蓝得很“硬”。
- **曲线**：对比强，暗部扎实，高光收得比 Portra 紧。
- **注意**：人像慎用，肤色容易偏红偏橙。

实现要点：强 S 曲线 + 饱和度 1.2~1.35 + 蓝色通道轻微提升 + 红通道矩阵增益。

### Cinestill 800T

Kodak Vision3 500T 电影负片去掉 remjet 背层后的版本，因为背层没了，强光会在胶片基底里散射，形成标志性的**红色光晕（halation）**。

- **色温**：钨丝灯平衡（3200K），在日光下会明显偏蓝；反过来在夜景钨丝灯下色彩正常，阴影偏青。
- **光晕**：高光周围一圈偏红的扩散，是这款胶片最容易被识别的特征。
- **曲线**：对比中等偏低，暗部有细节，颗粒明显。

光晕不是逐像素颜色映射，3D LUT 做不出来，需要单独一步：提取高光 → 高斯模糊 → 红色染色 → 加回原图。这就是为什么“LUT”经常和“效果”分开卖。

```cpp
// 简化版红色光晕：提取高光，模糊后以暖红色加回。
cv::Mat makeHalation(const cv::Mat& src, double threshold,
                     double sigma, double amount)
{
    cv::Mat gray, bright;
    cv::cvtColor(src, gray, cv::COLOR_BGR2GRAY);
    gray.convertTo(gray, CV_32F, 1.0 / 255.0);

    cv::threshold(gray, bright, threshold, 1.0, cv::THRESH_TOZERO);
    cv::GaussianBlur(bright, bright, cv::Size(0, 0), sigma);

    cv::Mat srcF;
    src.convertTo(srcF, CV_32FC3, 1.0 / 255.0);

    // 光晕颜色偏红（BGR 顺序），越远离高光越弱
    const cv::Vec3f tint(0.18f, 0.28f, 1.0f);
    cv::Mat out(src.size(), CV_32FC3);
    for (int y = 0; y < src.rows; ++y) {
        for (int x = 0; x < src.cols; ++x) {
            const float g = bright.at<float>(y, x) * static_cast<float>(amount);
            out.at<cv::Vec3f>(y, x) = srcF.at<cv::Vec3f>(y, x) + tint * g;
        }
    }
    cv::Mat dst;
    out.convertTo(dst, CV_8UC3, 255.0);
    return dst;
}
```

{{< figure src="/images/lut/look-halation.jpg" title="Cinestill 800T 的两个特征" caption="中图是只做色彩映射的结果：整体偏青、对比降低。右图在此基础上叠加红色光晕：高光变亮、周围出现红色扩散。光晕无法用 3D LUT 表达，必须单独处理。" >}}

### Kodak Tri-X 400 与 Ilford HP5 Plus

黑白负片的两座标杆。Tri-X 对比强、颗粒粗、有“新闻摄影”的粗粝感；HP5 更宽容、颗粒稍细，适合大幅放大。

黑白不是 `(R+G+B)/3`。真实黑白胶片对不同波长的敏感度不同，转黑白要用**通道混合**（相当于加彩色滤镜）：

```text
gray = 0.35·R + 0.48·G + 0.17·B     // 接近 Tri-X 的观感，蓝天压暗、肤色自然
```

调高绿色权重 ≈ 黄镜，压暗蓝天；调高红色权重 ≈ 红镜，天空接近全黑、皮肤变白。这一步之后再套对比曲线和颗粒，才有胶片味。

### Bleach Bypass

冲洗时跳过漂白工序（skip bleach），银盐留在乳剂里，得到**高对比 + 低饱和**的银灰质感。《拯救大兵瑞恩》《七宗罪》都用过类似处理。

实现要点：强 S 曲线 + 饱和度压到 0.3~0.5 + 保留一点金属灰的中性色。它常被误认为“就是去饱和”，实际上对比度必须同时拉高，否则画面只会发灰。

### Teal & Orange

好莱坞大片的“互补色”调色：把人脸推向橙、把阴影和背景推向青蓝，让主体从环境中跳出来。

- **不是全局滤镜**：需要按肤色范围（hue ≈ 20°~40°）保护人像，把其他区域推向青蓝。
- **常见做法**：肤色遮罩 + 阴影/高光分离 + 中等对比。

它本质是“按色域的分离处理”，用 LUT 也能近似，但效果取决于原图里有多少肤色。风景照套上去只会变成“蓝色的照片”。

### 技术型 LUT

还有一类 LUT 不追求风格，只做色彩空间转换：

| LUT | 输入 | 输出 | 用途 |
|---|---|---|---|
| ARRI LogC3 → Rec.709 | LogC（EI 800） | Rec.709 | 把 ARRI 素材还原成可交付画面 |
| Sony S-Log3 / S-Gamut3.Cine → Rec.709 | S-Log3 | Rec.709 | 索尼相机素材还原 |
| DJI D-Log → Rec.709 | D-Log | Rec.709 | 无人机素材还原 |
| ACES → Rec.709 (ODT) | ACEScg / ACEScc | Rec.709 | 影视标准流程输出 |

这类 LUT 必须**严格匹配素材**：LogC 的 LUT 套在 S-Log3 素材上，肤色会直接崩掉。它们也通常与 gamma 绑定——在没有色彩管理的情况下直接套用，等于把传递函数也一起改了。

### 一些流传很广的 LUT 资源

- **VisionColor OSIRIS**：早期的胶片仿真合集，Portra、Fuji 风格的商业 LUT 代表。
- **IWLTBAP**：提供大量免费 LUT，覆盖胶片、黑白、风格化。
- **RocketStock Free LUTs**：免费包，常被入门教程引用。
- **Ground Control / Color Grading Central**：偏商业调色预设。
- 各种“仿富士”“仿柯达”第三方包：质量参差，多数是对官方胶片模拟的主观复刻。

使用这些资源要注意许可：多数商业 LUT 允许成品使用，但不允许重新分发 LUT 文件本身。

## 7. 用色卡量化效果

肉眼比较容易受环境影响。更可靠的办法是用标准色卡：同一组色块，对比各 LUT 之后的 RGB 值，再用 ΔE 衡量偏移。

{{< figure src="/images/lut/look-chart.jpg" title="24 色参考色块与 16 级灰阶" caption="左上原图，其余为三种风格映射后的结果。关注三处：肤色块是否偏红或偏绿、天空蓝是否被推向青色、底部灰阶是否仍然中性（Velvia 的高光略偏暖，Portra 的暗部偏青）。" >}}

色卡上最值得盯的是灰阶：**一款 LUT 是否“干净”，先看它有没有污染中性色**。Portra 的分离色调会让暗部灰偏青，这是它的风格；但如果连中间调的灰都明显染色，说明曲线与矩阵配合得不好，画面会“脏”。

也可以用亮度响应曲线直观比较：

{{< figure src="/images/lut/lut-curves.png" title="亮度与通道响应" caption="左：把灰度斜坡输入各风格后的输出亮度。Velvia 的 S 曲线最陡，Portra 的趾部最高、肩部最缓。右：Portra 近似实现的三个通道响应，红色在中间调以上抬得最高，蓝色在中间调被压低——这正是“暖高光、青阴影”的来源。" >}}

如果要量化，可以在 CIELAB 空间计算色差：

```text
ΔE00 = 色差公式（CIEDE2000），一般 ΔE < 2 视为肉眼几乎无差别，> 5 就能明显看出不同
```

实际评估时，除了 ΔE，还要看**排序是否被破坏**：一款 LUT 如果把深浅不同的两块颜色映射成同一个值，就丢掉了层次，这在渐变天空上会变成色带。

## 8. 工程上的注意事项

1. **色彩空间必须匹配**。LUT 是绑定了输入、输出色彩空间的函数。Rec.709 的 LUT 用在 sRGB 上问题不大（两者传递函数接近），用在 Log 素材上就是灾难。带色彩管理的软件会在 LUT 前后做正确的转换，自己写代码时不要省略。
2. **LUT 不创造信息**。过曝到纯白的区域，任何 LUT 都只能给出白色；欠曝到 0 的区域同理。宽容度来自采集，不来自查表。
3. **8 位链路的量化误差**。LUT + 三线性插值 + 8 位输出，暗部渐变容易出现色带。视频/摄影管线应在 16 位或浮点里完成查表，最后再量化。
4. **3D LUT 无法表达空间操作**。颗粒、光晕、柔焦、暗角都不在颜色的映射里，需要单独的效果链。所谓“胶片 LUT”通常只是色彩部分。
5. **33³ 是性价比最高的尺寸**。17³ 在强对比 LUT 上会有可见台阶；65³ 内存翻 7.6 倍，收益有限。
6. **插值方式会影响灰轴**。对灰阶敏感的场合（产品摄影、医学影像）优先用四面体插值，或直接在 LUT 设计阶段保证灰轴不动。
7. **版权**。富士的胶片模拟是相机固件的一部分，柯达/ARRI 的官方 LUT 有明确许可条款。学习原理、自己做近似实现没问题，直接分发厂商的 LUT 文件则是另一回事。

## 9. 小结

LUT 的技术部分其实很简单：一个三维查找表、一次插值、一次查表。真正复杂的是表里的内容——胶片的特性曲线、染料的串色、冲洗工艺的偶然性，以及几十年积累下来的审美共识。

理解这一点之后，看到一款新的“胶片 LUT”，大致能猜出它做了什么：曲线是 S 形还是肩部很长？饱和度是整体降还是分色域降？阴影偏青还是偏暖？高光有没有滚降？把这些拆开，比反复换 LUT 试效果高效得多。

如果还想往下走，两个方向值得深入：一是把 LUT 放进正确的色彩管理流程（线性化、色域变换、交付转换），二是用色卡和 ΔE 做定量评估，而不是只凭感觉。

相关阅读：[《图像滤波详解：从卷积核到保边降噪》]({{< relref "opencv-filtering.md" >}})讲的是空间域的另一类运算，颗粒、光晕、柔焦都建立在那套工具上；[《OpenCV 图像调整》]({{< relref "opencv-image-adjustments.md" >}})里的色阶、Gamma 和饱和度，则是最简单的 1D LUT 形式。
