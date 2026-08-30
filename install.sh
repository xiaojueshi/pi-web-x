#!/usr/bin/env sh
#
# Pi Web X 一键安装脚本（POSIX sh，兼容 macOS / Linux / BSD）
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.sh | sh
#   sh install.sh [--dir <目录>] [--version <vX.Y.Z>] [--force]
#
# 行为:
#   1. 自动探测 OS / 架构 / libc（glibc vs musl），对应 GitHub Release 资产
#   2. 默认下载最新版本（releases/latest 重定向，无需 API token）
#   3. 下载 SHA256SUMS 并校验二进制完整性
#   4. chmod +x 后安装到 ~/.local/bin（可 -D 覆盖），并给出 PATH 提示
#   5. 已安装且为最新版本时跳过（幂等），--force 强制重装
#
# 设计约束: 全部 POSIX sh（无 bash 特性），set -eu 出错即停；
#   curl 失败 / 校验失败 / 平台不支持都会以非零码退出。

set -eu

# 仓库常量（写入 README 与 release notes 时同步修改）
REPO="xiaojueshi/pi-web-x"
BASE_URL="https://github.com/${REPO}"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"

# 默认安装目录；可用 --dir 覆盖，尊重用户自定义
INSTALL_DIR="${PI_WEB_X_INSTALL_DIR:-$HOME/.local/bin}"
VERSION=""        # 空 = latest；可传 v0.x.y
FORCE=""

usage() {
  cat <<EOF
Usage: sh install.sh [options]

Install the latest pi-web-x binary for this platform.

Options:
  -d, --dir <dir>      Install directory (default: \$HOME/.local/bin)
  -v, --version <ver>  Install a specific version, e.g. v0.8.11 (default: latest)
  -f, --force          Reinstall even if the same version is already installed
  -n, --dry-run        Probe the platform and print the asset name without downloading
  -h, --help           Show this help
EOF
}

DRY_RUN=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d | --dir)
      INSTALL_DIR="${2:?--dir requires an argument}"
      shift 2
      ;;
    -v | --version)
      VERSION="${2:?--version requires an argument}"
      shift 2
      ;;
    -f | --force)
      FORCE="1"
      shift
      ;;
    -n | --dry-run)
      DRY_RUN="1"
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# 平台探测
# ---------------------------------------------------------------------------

OS="$(uname -s 2>/dev/null || printf 'unknown')"
ARCH="$(uname -m 2>/dev/null || printf 'unknown')"

case "$OS" in
  Darwin) PLATFORM_OS="darwin" ;;
  Linux) PLATFORM_OS="linux" ;;
  *)
    echo "Unsupported OS: $OS (pi-web-x supports macOS and Linux via this script; Windows users run install.ps1 in PowerShell)." >&2
    exit 1
    ;;
esac

case "$ARCH" in
  x86_64 | amd64) PLATFORM_ARCH="x64" ;;
  aarch64 | arm64) PLATFORM_ARCH="arm64" ;;
  *)
    echo "Unsupported architecture: $ARCH (supported: x86_64, aarch64)." >&2
    exit 1
    ;;
esac

ASSET="pi-web-x-${PLATFORM_OS}-${PLATFORM_ARCH}"

# Linux 需要区分 glibc / musl（Alpine 等）。检测优先级:
#   /etc/alpine-release 存在 → musl（最可靠的信号）
#   否则查 ldd 的版本输出
MUSL=""
if [ "$PLATFORM_OS" = "linux" ]; then
  if [ -f /etc/alpine-release ]; then
    MUSL="1"
  elif command -v ldd >/dev/null 2>&1 && ldd --version 2>&1 | grep -qi "musl"; then
    MUSL="1"
  fi
  if [ -n "$MUSL" ]; then
    ASSET="${ASSET}-musl"
  fi
fi

# 探测模式：打印资产名（含 libc 后缀），供用户预览或测试断言
if [ -n "$DRY_RUN" ]; then
  echo "$ASSET"
  exit 0
fi

# ---------------------------------------------------------------------------
# 下载与校验工具
# ---------------------------------------------------------------------------

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 "$1" -o "$2"; }
  fetch_headers() { curl -fsSI --retry 3 "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
  fetch_headers() { wget -S -O /dev/null "$1" 2>&1; }
else
  echo "Neither curl nor wget found. Install one of them and retry." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  hash_file() { sha256sum "$1" | awk '{print $1}'; }
elif command -v shasum >/dev/null 2>&1; then
  hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
else
  echo "No sha256sum / shasum found. Cannot verify the download; aborting." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 解析目标版本（VERSION 为空时跟随 latest 重定向拿真实 tag 用于展示）
# ---------------------------------------------------------------------------

RESOLVED_VERSION="$VERSION"
if [ -z "$RESOLVED_VERSION" ]; then
  # 重定向目标的 release 页 URL 形如 .../releases/tag/v0.8.11 → 后续下载
  # 仍走 releases/latest/download/<asset>（GitHub 自动跟随最新版本），
  # 这里只用于展示/对比已装版本；解析失败不阻断下载。
  REDIRECT="$(fetch_headers "${BASE_URL}/releases/latest" | tr -d '\r' | sed -n 's/^location: //Ip' || true)"
  case "$REDIRECT" in
    *"/releases/tag/"*) RESOLVED_VERSION="${REDIRECT##*/releases/tag/}" ;;
  esac
fi

TARGET_VERSION_LABEL="${RESOLVED_VERSION:-latest}"

# ---------------------------------------------------------------------------
# 已装版本对比（幂等）
# ---------------------------------------------------------------------------

INSTALLED="$INSTALL_DIR/pi-web-x"
if [ -z "$FORCE" ] && [ -x "$INSTALLED" ]; then
  INSTALLED_VERSION="$("$INSTALLED" --version 2>/dev/null || true)"
  # --version 输出无 v 前缀，tag 有 v 前缀，对比前统一去掉，保证幂等判断可靠
  INSTALLED_NORM="${INSTALLED_VERSION#v}"
  RESOLVED_NORM="${RESOLVED_VERSION#v}"
  if [ -n "$RESOLVED_NORM" ] && [ "$INSTALLED_NORM" = "$RESOLVED_NORM" ]; then
    echo "pi-web-x ${INSTALLED_NORM} is already installed at ${INSTALLED}. Use --force to reinstall."
    exit 0
  fi
  [ -z "$VERSION" ] && echo "Found installed pi-web-x ${INSTALLED_VERSION}; installing ${TARGET_VERSION_LABEL}…"
fi

# ---------------------------------------------------------------------------
# 安装
# ---------------------------------------------------------------------------

echo "Installing pi-web-x ${TARGET_VERSION_LABEL} (${ASSET}) → ${INSTALL_DIR}"

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/pi-web-x.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

# 版本固定时用 tagged URL；否则用 latest 重定向
if [ -n "$RESOLVED_VERSION" ]; then
  DOWNLOAD_BASE="${BASE_URL}/releases/download/${RESOLVED_VERSION}"
else
  DOWNLOAD_BASE="${BASE_URL}/releases/latest/download"
fi

echo "Downloading ${DOWNLOAD_BASE}/${ASSET}…"
fetch "${DOWNLOAD_BASE}/${ASSET}" "$TMP_DIR/pi-web-x"
fetch "${DOWNLOAD_BASE}/SHA256SUMS" "$TMP_DIR/SHA256SUMS"

# 校验：SHA256SUMS 中查找对应资产行，比对实际哈希
EXPECTED="$(grep " ${ASSET}$" "$TMP_DIR/SHA256SUMS" | awk '{print $1}' || true)"
ACTUAL="$(hash_file "$TMP_DIR/pi-web-x")"
if [ -z "$EXPECTED" ]; then
  echo "WARNING: ${ASSET} not listed in SHA256SUMS; skipping checksum verification." >&2
elif [ "$EXPECTED" != "$ACTUAL" ]; then
  echo "Checksum mismatch for ${ASSET}." >&2
  echo "  expected: ${EXPECTED}" >&2
  echo "  actual:   ${ACTUAL}" >&2
  echo "Download may be corrupted or tampered. Aborting." >&2
  exit 1
else
  echo "Checksum verified (${ACTUAL})"
fi

# 赋权并落盘
mkdir -p "$INSTALL_DIR"
chmod +x "$TMP_DIR/pi-web-x"
mv "$TMP_DIR/pi-web-x" "$INSTALL_DIR/pi-web-x"
echo "Installed pi-web-x ${TARGET_VERSION_LABEL} to ${INSTALL_DIR}/pi-web-x"

# PATH 提示
case ":$PATH:" in
  *":$INSTALL_DIR:"*) : ;; # 已在 PATH 中
  *)
    echo
    echo "NOTE: ${INSTALL_DIR} is not on your PATH."
    echo "Add it with:"
    echo "  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.$(basename "$SHELL")rc"
    echo "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    ;;
esac

echo
echo "Run 'pi-web-x --help' to get started, or just 'pi-web-x' to open the UI."