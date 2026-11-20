---
title: "OpenGL 渲染管线：从顶点到像素的完整旅程"
date: 2026-11-20
description: "按阶段拆解 OpenGL 3.3 可编程管线：顶点数据、顶点着色器、图元装配、裁剪、透视除法与视口、光栅化、片元着色器、逐片元操作，配完整 C++/GLSL 代码、配图与性能排查清单。"
draft: false
---

一帧 60 FPS 的画面只有 16.6 毫秒。在这 16.6 毫秒里，GPU 要读取几十万个顶点、组装成三角形、把它们切成上百万个片元、逐个计算颜色，最后按遮挡关系写入屏幕。整个过程是一条**流水线**：数据从一端进去，像素从另一端出来，中间的每一站只做一件小事，但所有站同时开工。

理解这条流水线，最直接的好处是：当画面全黑、模型消失、边缘锯齿或者帧率突然掉一半时，你知道该去查哪一站。

{{< figure src="/images/opengl/pipeline-overview.png" title="OpenGL 3.3 可编程管线" caption="青色是可编程阶段（你写 shader），灰色由驱动与硬件实现。右侧标注了数据在每个阶段所处的坐标空间与负责的矩阵。" >}}

## 1. 全景：两种执行频率

管线里所有阶段的执行频率并不相同，这一点决定了性能该怎么算：

| 阶段 | 可编程 | 每个顶点执行？ | 每个图元执行？ | 每个像素/片元执行？ |
|---|---|---|---|---|
| 顶点数据读取 | 否 | ✓ | | |
| 顶点着色器 | ✓ | ✓ | | |
| 图元装配 | 否 | | ✓ | |
| 曲面细分 / 几何着色器 | ✓（可选） | | ✓ | |
| 裁剪 | 否 | | ✓ | |
| 透视除法 + 视口 | 否 | ✓ | | |
| 光栅化 | 否 | | ✓ | ✓ |
| 片元着色器 | ✓ | | | ✓ |
| 逐片元操作 | 否 | | | ✓ |

一个 10 万顶点的模型，顶点着色器只跑 10 万次；但它铺满屏幕后可能有 200 万片元，片元着色器就要跑 200 万次。**顶点着色器再贵，通常也贵不过片元着色器乘以覆盖率**——这是后面判断瓶颈的基础。

图中的 `GL_TRIANGLES` 是最常见的图元模式。所有阶段都是为三角形设计的：三角形永远共面、永远凸，容易被硬件切成整齐的小块并行处理。

## 2. 顶点数据：VBO、EBO 与 VAO

顶点数据最初只是一块内存。GPU 不认识"顶点"，只认识缓冲区里的字节：

- **VBO**（Vertex Buffer Object）：显存里的一块原始数据，装着位置、法线、UV 等属性。
- **EBO**（Element Buffer Object，也叫 IBO）：索引数组，告诉 GPU 按什么顺序把顶点拼成三角形。
- **VAO**（Vertex Array Object）：**不是数据**，而是一份"状态记录"——它记住当前绑定了哪个 VBO、哪个 EBO、每个属性从哪个字节开始读、用什么类型读。

VAO 是新手最容易忽略的东西。核心模式下没有默认 VAO，忘记绑定或忘记 `glEnableVertexAttribArray` 的结果通常是黑屏，而且没有任何报错。

{{< figure src="/images/opengl/vertex-layout.png" title="交错顶点缓冲的 stride 与 offset" caption="一个顶点 24 字节：位置 12 字节 + 法线 12 字节。stride 告诉 GPU 下一个顶点在哪，offset 告诉它每个属性从哪个字节开始。" >}}

一个立方体有 8 个角，但渲染时需要 **24 个顶点**：每个角被 3 个面共用，而三个面的法线不同。顶点属性必须整体一致，所以"位置相同、法线不同"的点只能拆开存。

```cpp
struct Vertex
{
    glm::vec3 pos;      // 12 字节
    glm::vec3 normal;   // 12 字节
};                      // sizeof(Vertex) == 24

void buildCube(std::vector<Vertex>& vertices, std::vector<GLuint>& indices)
{
    const glm::vec3 corners[8] = {
        {-0.5f, -0.5f, -0.5f}, {0.5f, -0.5f, -0.5f},
        {0.5f, 0.5f, -0.5f},   {-0.5f, 0.5f, -0.5f},
        {-0.5f, -0.5f, 0.5f},  {0.5f, -0.5f, 0.5f},
        {0.5f, 0.5f, 0.5f},    {-0.5f, 0.5f, 0.5f},
    };

    // 每个面单独 4 个顶点：位置相同但法线不同，不能共享
    struct Face { int a, b, c, d; glm::vec3 n; };
    const Face faces[6] = {
        {4, 5, 6, 7, {0, 0, 1}},    // +z
        {1, 0, 3, 2, {0, 0, -1}},   // -z
        {5, 1, 2, 6, {1, 0, 0}},    // +x
        {0, 4, 7, 3, {-1, 0, 0}},   // -x
        {7, 6, 2, 3, {0, 1, 0}},    // +y
        {0, 1, 5, 4, {0, -1, 0}},   // -y
    };

    vertices.clear();
    indices.clear();
    for (const Face& face : faces) {
        const int ids[4] = {face.a, face.b, face.c, face.d};
        const GLuint base = static_cast<GLuint>(vertices.size());
        for (int i = 0; i < 4; ++i) {
            vertices.push_back({corners[ids[i]], face.n});
        }
        // 一个四边形拆成两个三角形，保持逆时针绕序
        const GLuint faceIndices[6] = {base, base + 1, base + 2,
                                       base, base + 2, base + 3};
        indices.insert(indices.end(), faceIndices, faceIndices + 6);
    }
}
```

上传并描述这块内存：

```cpp
GLuint vao = 0, vbo = 0, ebo = 0;
glGenVertexArrays(1, &vao);
glGenBuffers(1, &vbo);
glGenBuffers(1, &ebo);

glBindVertexArray(vao);                     // 后面的设置都记进这个 VAO

glBindBuffer(GL_ARRAY_BUFFER, vbo);
glBufferData(GL_ARRAY_BUFFER,
             static_cast<GLsizeiptr>(vertices.size() * sizeof(Vertex)),
             vertices.data(), GL_STATIC_DRAW);

glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, ebo);
glBufferData(GL_ELEMENT_ARRAY_BUFFER,
             static_cast<GLsizeiptr>(indices.size() * sizeof(GLuint)),
             indices.data(), GL_STATIC_DRAW);

glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex),
                      reinterpret_cast<void*>(0));
glEnableVertexAttribArray(0);

glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, sizeof(Vertex),
                      reinterpret_cast<void*>(offsetof(Vertex, normal)));
glEnableVertexAttribArray(1);

glBindVertexArray(0);                       // 解绑，避免误改
```

`glVertexAttribPointer` 的最后一个参数看着像指针，其实是**字节偏移量**——它从缓冲区起点开始算，不会被解引用。传 `offsetof(Vertex, normal)` 比硬编码 `12` 更安全，结构体加个字段也不会错位。

## 3. 顶点着色器：每个顶点一次

顶点着色器唯一的强制任务是把顶点送到 **裁剪空间**，写进内建变量 `gl_Position`（一个 `vec4`）。其余输出都会在光栅化阶段被插值后传给片元着色器。

```glsl
#version 330 core
layout (location = 0) in vec3 aPos;
layout (location = 1) in vec3 aNormal;

uniform mat4 uModel;
uniform mat4 uView;
uniform mat4 uProj;

out vec3 vNormal;
out vec3 vWorldPos;

void main()
{
    vec4 world = uModel * vec4(aPos, 1.0);
    vWorldPos = world.xyz;

    // 法线用模型矩阵的逆转置，否则非均匀缩放会让法线歪掉
    vNormal = mat3(transpose(inverse(uModel))) * aNormal;

    gl_Position = uProj * uView * world;
}
```

`layout (location = 0)` 直接对应 `glVertexAttribPointer` 的第一个参数。也可以用 `glGetAttribLocation` 动态查询，但显式指定更省事，还能避免链接器把未使用的属性优化掉。

这里出现的三个矩阵——模型、观察、投影——就是[《五大坐标空间》]({{< relref "opengl-coordinate-spaces.md" >}})的主题，本文只需要知道它们的乘积把顶点从局部坐标送到了裁剪空间。

## 4. 图元装配与可选阶段

顶点着色器输出的顶点按 `glDrawElements` 的模式组装成图元：

| 模式 | 含义 | 顶点复用 |
|---|---|---|
| `GL_POINTS` | 每个顶点一个点 | 无 |
| `GL_LINES` | 每 2 个顶点一条线 | 无 |
| `GL_TRIANGLES` | 每 3 个顶点一个三角形 | 无（靠索引复用） |
| `GL_TRIANGLE_STRIP` | 相邻三角形共享一条边 | 高 |
| `GL_TRIANGLE_FAN` | 所有三角形共享第一个顶点 | 高（扇形） |

**绕序与面剔除**：默认 `GL_CCW` 为正面。开启 `glEnable(GL_CULL_FACE)` 后，背向相机的三角形会被直接丢掉——对一个封闭模型，这能省掉大约一半的三角形。

两个可选阶段插在装配之后：

- **曲面细分着色器**：把粗糙的低模细分出更多三角形，适合地形、曲面、自适应 LOD。
- **几何着色器**：能读取整个图元并输出任意数量的新图元，适合粒子、法线可视化、阴影体积。

它们都是可选的，且对性能影响明显（几何着色器的输出数量在编译期不确定，会限制并行度）。绝大多数应用不需要。

## 5. 裁剪

相机看不全无限大的世界，只看到一个**视锥**（frustum）。图元装配后，管线会裁掉视锥外的部分。

裁剪在**裁剪空间**里进行，规则非常简洁：

```text
-w ≤ x ≤ w
-w ≤ y ≤ w
-w ≤ z ≤ w
```

任何一部分越界的三角形都会被切成新的三角形，交点由硬件插值生成——顶点数会发生变化，但顶点着色器不会重跑。

用 `w` 而不是固定常数做边界，是这套规则最妙的地方：顶点在相机背后时 `w` 为负，`-w ≤ x ≤ w` 自动变成不可能满足的条件，这类"翻折"的三角形会被干净地裁掉，不会在屏幕上留下诡异的尖角。

近平面裁剪还有一个特殊作用：`z = -w` 平面上的点，透视除法时 `w` 接近 0，会产生数值爆炸。把它裁掉，后面的除法才安全。

## 6. 透视除法与视口变换

裁剪之后，GPU 执行**透视除法**：

```text
ndc = clip.xyz / clip.w
```

得到的 `ndc` 落在 `[-1, 1]³` 的立方体里（NDC，Normalized Device Coordinates）。注意这一步不在着色器里，是硬件固定功能：你在顶点着色器里写的是裁剪空间坐标，`÷w` 是自动发生的。

随后视口变换把 NDC 映射到窗口像素：

```text
x_window = (x_ndc * 0.5 + 0.5) * viewport_width  + viewport_x
y_window = (y_ndc * 0.5 + 0.5) * viewport_height + viewport_y
z_window = z_ndc * 0.5 + 0.5                     // 深度范围 [0, 1]
```

深度从 NDC 的 `[-1, 1]` 变成 `[0, 1]` 这一步经常被忽略。`glDepthRange` 默认就是 `[0, 1]`，所以深度缓冲里存的 0 表示最近、1 表示最远；如果自己写 CPU 光栅化器，忘了这一步会让深度测试全错。

```cpp
// 窗口大小变化时同步视口，否则画面会被拉伸
void framebufferSizeCallback(GLFWwindow*, int width, int height)
{
    glViewport(0, 0, width, height);
}
```

## 7. 光栅化

光栅化回答两个问题：**这个三角形覆盖了哪些像素**，以及**顶点的属性怎么变成每个像素的值**。

硬件在像素中心采样（像素 `(x, y)` 的中心是 `(x+0.5, y+0.5)`），落在三角形内部的像素生成一个片元。判定使用 edge function（三个边的有向面积），三个结果同号即在内部；正好落在边上的像素按 top-left 规则归属，保证相邻三角形不会重复或遗漏。

{{< figure src="/images/opengl/rasterization.png" title="光栅化与属性插值" caption="左：以像素中心为采样点，蓝色实心点所在的像素被覆盖。右：三个顶点的颜色按重心坐标插值，得到每个片元的颜色。" >}}

覆盖只是第一步。顶点上的颜色、法线、UV 都要按**重心坐标**插值：

```text
attribute(p) = w0 · a0 + w1 · a1 + w2 · a2,   w0 + w1 + w2 = 1
```

但透视投影之后，屏幕空间里的线性插值会出错：远处的三角形在屏幕上更小，如果按屏幕坐标线性插值，纹理会扭曲。硬件实际做的是**透视校正插值**——把属性除以 `w` 后再插值，最后乘回来：

```text
attr = ( Σ (a_i / w_i) · w_i_weight ) / ( Σ (1 / w_i) · w_i_weight )
```

这就是为什么 `w` 被称为"第四个坐标"：它不只是给透视除法用的，还决定了插值的权重。

**抗锯齿**：默认一个像素只采样一次，边缘就是硬台阶。MSAA 让每个像素有多个采样点，覆盖率从 0/1 变成 0、0.25、0.5、0.75、1，边缘被混合；片元着色器仍然每像素跑一次（除非开启 sample shading），代价主要在显存带宽上。

## 8. 片元着色器

片元着色器对每个片元执行一次，决定这个像素最终是什么颜色。它可以读插值后的属性、采样纹理、做光照计算，也可以直接 `discard` 丢弃片元。

```glsl
#version 330 core
in vec3 vNormal;
in vec3 vWorldPos;

uniform vec3 uLightDir;
uniform vec3 uViewPos;

out vec4 FragColor;

void main()
{
    vec3 N = normalize(vNormal);
    vec3 L = normalize(-uLightDir);
    vec3 V = normalize(uViewPos - vWorldPos);
    vec3 H = normalize(L + V);              // Blinn-Phong 的半程向量

    float diff = max(dot(N, L), 0.0);       // 漫反射
    float spec = pow(max(dot(N, H), 0.0), 64.0);   // 高光

    vec3 base = vec3(0.88, 0.45, 0.26);
    vec3 color = base * (0.18 + 0.82 * diff) + vec3(0.60) * spec;
    FragColor = vec4(color, 1.0);
}
```

几点值得注意：

- **`in` 变量默认是平滑插值**（`smooth`）。想让整个三角形取同一个值（比如面法线），用 `flat in`；想按屏幕空间线性插值（UI、某些后处理），用 `noperspective`。
- **`discard` 有代价**：它会让硬件无法提前做深度测试（early-z），片元着色器必须真正跑完才能知道该不该丢弃。用 alpha 测试做植被时，这个代价很实在。
- **片元着色器里不要写 `gl_FragDepth`**，除非真的需要——一写就会关闭 early-z。

## 9. 逐片元操作

片元着色器输出颜色后，还要过一关才能写进帧缓冲。顺序是固定的：

| 顺序 | 测试/操作 | 说明 |
|---|---|---|
| 1 | 裁剪测试（scissor） | 只保留指定矩形内的片元 |
| 2 | 模板测试（stencil） | 按模板缓冲的值决定取舍，做描边、遮罩 |
| 3 | 深度测试（depth） | 比较 `gl_FragCoord.z` 与深度缓冲 |
| 4 | 混合（blend） | 与帧缓冲已有颜色按公式混合 |
| 5 | 写掩码 / sRGB | 按通道掩码写入，必要时做编码 |

{{< figure src="/images/opengl/depth-blend.png" title="深度测试与混合" caption="同样先画红色再画蓝色：开深度测试时近处的红色胜出；关掉后蓝色直接覆盖；半透明蓝色则与红色混合。这正是半透明物体需要从远到近排序的原因。" >}}

混合的常用公式（`GL_SRC_ALPHA, GL_ONE_MINUS_SRC_ALPHA`）：

```text
out = src.rgb * src.a + dst.rgb * (1 - src.a)
```

**early-z**：当片元着色器不影响深度、不使用 `discard`、也没有开启混合时，硬件可以在着色器之前先做深度测试，把被遮挡的片元直接丢掉。所以渲染不透明物体时，**先画近的、后画远的**能明显减少片元着色器的调用次数（这叫 front-to-back 排序）。

深度冲突（z-fighting）也是这一站的问题：两个面深度差太小，精度不够区分。解决办法是缩小 near/far 的比值、提高深度缓冲位深，而不是靠"把物体挪开一点"。

## 10. 主程序：把各阶段串起来

把前面的片段拼起来，就是一个能跑的旋转立方体。第 2 节给出了 `buildCube` 与 VAO/VBO/EBO 的完整设置，第 3、8 节给出了两个 shader；这里补上着色器编译工具与 `main`，依赖只有三个：GLFW（窗口与上下文）、GLAD（函数指针加载）、GLM（矩阵）。

```cpp
#include <glad/glad.h>
#include <GLFW/glfw3.h>

#include <glm/glm.hpp>
#include <glm/gtc/matrix_transform.hpp>
#include <glm/gtc/type_ptr.hpp>

#include <cstddef>
#include <iostream>
#include <vector>

// 编译一个着色器并检查日志
static GLuint compileShader(GLenum type, const char* source)
{
    const GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, nullptr);
    glCompileShader(shader);

    GLint ok = GL_FALSE;
    glGetShaderiv(shader, GL_COMPILE_STATUS, &ok);
    if (!ok) {
        char log[1024];
        glGetShaderInfoLog(shader, sizeof(log), nullptr, log);
        std::cerr << "shader compile failed:\n" << log << '\n';
        glDeleteShader(shader);
        return 0;
    }
    return shader;
}

// 链接成 program
static GLuint createProgram(const char* vs, const char* fs)
{
    const GLuint v = compileShader(GL_VERTEX_SHADER, vs);
    const GLuint f = compileShader(GL_FRAGMENT_SHADER, fs);
    if (v == 0 || f == 0) {
        return 0;
    }

    const GLuint program = glCreateProgram();
    glAttachShader(program, v);
    glAttachShader(program, f);
    glLinkProgram(program);

    GLint ok = GL_FALSE;
    glGetProgramiv(program, GL_LINK_STATUS, &ok);
    if (!ok) {
        char log[1024];
        glGetProgramInfoLog(program, sizeof(log), nullptr, log);
        std::cerr << "program link failed:\n" << log << '\n';
        glDeleteProgram(program);
        return 0;
    }

    glDeleteShader(v);
    glDeleteShader(f);
    return program;
}

int main()
{
    if (!glfwInit()) {
        std::cerr << "glfwInit failed\n";
        return 1;
    }

    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 3);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);

    GLFWwindow* window = glfwCreateWindow(1280, 720, "OpenGL Pipeline", nullptr, nullptr);
    if (window == nullptr) {
        glfwTerminate();
        return 1;
    }
    glfwMakeContextCurrent(window);
    glfwSetFramebufferSizeCallback(window, framebufferSizeCallback);

    if (!gladLoadGLLoader(reinterpret_cast<GLADloadproc>(glfwGetProcAddress))) {
        glfwTerminate();
        return 1;
    }

    glEnable(GL_DEPTH_TEST);
    glEnable(GL_CULL_FACE);
    glCullFace(GL_BACK);
    glFrontFace(GL_CCW);

    // ... 创建 VAO/VBO/EBO，上传 buildCube 生成的数据 ...

    const GLuint program = createProgram(kVertexShader, kFragmentShader);

    const glm::vec3 eye(0.0f, 0.0f, 3.0f);
    const glm::mat4 view = glm::lookAt(eye, glm::vec3(0.0f),
                                       glm::vec3(0.0f, 1.0f, 0.0f));

    while (!glfwWindowShouldClose(window)) {
        if (glfwGetKey(window, GLFW_KEY_ESCAPE) == GLFW_PRESS) {
            glfwSetWindowShouldClose(window, GLFW_TRUE);
        }

        int width = 0, height = 0;
        glfwGetFramebufferSize(window, &width, &height);
        glViewport(0, 0, width, height);
        glClearColor(0.07f, 0.08f, 0.10f, 1.0f);
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

        const float aspect = height > 0 ? static_cast<float>(width) / height : 1.0f;
        const glm::mat4 proj = glm::perspective(glm::radians(45.0f), aspect, 0.1f, 100.0f);

        const float t = static_cast<float>(glfwGetTime());
        const glm::mat4 model = glm::rotate(glm::mat4(1.0f), t * 0.7f, glm::vec3(0, 1, 0))
                              * glm::rotate(glm::mat4(1.0f), 0.35f, glm::vec3(1, 0, 0));

        glUseProgram(program);
        glUniformMatrix4fv(glGetUniformLocation(program, "uModel"), 1, GL_FALSE,
                           glm::value_ptr(model));
        glUniformMatrix4fv(glGetUniformLocation(program, "uView"), 1, GL_FALSE,
                           glm::value_ptr(view));
        glUniformMatrix4fv(glGetUniformLocation(program, "uProj"), 1, GL_FALSE,
                           glm::value_ptr(proj));
        glUniform3f(glGetUniformLocation(program, "uLightDir"), -0.4f, -0.7f, -0.6f);
        glUniform3fv(glGetUniformLocation(program, "uViewPos"), 1, glm::value_ptr(eye));

        glBindVertexArray(vao);
        glDrawElements(GL_TRIANGLES, static_cast<GLsizei>(indices.size()),
                       GL_UNSIGNED_INT, nullptr);

        glfwSwapBuffers(window);
        glfwPollEvents();
    }

    glDeleteProgram(program);
    glDeleteBuffers(1, &ebo);
    glDeleteBuffers(1, &vbo);
    glDeleteVertexArrays(1, &vao);
    glfwTerminate();
    return 0;
}
```

{{< figure src="/images/opengl/pipeline-cube.png" title="这段代码的实际输出" caption="在 NVIDIA 显卡、OpenGL 3.3 核心模式下渲染出的画面。立方体的三个可见面亮度不同——那是漫反射在起作用；背面的三角形被面剔除丢掉了。" >}}

CMake 配置：

```cmake
cmake_minimum_required(VERSION 3.16)
project(GlPipeline LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(glfw3 CONFIG REQUIRED)
find_package(glm CONFIG REQUIRED)
find_package(OpenGL REQUIRED)

add_executable(gl_pipeline
    main.cpp
    third_party/glad.c
)
target_include_directories(gl_pipeline PRIVATE third_party/include)
target_link_libraries(gl_pipeline PRIVATE glfw glm::glm OpenGL::GL)
```

## 11. 性能：先判断瓶颈在哪

管线是流水线，最慢的那一站决定整体速度。定位瓶颈比盲目优化重要得多：

| 现象 | 更可能的瓶颈 | 排查方式 |
|---|---|---|
| 顶点少、分辨率高、帧率仍然很低 | 片元/带宽 | 把窗口缩小一半，帧率明显回升 |
| 顶点多、模型复杂、帧率低 | 顶点处理 | 关闭部分模型或降低细分，帧率回升 |
| 帧率随 draw call 数量线性下降 | CPU 侧提交 | 用 instancing 或合并批次 |
| 全屏后处理阶段掉帧 | 带宽 | 降低分辨率、用半精度、减少 RT 切换 |
| 半透明物体多时掉帧 | overdraw + 混合 | 排序 + 减少透明层数 |

几条经验：

1. **减少 draw call**：每次 `glDraw*` 都有 CPU 开销。同材质的东西用 `glDrawElementsInstanced` 或把顶点合并到一个大 VBO 里。
2. **减少状态切换**：着色器、纹理、混合状态的切换比 draw call 更贵。按材质排序，把相同状态的绘制挨在一起。
3. **控制 overdraw**：透明物体先关深度写入、从远到近画；不透明物体先画近的，让 early-z 发挥作用。
4. **别在 shader 里算常量**：能放到 CPU 预计算的矩阵，不要每帧在片元着色器里重算。
5. **用对精度**：`highp`/`mediump` 在移动端差别很大，桌面端影响小但也不是零。

## 12. 黑屏排查清单

画面不显示时，按管线的顺序从前往后查，比凭感觉改代码快得多：

1. **上下文创建成功了吗**：`glfwCreateWindow` 返回空？检查 OpenGL 版本提示与显卡驱动。
2. **函数指针加载了吗**：忘了 `gladLoadGLLoader`，所有 GL 调用都会崩溃或静默失败。
3. **VAO 绑定、属性启用、stride/offset 对吗**：这三个是黑屏的头号原因。
4. **EBO 绑定在 VAO 记录期间吗**：`GL_ELEMENT_ARRAY_BUFFER` 的绑定属于 VAO，解绑 VAO 前别乱动。
5. **shader 编译/链接成功吗**：一定要检查 `GL_COMPILE_STATUS` 并打印日志。
6. **矩阵对吗**：把 `uProj * uView * uModel` 的顺序写反、`near/far` 传反、FOV 忘了转弧度，都会让模型跑出视野。
7. **面剔除方向反了吗**：绕序写错时，正面被当成背面剔掉，屏幕上什么都不剩；先临时 `glDisable(GL_CULL_FACE)` 验证。
8. **深度测试开着但没清深度缓冲**：`glClear` 的掩码要同时包含 `GL_DEPTH_BUFFER_BIT`。
9. **视口尺寸是 0 吗**：窗口最小化后宽高为 0，`glViewport` 会让所有片元落在屏幕外。
10. **清屏色和物体颜色太接近**：看着像黑屏，其实只是看不见。

管线本身并不复杂，复杂的是每个阶段的**约定**：坐标系怎么定义、谁是正面、深度范围是 `[-1,1]` 还是 `[0,1]`、插值是不是透视校正。把这些约定记清楚，调试时就有一张可对照的地图。

下一步可以继续读[《五大坐标空间》]({{< relref "opengl-coordinate-spaces.md" >}})——本文里一笔带过的 `M`、`V`、`P`，在那篇文章里会逐个推导，并用一组具体数字把同一个顶点从模型空间一路算到屏幕像素。
