---
title: "OpenGL 的五大坐标空间：从模型到屏幕的矩阵链"
date: 2026-11-20
description: "物体、世界、观察、裁剪、屏幕五个坐标空间的定义与矩阵推导，配 C++ 手写实现、逐点验算表、视锥与视口配图，以及实际项目中最常见的坑。"
draft: false
---

一个顶点从建模软件出发，到出现在屏幕上，要经历五次"身份转换"：在模型里它有自己的局部坐标，摆进场景后有了世界坐标，被相机看到后有了观察坐标，投影之后有了裁剪坐标，最后落到某个像素上。这五个坐标系就是 OpenGL 的**五大空间**。

矩阵只是工具，真正要记住的是：**每个空间的原点在哪、轴向朝哪、数值范围是多少**。搞不清这三点，调试时会一直怀疑人生——"明明坐标是对的，为什么屏幕上是黑的"。

{{< figure src="/images/opengl/spaces-chain.png" title="五个空间与四个变换" caption="每个箭头对应一次矩阵乘法或硬件自动完成的操作。屏幕上方的标签是实际的变换名，下方是对应的坐标范围。" >}}

| 空间 | 原点与轴 | 数值范围 | 由谁负责 |
|---|---|---|---|
| 物体空间（局部） | 模型自己的原点，建模时决定 | 建模单位，如 `[-0.5, 0.5]` | 你的顶点数据 |
| 世界空间 | 场景全局原点，所有物体共享 | 任意，通常统一为米 | 模型矩阵 `M` |
| 观察空间 | 相机位置，看向 `-z` | 可见物体大致在 `z < -near` | 观察矩阵 `V` |
| 裁剪空间 | 齐次坐标，`w` 携带深度信息 | `-w ≤ x, y, z ≤ w` | 投影矩阵 `P` |
| 屏幕空间 | 窗口左下角，`y` 轴向上 | `x∈[0,W]`，`y∈[0,H]`，`z∈[0,1]` | 透视除法 + 视口 |

## 1. 物体空间：模型的"自体坐标"

在 Blender 里建一个立方体，它的八个角通常是 `±0.5`。这个坐标系的原点在模型中心（或脚底，取决于建模习惯），和它在场景里放在哪、朝哪完全无关。

物体空间的好处是**可复用**：同一个杯子模型可以被复制一百次，摆在不同位置、不同朝向，模型文件里的坐标始终不变。

顶点数据里的位置、法线、UV 都活在这个空间里。法线要特别小心——它不能简单地用模型矩阵变换，下一节会讲。

## 2. 世界空间：模型矩阵 M

把模型放进场景，需要一次仿射变换：

```text
world = M · local,   M = T · R · S
```

`T` 是平移，`R` 是旋转，`S` 是缩放。**顺序不能随便换**：`T·R·S` 表示"先缩放、再旋转、最后平移"，这也是大多数人期望的语义。如果写成 `R·T·S`，旋转会连平移一起转，物体会绕着世界原点公转而不是自转。

用 GLM 构造：

```cpp
#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>

glm::mat4 model = glm::mat4(1.0f);
model = glm::translate(model, glm::vec3(0.9f, 0.5f, -0.6f));
model = glm::rotate(model, glm::radians(35.0f), glm::vec3(0.0f, 1.0f, 0.0f));
model = glm::rotate(model, glm::radians(15.0f), glm::vec3(1.0f, 0.0f, 0.0f));
model = glm::scale(model, glm::vec3(1.0f));
```

GLM 的 `translate/rotate/scale` 返回的是"左乘"的新矩阵，所以这段代码等价于 `M = T · Ry · Rx · S`——先缩放，再绕 X 转，再绕 Y 转，最后平移。写成 `glm::translate(...) * glm::rotate(...) * glm::scale(...)` 也是一样的，只是阅读顺序相反。

**法线的变换**：法线是方向，不是点，平移对它没有意义；更麻烦的是非均匀缩放会让法线歪掉。正确做法是用模型矩阵左上 3×3 部分的**逆转置**：

```text
normal_world = transpose(inverse(mat3(M))) · normal_local
```

假设一个球被压扁（`S = diag(1, 0.5, 1)`），表面法线会向被压扁的方向"翘"起来；直接乘 `S` 会让法线也一起压扁，光照就错了。逆转置恰好抵消这个效应。均匀缩放时它退化为普通缩放，所以很多教程偷懒直接用 `M`——一旦引入非均匀缩放就会出问题。

## 3. 观察空间：观察矩阵 V

观察空间把相机搬到原点，让它朝 `-z` 方向看，`+y` 朝上，`+x` 朝右。这样做的理由很实际：投影矩阵只在这种标准姿态下才有一个固定的、与相机位置无关的形式。

构造 `V` 分两步：先旋转世界，让相机的三个轴对齐坐标轴；再平移，把相机移到原点。

```text
V = R^T · T(-eye)
```

具体地，已知相机位置 `eye`、看向的目标 `center` 和上方向 `up`，可以构造一组正交基：

```text
f = normalize(center - eye)      // 前（注意：相机看向 -z，所以最后要取反）
s = normalize(cross(f, up))      // 右
u = cross(s, f)                  // 上
```

`V` 的前三行（按行看）就是 `s`、`u`、`-f`，第四列是它们与 `-eye` 的点积：

```cpp
glm::mat4 lookAt(const glm::vec3& eye, const glm::vec3& center, const glm::vec3& up)
{
    const glm::vec3 f = glm::normalize(center - eye);
    const glm::vec3 s = glm::normalize(glm::cross(f, up));
    const glm::vec3 u = glm::cross(s, f);

    glm::mat4 v(1.0f);
    v[0][0] = s.x;  v[1][0] = s.y;  v[2][0] = s.z;  v[3][0] = -glm::dot(s, eye);
    v[0][1] = u.x;  v[1][1] = u.y;  v[2][1] = u.z;  v[3][1] = -glm::dot(u, eye);
    v[0][2] = -f.x; v[1][2] = -f.y; v[2][2] = -f.z; v[3][2] = glm::dot(f, eye);
    return v;
}
```

> GLM 的 `mat4` 是列主序，`v[col][row]`。上面写 `v[0][0] = s.x` 意思是"第 0 列第 0 行"，和矩阵行视角的 `V(0,0)` 一致。

如果相机就在 `(0, 0, 3)` 看向原点，`V` 退化成一次平移：

```text
V = [1 0 0  0]
    [0 1 0  0]
    [0 0 1 -3]
    [0 0 0  1]
```

世界里的 `(1.66, 0.85, -0.39)` 在观察空间里就是 `(1.66, 0.85, -3.39)`——只是"相机后退 3 米"的效果。

**为什么相机固定看 `-z`**：投影矩阵的推导基于这个约定。如果你自己写 `lookAt` 时让相机看向 `+z`，所有物体的 `z` 都变成正数，透视除法会得到反向的深度，裁剪也会把一切裁掉。

## 4. 裁剪空间：投影矩阵 P

投影矩阵是五个变换里唯一**非线性**的一步。它不改变 `x`、`y` 与 `z` 的线性关系，而是把"深度"塞进第四个分量 `w`，让后面的 `÷w` 产生透视缩短。

透视投影矩阵（`fov` 是竖直视角，`aspect = 宽/高`，`near`/`far` 是到近平面的距离，均取正值）：

```text
f = 1 / tan(fov / 2)

P = [ f/aspect   0        0              0        ]
    [ 0          f        0              0        ]
    [ 0          0        (far+near)/(near-far)   2·far·near/(near-far) ]
    [ 0          0        -1             0        ]
```

四个元素要分开理解：

- `f/aspect` 与 `f` 负责**视野**：`f = 1/tan(fov/2)` 把视角换算成缩放系数；除以 `aspect` 保证圆形不会被拉成椭圆。
- `-1` 放在 `w` 行，使得 `w_clip = -z_view`。可见点 `z_view < 0`，于是 `w > 0`，除法方向正确；相机背后的点 `w < 0`，会被裁剪规则自动排除。
- `A = (far+near)/(near-far)` 与 `B = 2·far·near/(near-far)` 负责**深度映射**：把 `z_view = -near` 映到 `-1`，`z_view = -far` 映到 `+1`。

这两个系数可以用两个边界条件直接解出来：

```text
z_ndc = (A·z_view + B) / (-z_view)

z_view = -near  →  z_ndc = -1   →   A·near + B = near
z_view = -far   →  z_ndc = +1   →   A·far  + B = -far
```

联立即可得到 `A`、`B`。这也是为什么透视投影的深度**不是线性分布**的：分母里有一个 `-z_view`，越远的地方 `z_ndc` 变化越慢，深度精度被压缩——这一点在后面的验算里看得很清楚。

正交投影则简单得多，`w` 恒为 1，深度线性：

```text
P_ortho = [ 2/(r-l)   0         0           -(r+l)/(r-l) ]
          [ 0         2/(t-b)   0           -(t+b)/(t-b) ]
          [ 0         0        -2/(f-n)     -(f+n)/(f-n) ]
          [ 0         0         0            1           ]
```

UI、2D 游戏、阴影贴图（部分实现）用正交投影；想要"近大远小"就必须用透视。

{{< figure src="/images/opengl/frustum-ndc.png" title="视锥到 NDC 立方体" caption="投影矩阵把观察空间里的一个梯形视锥，映射成 NDC 里的一个标准立方体。立方体的“压扁”不是几何变形，而是 ÷w 的结果。" >}}

## 5. 屏幕空间：÷w 与视口

裁剪空间之后，硬件做透视除法得到 NDC：

```text
ndc = clip.xyz / clip.w
```

NDC 是一个 `[-1, 1]³` 的立方体。注意 **OpenGL 的 NDC z 是 `[-1, 1]`**，而 Direct3D 是 `[0, 1]`——同一套数学换到 D3D 上，投影矩阵的最后两个系数要改。

最后一步是视口变换，把 NDC 映射到像素：

```text
x_window = viewport_x + (x_ndc + 1) * 0.5 * viewport_width
y_window = viewport_y + (y_ndc + 1) * 0.5 * viewport_height
z_window = (z_ndc + 1) * 0.5          // 默认 glDepthRange(0, 1)
```

{{< figure src="/images/opengl/viewport-map.png" title="NDC 到像素" caption="左：NDC 里的投影形状。右：映射到 1280×720 窗口后的同一形状。OpenGL 的窗口原点在左下角，y 轴向上；而图片文件的原点在左上角，y 轴向下，保存截图时需要翻转。" >}}

这里有两个容易翻车的地方：

1. **y 轴方向**。OpenGL 窗口坐标 `y` 向上，PNG/JPG 的 `y` 向下。用 `glReadPixels` 读到的是 OpenGL 顺序，直接存成图片会上下颠倒。
2. **视口不一定是整个窗口**。分屏、小地图、离屏渲染时，`glViewport(x, y, w, h)` 只影响映射区域，NDC 坐标本身不变。

## 6. 一个顶点走完全程

设定与配图一致的场景：

```text
模型：立方体（边长 1，中心在原点），M = T(0.9, 0.5, -0.6) · Ry(35°) · Rx(15°)
相机：eye = (0, 0, 3)，看向原点，up = (0, 1, 0)
投影：fov = 45°，aspect = 1280/720，near = 0.1，far = 100
视口：1280 × 720
```

这个投影矩阵算出来是：

```text
P = [ 1.3580   0        0         0      ]
    [ 0        2.4142   0         0      ]
    [ 0        0       -1.0020   -0.2002 ]
    [ 0        0       -1         0      ]
```

其中 `2.4142 = 1/tan(22.5°)`，`1.3580 = 2.4142 / (16/9)`。

取立方体上的一个角 `(0.5, 0.5, 0.5)`，逐站记录坐标（数值由文末的 C++ 程序实际输出）：

| 阶段 | x | y | z | w |
|---|---|---|---|---|
| 物体空间 | 0.500 | 0.500 | 0.500 | 1 |
| 世界空间 | 1.661 | 0.854 | −0.385 | 1 |
| 观察空间 | 1.661 | 0.854 | −3.385 | 1 |
| 裁剪空间 | 2.255 | 2.061 | 3.192 | 3.39 |
| NDC | 0.666 | 0.609 | 0.943 | 1 |
| 窗口像素 | 1066.4 | 579.1 | — | — |

再从另外两个角看透视的效果：

| 顶点 | 观察空间 z（即 −w） | NDC x | NDC y | NDC z | 像素 (x, y) |
|---|---|---|---|---|---|
| 前上右 | −3.385 | 0.666 | 0.609 | 0.943 | (1066.4, 579.1) |
| 前下左 | −3.024 | 0.311 | −0.090 | 0.936 | (839.3, 327.7) |
| 后下右 | −4.388 | 0.297 | 0.081 | 0.956 | (829.8, 389.0) |

从这张表能读出三件事：

1. **`w` 就是到相机的距离**（观察空间 `z` 的绝对值）。近的顶点 `w ≈ 3.02`，远的 `w ≈ 4.39`。
2. **屏幕位置由 `x/w` 决定，不是由 `x` 决定**。后下右在观察空间的 `x = 0.958`，比前下左的 `0.693` 更靠右，但它的 `w = 4.39` 也更大，除下来 NDC `x` 反而更小（0.297 vs 0.311）。这就是"近大远小"在数值上的样子。
3. **NDC 的 `z` 挤在 0.936~0.956 之间**。整个立方体在深度上只占了 0.02 的范围，而近平面附近的深度变化却极其剧烈。这就是 `z-fighting` 的根源，也是"near 不要设得太小"的原因。

{{< figure src="/images/opengl/cube-spaces.png" title="同一个立方体在四个空间里的样子" caption="① 物体空间：立方体居中于原点。② 世界空间：经过 M 后跑到相机右上方。③ 观察空间：相机搬到原点，看向 −z。④ NDC：透视除法后，立方体被投影成一个略微倾斜的薄片——z 方向被压得只剩 0.02。" >}}

## 7. 手写一遍：不依赖任何库

矩阵推导看懂了，最好自己实现一遍。下面这份代码不依赖 GLM，用不到 150 行把整条链路跑通——列主序存储、右手系、`lookAt` 与 `glm::perspective` 完全一致：

```cpp
#include <cmath>
#include <cstdio>

struct Vec4 { float x, y, z, w; };

struct Mat4
{
    float m[16];   // 列主序：m[col * 4 + row]

    static Mat4 identity()
    {
        Mat4 r{};
        for (int i = 0; i < 16; ++i) r.m[i] = (i % 5 == 0) ? 1.f : 0.f;
        return r;
    }

    float& at(int row, int col) { return m[col * 4 + row]; }
    float at(int row, int col) const { return m[col * 4 + row]; }
};

static Mat4 operator*(const Mat4& a, const Mat4& b)
{
    Mat4 r{};
    for (int row = 0; row < 4; ++row)
        for (int col = 0; col < 4; ++col) {
            float s = 0.f;
            for (int k = 0; k < 4; ++k) s += a.at(row, k) * b.at(k, col);
            r.at(row, col) = s;
        }
    return r;
}

static Vec4 operator*(const Mat4& a, const Vec4& v)
{
    return Vec4{
        a.at(0, 0) * v.x + a.at(0, 1) * v.y + a.at(0, 2) * v.z + a.at(0, 3) * v.w,
        a.at(1, 0) * v.x + a.at(1, 1) * v.y + a.at(1, 2) * v.z + a.at(1, 3) * v.w,
        a.at(2, 0) * v.x + a.at(2, 1) * v.y + a.at(2, 2) * v.z + a.at(2, 3) * v.w,
        a.at(3, 0) * v.x + a.at(3, 1) * v.y + a.at(3, 2) * v.z + a.at(3, 3) * v.w};
}

static Mat4 translate(float tx, float ty, float tz)
{
    Mat4 r = Mat4::identity();
    r.at(0, 3) = tx;
    r.at(1, 3) = ty;
    r.at(2, 3) = tz;
    return r;
}

static Mat4 rotateX(float deg)
{
    const float c = std::cos(deg * 3.14159265f / 180.f);
    const float s = std::sin(deg * 3.14159265f / 180.f);
    Mat4 r = Mat4::identity();
    r.at(1, 1) = c; r.at(1, 2) = -s;
    r.at(2, 1) = s; r.at(2, 2) = c;
    return r;
}

static Mat4 rotateY(float deg)
{
    const float c = std::cos(deg * 3.14159265f / 180.f);
    const float s = std::sin(deg * 3.14159265f / 180.f);
    Mat4 r = Mat4::identity();
    r.at(0, 0) = c;  r.at(0, 2) = s;
    r.at(2, 0) = -s; r.at(2, 2) = c;
    return r;
}

static Vec4 normalize(const Vec4& a)
{
    const float len = std::sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    return {a.x / len, a.y / len, a.z / len, 0.f};
}

static Mat4 lookAt(const Vec4& eye, const Vec4& center, const Vec4& up)
{
    const Vec4 f = normalize({center.x - eye.x, center.y - eye.y, center.z - eye.z, 0.f});
    const Vec4 s = normalize({f.y * up.z - f.z * up.y,
                              f.z * up.x - f.x * up.z,
                              f.x * up.y - f.y * up.x, 0.f});
    const Vec4 u = {s.y * f.z - s.z * f.y,
                    s.z * f.x - s.x * f.z,
                    s.x * f.y - s.y * f.x, 0.f};

    Mat4 r = Mat4::identity();
    r.at(0, 0) = s.x; r.at(0, 1) = s.y; r.at(0, 2) = s.z;
    r.at(0, 3) = -(s.x * eye.x + s.y * eye.y + s.z * eye.z);
    r.at(1, 0) = u.x; r.at(1, 1) = u.y; r.at(1, 2) = u.z;
    r.at(1, 3) = -(u.x * eye.x + u.y * eye.y + u.z * eye.z);
    r.at(2, 0) = -f.x; r.at(2, 1) = -f.y; r.at(2, 2) = -f.z;
    r.at(2, 3) = (f.x * eye.x + f.y * eye.y + f.z * eye.z);
    return r;
}

static Mat4 perspective(float fovYDeg, float aspect, float zNear, float zFar)
{
    const float f = 1.f / std::tan(fovYDeg * 3.14159265f / 360.f);
    Mat4 r{};
    r.at(0, 0) = f / aspect;
    r.at(1, 1) = f;
    r.at(2, 2) = (zFar + zNear) / (zNear - zFar);
    r.at(2, 3) = (2.f * zFar * zNear) / (zNear - zFar);
    r.at(3, 2) = -1.f;
    return r;
}
```

主函数把三个角送过整条链路：

```cpp
int main()
{
    const Mat4 model = translate(0.9f, 0.5f, -0.6f) * rotateY(35.f) * rotateX(15.f);
    const Vec4 eye{0.f, 0.f, 3.f, 1.f};
    const Mat4 view = lookAt(eye, {0.f, 0.f, 0.f, 1.f}, {0.f, 1.f, 0.f, 0.f});
    const Mat4 proj = perspective(45.f, 16.f / 9.f, 0.1f, 100.f);

    const Vec4 corners[3] = {
        {0.5f, 0.5f, 0.5f, 1.f},
        {-0.5f, -0.5f, 0.5f, 1.f},
        {0.5f, -0.5f, -0.5f, 1.f},
    };
    const int W = 1280, H = 720;

    for (const Vec4& v : corners) {
        const Vec4 world = model * v;
        const Vec4 eyeSpace = view * world;
        const Vec4 clip = proj * eyeSpace;
        const Vec4 ndc{clip.x / clip.w, clip.y / clip.w, clip.z / clip.w, 1.f};
        const float sx = (ndc.x * 0.5f + 0.5f) * W;
        const float sy = (ndc.y * 0.5f + 0.5f) * H;

        std::printf("world (%.3f %.3f %.3f)  view (%.3f %.3f %.3f)  "
                    "clip (%.3f %.3f %.3f, w=%.2f)  ndc (%.3f %.3f %.3f)  "
                    "pixel (%.1f, %.1f)\n",
                    world.x, world.y, world.z, eyeSpace.x, eyeSpace.y, eyeSpace.z,
                    clip.x, clip.y, clip.z, clip.w, ndc.x, ndc.y, ndc.z, sx, sy);
    }
    return 0;
}
```

输出与第 6 节的表完全一致——这也是一份可以拿来对答案的参考实现。真实项目里不必重复造轮子，用 GLM 即可；但知道每一步在算什么，调试时能省下大量时间。

## 8. 实际项目：GLM + 顶点着色器

```cpp
const glm::mat4 model = glm::rotate(glm::mat4(1.0f), angle, glm::vec3(0, 1, 0));
const glm::mat4 view  = glm::lookAt(eye, target, glm::vec3(0, 1, 0));
const glm::mat4 proj  = glm::perspective(glm::radians(45.0f), aspect, 0.1f, 100.0f);

glUniformMatrix4fv(locModel, 1, GL_FALSE, glm::value_ptr(model));
glUniformMatrix4fv(locView,  1, GL_FALSE, glm::value_ptr(view));
glUniformMatrix4fv(locProj,  1, GL_FALSE, glm::value_ptr(proj));
```

```glsl
#version 330 core
layout (location = 0) in vec3 aPos;
uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;
void main()
{
    gl_Position = uProj * uView * uModel * vec4(aPos, 1.0);
}
```

`glm::value_ptr` 给出的是列主序数组，和着色器里的 `mat4` 布局一致，所以 `transpose` 参数必须是 `GL_FALSE`。如果自己用手写矩阵按行主序存储，这里要传 `GL_TRUE`，或者干脆在 CPU 侧转置好——两种写法都行，混用就会得到一个"看起来旋转错了 90 度"的模型。

## 9. 常见错误对照表

| 现象 | 可能原因 | 检查方法 |
|---|---|---|
| 模型完全不显示 | 矩阵顺序写成 `M·V·P` | 统一用 `P·V·M·vec4(pos, 1)` |
| 模型大小随窗口变化 | `aspect` 没传或用了窗口像素比 | 用 `width/height`（浮点）更新投影矩阵 |
| 物体上下/左右颠倒 | 相机 up 向量或 y 翻转 | 检查 `lookAt` 的 up 与图像保存方式 |
| 物体在相机背后仍在画 | 忘了 `w > 0` 的裁剪语义 | 检查投影矩阵 `w` 行是否为 `-1` |
| 深度闪烁 | near 太小，深度精度被压缩 | `near/far` 比值控制在 `1:1000` 以内 |
| 光照方向不对 | 法线直接乘了 `M` | 换成 `transpose(inverse(mat3(M)))` |
| 非均匀缩放后法线歪掉 | 同上 | 同上 |
| 视口变换后位置偏移 | `glViewport` 的 `x/y` 不是 0 | 检查 `glViewport` 参数 |
| 保存的截图上下颠倒 | OpenGL 与图片的 y 轴相反 | 读取后逐行翻转 |
| 3D 模型换到 D3D 后深度异常 | NDC z 范围不同（`[-1,1]` vs `[0,1]`） | 调整投影矩阵的 `A`、`B` |
| 相机 `up` 与视线平行 | 叉积为零，`lookAt` 退化 | 换一个不共线的 up |

一个实用的调试技巧是**逐站打印坐标**：先在 CPU 侧算出三个矩阵，把同一个顶点送过 `M → V → P`，对照文中的表看哪一步开始不对劲。比在 shader 里 `printf` 快得多。

## 10. 小结

五个空间，四次变换：

```text
局部 ──M──▶ 世界 ──V──▶ 观察 ──P──▶ 裁剪 ──÷w──▶ NDC ──视口──▶ 屏幕
```

- `M` 决定物体在哪、朝哪、多大；
- `V` 决定从哪看；
- `P` 决定看多宽、多深，以及"近大远小"的强度；
- 透视除法与视口变换由硬件完成，但它们的规则（`[-1,1]`、`[0,1]`、y 轴方向）必须心里有数。

把这套链路走通之后，再去读[《渲染管线》]({{< relref "opengl-rendering-pipeline.md" >}})里光栅化与逐片元操作的部分，会发现很多"奇怪的规定"其实都来自这几个坐标系的约定。而如果你还写过 OpenCV 的相机标定，会发现 OpenGL 的 `P·V·M` 与相机内参、外参是同一件事的两种记法——只不过一个是右手系看 `-z`，一个是图像坐标系看 `+z`。
