Name = gotty
Version = 0.0.1
BuildTime = $(shell date +'%Y-%m-%d %H:%M:%S')

# 提取当前系统的 OS 和 ARCH
CURRENT_OS = $(shell go env GOOS)
CURRENT_ARCH = $(shell go env GOARCH)

LDFlags = -ldflags "-s -w -X '${Name}/version.version=$(Version)' -X '${Name}/version.buildTime=${BuildTime}'"

# 默认全量编译的目标列表
targets ?= darwin:arm64 windows:amd64 linux:amd64

# release 输出目录
BUILDS_PKG_DIR = builds/pkg
BUILDS_DIST_DIR = builds/dist

# 前端编译模式
ifeq ($(DEV), 1)
	WEBPACK_MODE = development
else
	WEBPACK_MODE = production
endif

.DEFAULT_GOAL := native

# 1. 原生系统编译：强制指定输出格式为 gotty_os_arch
native: assets
	@$(MAKE) build t="$(CURRENT_OS):$(CURRENT_ARCH)"

# 2. 编译所有预设平台
all: assets
	@$(MAKE) build t="$(targets)"

# 3. 核心编译逻辑
build:
	@if [ -z "$(t)" ]; then \
		echo "错误: 请指定目标，例如 make build t=linux:amd64"; \
		exit 1; \
	fi
	@$(foreach n, $(t),\
		os=$$(echo "$(n)" | cut -d : -f 1);\
		arch=$$(echo "$(n)" | cut -d : -f 2);\
		suffix=""; \
		if [ "$${os}" = "windows" ]; then suffix=".exe"; fi; \
		output_name="./release/${Name}_$${os}_$${arch}$${suffix}"; \
		echo "正在编译: $${os}/$${arch}..."; \
		env CGO_ENABLED=0 GOOS=$${os} GOARCH=$${arch} go build -trimpath $(LDFlags) -o $${output_name} ./main.go;\
		echo "编译完成: $${output_name}";\
	)

# release-artifacts: 为 GitHub Actions 准备发布产物
.PHONY: release-artifacts
release-artifacts: assets
	@echo "开始构建发布产物..."
	@rm -rf $(BUILDS_PKG_DIR) $(BUILDS_DIST_DIR)
	@mkdir -p $(BUILDS_PKG_DIR) $(BUILDS_DIST_DIR)
	@$(foreach n, $(targets),\
		os=$$(echo "$(n)" | cut -d : -f 1);\
		arch=$$(echo "$(n)" | cut -d : -f 2);\
		suffix=""; \
		if [ "$${os}" = "windows" ]; then suffix=".exe"; fi; \
		pkg_dir="$(BUILDS_PKG_DIR)/${Name}_$${os}_$${arch}"; \
		binary_name="${Name}$${suffix}"; \
		output_name="$${pkg_dir}/$${binary_name}"; \
		dist_name="$(BUILDS_DIST_DIR)/${Name}_$${os}_$${arch}.tar.gz"; \
		echo "正在编译: $${os}/$${arch}..."; \
		mkdir -p "$${pkg_dir}"; \
		env CGO_ENABLED=0 GOOS=$${os} GOARCH=$${arch} go build -trimpath $(LDFlags) -o "$${output_name}" ./main.go; \
		echo "打包: $${dist_name}"; \
		tar -czf "$${dist_name}" -C "$${pkg_dir}" "$${binary_name}"; \
		echo "完成: $${dist_name}";\
	)
	@echo "所有发布产物已准备完成"

# test: 运行测试
.PHONY: test
test:
	@echo "运行测试..."
	go test -v ./...

# tools: 安装必要的工具
.PHONY: tools
tools:
	@echo "检查工具依赖..."
	@which go > /dev/null || (echo "错误: 未找到 go" && exit 1)
	@which npm > /dev/null || (echo "错误: 未找到 npm" && exit 1)
	@echo "所有工具依赖已就绪"

# 前端资源打包
.PHONY: assets
assets: bindata/static/js/gotty.js.map \
	bindata/static/js/gotty.js \
	bindata/static/index.html \
	bindata/static/icon.svg \
	bindata/static/favicon.ico \
	bindata/static/css/index.css \
	bindata/static/css/xterm.css \
	bindata/static/css/xterm_customize.css \
	bindata/static/css/filemanager.css \
	bindata/static/manifest.json \
	bindata/static/icon_192.png

bindata/static bindata/static/css bindata/static/js:
	mkdir -p $@

bindata/static/%: resources/% | bindata/static/css
	cp "$<" "$@"

bindata/static/css/%.css: resources/%.css | bindata/static
	cp "$<" "$@"

bindata/static/css/xterm.css: js/node_modules/@xterm/xterm/css/xterm.css | bindata/static
	cp "$<" "$@"

js/node_modules/@xterm/xterm/css/xterm.css:
	cd js && npm install

bindata/static/js/gotty.js.map bindata/static/js/gotty.js: js/src/* | js/node_modules/webpack
	cd js && npx webpack --mode=$(WEBPACK_MODE)

js/node_modules/webpack:
	cd js && npm install

clean:
	rm -rf ./release bindata/static js/dist js/node_modules $(BUILDS_PKG_DIR) $(BUILDS_DIST_DIR)

.PHONY: native all build clean assets test tools release-artifacts
