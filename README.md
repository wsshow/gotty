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
- **身份认证** - 支持基本认证与自定义登录界面
- **文件管理** - 上传/下载/删除/批量操作，支持文件夹上传
- **文件预览** - 代码高亮、图片/视频、Markdown/HTML/CSV/Excel/Word/PDF
- **PDF预览** - 缩略图网格与单页查看
- **快速复制** - 代码与CSV一键复制
- **现代UI** - 基于xterm.js的深色主题界面
- **安全** - TLS/SSL加密连接支持
- **响应式** - 支持移动端访问
- **可拖拽** - 文件管理按钮支持拖拽和边缘吸附

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

| 参数 | 说明 | 默认值 |
| --- | --- | --- |
| `-a, --address` | 监听地址 | `0.0.0.0` |
| `-p, --port` | 监听端口 | `8080` |
| `-m, --path` | 访问路径前缀 | `/` |
| `-w, --permit-write` | 允许客户端写入 | `false` |
| `--config` | 配置文件路径 | `~/.gotty` |
| `-c, --credential` | Basic Auth 凭据（user:pass） | `""` |
| `-r, --random-url` | 启用随机URL | `false` |
| `--random-url-length` | 随机URL长度 | `8` |
| `-t, --tls` | 启用TLS/SSL | `false` |
| `--tls-crt` | TLS证书路径 | `~/.gotty.crt` |
| `--tls-key` | TLS密钥路径 | `~/.gotty.key` |
| `--tls-ca-crt` | 客户端认证CA证书 | `~/.gotty.ca.crt` |
| `--index` | 自定义 index.html | `""` |
| `--title-format` | 浏览器标题模板 | `{{ .command }}@{{ .hostname }}` |
| `--reconnect` | 启用自动重连 | `false` |
| `--reconnect-time` | 重连间隔（秒） | `10` |
| `--max-connection` | 最大连接数 | `0` |
| `--once` | 仅接受一个客户端 | `false` |
| `--timeout` | 等待连接超时（秒） | `0` |
| `--permit-arguments` | 允许URL参数传递命令行参数 | `false` |
| `--pass-headers` | 透传请求头为环境变量 | `false` |
| `--width` | 固定终端宽度 | `0` |
| `--height` | 固定终端高度 | `0` |
| `--ws-origin` | WebSocket Origin 正则 | `""` |
| `--ws-query-args` | WebSocket 追加参数 | `""` |
| `--enable-webgl` | 启用WebGL渲染 | `true` |
| `--quiet` | 禁止日志输出 | `false` |

## 功能说明

### 1. 终端访问

- 支持通过浏览器访问终端，基于 xterm.js
- 复制/粘贴支持，自适应窗口大小
- 256 色与 UTF-8 支持

### 2. 安全与认证

- Basic Auth 支持，可启用自定义登录界面
- TLS/SSL 加密连接

### 3. 文件管理与预览

- 上传/下载/删除/批量操作，支持文件夹上传与分片上传
- 缩略图预览与单页查看 PDF
- 多格式预览：代码、图片、视频、Markdown、HTML、CSV、Excel、Word
- 快捷操作：复制内容、全屏、点击空白关闭

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
