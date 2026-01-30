<div align="center">

# GoTTY

[![Go Version](https://img.shields.io/badge/Go-1.23-blue.svg)](https://golang.org)
[![Node Version](https://img.shields.io/badge/Node-22-green.svg)](https://nodejs.org)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**将您的终端作为Web应用程序共享**

GoTTY是一个简单的命令行工具，可以将命令行工具转换为Web应用程序

</div>

## 主要特性

- **Web终端访问** - 通过浏览器访问您的终端
- **身份认证** - 支持基本认证（自定义登录界面）
- **文件管理** - 内置文件管理器，支持上传/下载/删除/预览
- **现代UI** - 基于xterm.js的现代化深色主题界面
- **安全** - TLS/SSL加密连接支持
- **响应式** - 支持移动端访问
- **可拖拽** - 文件管理按钮支持拖拽和边缘吸附
- **文件夹导航** - 支持递归浏览和管理文件夹
- **文件预览** - 支持代码、图片、视频、文档等多种格式预览
- **快速复制** - 代码和CSV文件一键复制到剪贴板

## 快速开始

### 安装依赖

```bash
# 安装Go依赖
go mod download

# 安装Node.js依赖
cd js && npm install && cd ..
```

### 编译

```bash
# 编译当前系统版本
make

# 编译所有平台（darwin/arm64, windows/amd64, linux/amd64）
make all

# 编译指定平台
make build t="linux:amd64"
```

编译产物位于 `./release/` 目录。

### 运行

```bash
# 简单运行
./release/gotty_<os>_<arch> bash

# 使用配置文件
./release/gotty_<os>_<arch> -c /path/to/config.txt bash

# 指定端口和允许写入
./release/gotty_<os>_<arch> --port 8080 --permit-write bash
```

访问 `http://localhost:8080/` 即可使用。

## 功能展示

### 文件管理器
- **文件列表**：显示文件名、大小、修改时间，支持多选
- **批量操作**：上传、下载、删除多个文件
- **进度显示**：上传和下载都有实时进度条

### 文件预览
- **代码高亮**：支持30+种编程语言，GitHub Dark主题
- **文档预览**：Markdown、HTML、CSV表格、Excel、Word
- **媒体预览**：图片缩放、视频播放控制
- **快速操作**：一键复制、全屏查看、关闭预览

### 安全认证
- **自定义登录**：深色主题登录界面
- **会话管理**：安全的Session管理
- **WebSocket认证**：终端连接同样需要认证

## Docker部署

### 使用Docker构建

```bash
# 构建镜像
docker build -t gotty:latest .

# 运行容器
docker run -d -p 8080:8080 gotty:latest
```

### 使用Docker Compose

```bash
# 启动服务
docker-compose up -d

# 停止服务
docker-compose down
```

配置文件：`docker-compose.yml`

## 配置

GoTTY支持通过配置文件或命令行参数进行配置。

### 配置文件示例

创建 `.gotty` 或自定义配置文件：

```toml
# 监听地址和端口
address = "0.0.0.0"
port = "8080"

# 允许客户端写入
permit_write = true

# 启用基本认证
enable_basic_auth = true
credential = "admin:your_password_here"

# 启用TLS（可选）
# enable_tls = true
# tls_crt_file = "/path/to/cert.crt"
# tls_key_file = "/path/to/cert.key"

# 自动重连
enable_reconnect = true
reconnect_time = 10

# 最大连接数（0表示无限制）
max_connection = 0
```

完整配置选项请查看 [.gotty](.gotty) 文件（包含中文注释）。

### 命令行参数

```bash
./gotty --help
```

常用参数：

| 参数                 | 说明             | 默认值     |
| -------------------- | ---------------- | ---------- |
| `-a, --address`      | 监听地址         | `0.0.0.0`  |
| `-p, --port`         | 监听端口         | `8080`     |
| `-w, --permit-write` | 允许客户端写入   | `false`    |
| `-c, --config`       | 配置文件路径     | `~/.gotty` |
| `--permit-arguments` | 允许URL参数      | `false`    |
| `--once`             | 只接受一个客户端 | `false`    |
| `--timeout`          | 超时时间（秒）   | `0`        |
| `--max-connection`   | 最大连接数       | `0`        |

## 功能说明

### 1. 自定义登录界面

启用基本认证后，系统会显示定制的深色主题登录界面，而非浏览器默认的Basic Auth弹窗。

配置：
```toml
enable_basic_auth = true
credential = "username:password"
```

### 2. 文件管理器

内置文件管理器功能：

#### 基础功能
- **上传文件** - 支持单个或批量文件上传
- **上传文件夹** - 保留完整目录结构
- **大文件上传** - 超过10MB自动分片上传（5MB/片）
- **下载文件** - 单文件下载，带进度显示
- **批量下载** - 多选文件打包为ZIP下载
- **删除文件** - 单个或批量删除，带确认对话框
- **文件夹导航** - 面包屑导航，支持快速返回
- **递归浏览** - 支持浏览所有子文件夹
- **可拖拽按钮** - 文件管理按钮支持拖拽和四边吸附

#### 文件预览
支持在线预览多种文件格式：

**图片预览**
- 支持格式：JPG, PNG, GIF, SVG, WebP, BMP
- 自适应窗口大小，支持全屏查看

**视频预览**
- 支持格式：MP4, WebM, OGG, MOV, AVI, MKV
- HTML5播放器，完整控制栏

**代码预览（带语法高亮）**
- 支持语言：JavaScript, TypeScript, Python, Go, Java, C/C++, Rust, PHP, Ruby, Swift, Kotlin, Dart等30+种语言
- GitHub Dark主题
- 一键复制代码内容

**文档预览**
- Markdown：渲染为HTML，支持代码块高亮
- HTML：沙箱iframe预览
- CSV：表格形式展示，支持复制原始内容
- Excel (xlsx/xls)：表格形式展示第一个工作表
- Word (docx)：转换为HTML展示，保留格式
- PDF：使用PDF.js渲染，支持页面导航

**其他格式**
- TXT, LOG等文本文件：纯文本预览
- JSON, XML, YAML：带语法高亮
- 不支持格式：显示自定义对话框，提示下载

文件默认上传到 `./uploads` 目录。

### 3. 终端功能

基于xterm.js的完整终端模拟器：

- 完整的终端仿真
- 复制/粘贴支持
- 自适应窗口大小
- 256色支持
- UTF-8支持

### 4. 使用技巧

#### 文件预览快捷操作
- **复制内容**：代码和CSV文件预览时，点击右上角复制按钮即可复制全部内容
- **全屏查看**：点击全屏按钮可最大化预览窗口，再次点击退出
- **快速关闭**：点击预览窗口外的灰色区域或按ESC键快速关闭
- **代码高亮**：自动识别文件类型并应用相应语法高亮

#### 文件管理技巧
- **批量选择**：点击表头复选框可全选/取消全选
- **快速导航**：点击面包屑导航可快速返回上级目录
- **拖拽上传**：将文件拖拽到文件列表区域即可上传
- **大文件上传**：超过10MB的文件会自动分片上传，更稳定
- **批量操作**：选中多个文件后可批量下载（ZIP）或批量删除

#### 键盘快捷键
- **Ctrl+C / Cmd+C**：复制选中文本（终端内）
- **Ctrl+V / Cmd+V**：粘贴（终端内）
- **ESC**：关闭预览窗口或对话框
- **F11**：浏览器全屏（推荐用于终端全屏）

## 开发

### 项目结构

```
gotty/
├── main.go              # 主程序入口
├── go.mod               # Go模块定义
├── Makefile            # 构建脚本
├── Dockerfile          # Docker镜像构建
├── docker-compose.yml  # Docker编排
├── .gotty              # 配置文件模板（含中文注释）
├── server/             # 服务器逻辑
│   ├── server.go       # HTTP服务器
│   ├── handlers.go     # 请求处理
│   ├── file_handler.go # 文件管理API
│   ├── auth_handler.go # 认证API
│   └── middleware.go   # 中间件
├── webtty/             # WebSocket终端协议
├── backend/            # 后端命令执行
├── js/                 # 前端源码
│   ├── src/
│   │   ├── main.ts           # 入口文件
│   │   ├── Login.tsx         # 登录组件
│   │   ├── FileManager.tsx   # 文件管理器组件（含预览功能）
│   │   ├── webtty.tsx        # WebSocket终端
│   │   └── xterm.tsx         # xterm封装
│   ├── package.json    # 前端依赖
│   └── webpack.config.js # Webpack配置
├── resources/          # 静态资源
│   ├── index.html
│   ├── index.css       # 全局样式
│   ├── login.css       # 登录界面样式
│   ├── filemanager.css # 文件管理器样式（含预览）
│   └── xterm_customize.css # 终端自定义样式
└── bindata/            # 编译后的静态资源
```

### 前端开发

```bash
cd js

# 安装依赖
npm install

# 开发模式（带source map）
DEV=1 make

# 生产构建
make
```

前端使用：
- **TypeScript** - 类型安全
- **Preact** - 轻量级React替代
- **Webpack 5** - 模块打包
- **xterm.js** - 终端模拟器
- **highlight.js** - 代码语法高亮
- **marked** - Markdown渲染
- **xlsx** - Excel文件解析
- **mammoth** - Word文档解析
- **papaparse** - CSV文件解析
- **pdfjs-dist** - PDF文件渲染

### 后端开发

```bash
# 运行测试
go test ./...

# 格式化代码
go fmt ./...

# 静态检查
go vet ./...
```

### 构建说明

项目采用多阶段构建：

1. **前端构建** - Webpack打包JS/CSS资源
2. **资源嵌入** - 将静态资源嵌入到Go二进制文件
3. **Go编译** - 编译最终可执行文件

## 更新日志

### v2.0.0 - 文件管理增强版

#### 文件预览功能
- **代码高亮** - 30+种编程语言语法高亮（GitHub Dark主题）
- **图片预览** - 支持JPG/PNG/GIF/SVG/WebP等格式
- **视频播放** - 支持MP4/WebM/OGG等格式在线播放
- **文档预览** - 支持Markdown/HTML/CSV/Excel/Word/PDF
- **PDF预览** - 使用PDF.js渲染，支持页面导航（上一页/下一页）
- **一键复制** - 代码和CSV内容快速复制到剪贴板
- **全屏模式** - 所有预览都支持全屏查看

#### 文件操作增强
- **批量上传** - 单个或批量文件上传，带进度条
- **文件夹上传** - 保留完整目录结构
- **分片上传** - 大文件（>10MB）自动分片上传
- **批量删除** - 多选文件批量删除
- **批量下载** - 多选文件打包ZIP下载
- **自定义对话框** - 深色主题确认对话框，替代浏览器默认提示

#### UI/UX改进
- 统一滚动条样式（深色主题）
- 预览窗口最大化（95%宽度，1400px最大宽度）
- 进度条动画效果（渐变+shimmer）
- 复制成功视觉反馈（绿色对勾）
- 文件类型图标区分

### v1.0.0 - 基础版本

- 自定义深色主题登录界面
- 基础文件管理器（上传/下载/删除/浏览）
- 文件夹递归导航
- 可拖拽文件管理按钮（四边吸附）
- 自定义主题删除确认对话框
- WebSocket认证支持
- 生产构建自动移除console日志
- Docker容器化支持
- 完整中文配置注释

## 安全建议

1. **使用HTTPS** - 生产环境启用TLS加密
2. **强密码** - 设置复杂的认证凭据
3. **防火墙** - 限制访问来源IP
4. **反向代理** - 使用Nginx等反向代理
5. **定期更新** - 保持依赖和系统更新

示例Nginx配置：

```nginx
server {
    listen 443 ssl;
    server_name your-domain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## 贡献

欢迎提交Issue和Pull Request！

## 许可证

本项目基于MIT许可证开源。

## 致谢

本项目基于以下项目：

- [yudai/gotty](https://github.com/yudai/gotty) - 原始GoTTY项目
- [sorenisanerd/gotty](https://github.com/sorenisanerd/gotty) - 维护版本
- [xterm.js](https://github.com/xtermjs/xterm.js) - 终端模拟器
- [Preact](https://preactjs.com/) - UI框架

## 联系方式

如有问题或建议，请提交Issue。