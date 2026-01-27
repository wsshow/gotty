# 第一阶段：构建前端资源
FROM node:22-alpine as js-build

WORKDIR /build

# 复制前端相关文件
COPY js/package.json js/package-lock.json* ./js/
RUN cd js && npm ci --production=false

COPY js ./js
COPY resources ./resources
COPY Makefile ./

# 构建前端资源
RUN make assets

# 第二阶段：构建Go应用
FROM golang:1.23-alpine as go-build

WORKDIR /build

# 安装构建依赖
RUN apk add --no-cache git make

# 复制Go模块文件并下载依赖
COPY go.mod go.sum ./
RUN go mod download

# 复制源代码
COPY . .

# 从前端构建阶段复制资源
COPY --from=js-build /build/bindata ./bindata

# 构建Go应用
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -trimpath -ldflags="-s -w" -o gotty main.go

# 第三阶段：最终运行镜像
FROM alpine:latest

LABEL maintainer="GoTTY" \
      description="Share your terminal as a web application"

# 安装运行时依赖
RUN apk update && \
    apk upgrade && \
    apk add --no-cache ca-certificates bash tzdata && \
    rm -rf /var/cache/apk/*

# 创建非root用户
RUN addgroup -g 1000 gotty && \
    adduser -D -u 1000 -G gotty gotty

WORKDIR /app

# 从构建阶段复制二进制文件
COPY --from=go-build /build/gotty /usr/local/bin/gotty
RUN chmod +x /usr/local/bin/gotty

# 创建必要的目录
RUN mkdir -p /app/uploads && \
    chown -R gotty:gotty /app

# 切换到非root用户
USER gotty

# 暴露端口
EXPOSE 8080

# 健康检查
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ || exit 1

# 默认命令
CMD ["gotty", "--port", "8080", "--permit-write", "bash"]
