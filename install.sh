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
#   4. chmod +x 后安装到 ~/.pi-web-x（可 -D 覆盖），并在 ~/.local/bin 建立
#      命令入口符号链接（真实二进制与内置资产同目录，供启动时自举）
#   5. 已安装且为最新版本时跳过（幂等），--force 强制重装
#
# 设计约束: 全部 POSIX sh（无 bash 特性），set -eu 出错即停；
#   curl 失败 / 校验失败 / 平台不支持都会以非零码退出。

set -eu

# 仓库常量（写入 README 与 release notes 时同步修改）
REPO="xiaojueshi/pi-web-x"
BASE_URL="https://github.com/${REPO}"
RAW_BASE="https://raw.githubusercontent.com/${REPO}/main"

# 默认安装目录（真实安装根：二进制与内置资产同目录）；可用 --dir 覆盖。
# 默认使用点前缀目录（ADR 0006）；旧的无点 ~/pi-web-x 会在安装时自动迁移。
INSTALL_DIR="${PI_WEB_X_INSTALL_DIR:-$HOME/.pi-web-x}"
# 命令入口目录（PATH 内），仅存放指向真实二进制的符号链接
BIN_DIR="${PI_WEB_X_BIN_DIR:-$HOME/.local/bin}"
VERSION="" # 空 = latest；可传 v0.x.y
FORCE=""

usage() {
  cat <<EOF
Usage: sh install.sh [options]

Install the latest pi-web-x binary for this platform.

Options:
  -d, --dir <dir>      Install directory (default: \$HOME/.pi-web-x)
  -v, --version <ver>  Install a specific version, e.g. v0.9.0 (default: latest)
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
#
# 进度条策略：interactive 终端用 curl --progress-bar / wget --show-progress
# 实时显示；非交互（CI 日志等）退化为静默下载。下载前先 HEAD 拿文件大小，
# 打印人类可读的预估，避免“静默卡住”的观感。
# ---------------------------------------------------------------------------

# 是否交互式终端（进度条会输出到 stderr，所以只看 stderr 是否 TTY）
IS_TTY=""
[ -t 2 ] && IS_TTY="1"

if command -v curl >/dev/null 2>&1; then
  if [ -n "$IS_TTY" ]; then
    # -f 失败即退出码，-S 出错时显示原因，-L 跟随重定向
    fetch() { curl -fSL --retry 3 --progress-bar \
      --connect-timeout 15 --max-time 900 "$1" -o "$2"; }
  else
    fetch() { curl -fsSL --retry 3 \
      --connect-timeout 15 --max-time 900 "$1" -o "$2"; }
  fi
  # -I -L：HEAD 需跟随 302（GitHub 资产先重定向到 CDN）才能拿到真实大小
  fetch_headers() { curl -fsSIL --connect-timeout 15 "$1"; }
elif command -v wget >/dev/null 2>&1; then
  if [ -n "$IS_TTY" ]; then
    # -q --show-progress：静默日志但保留进度条
    fetch() { wget -q --show-progress --timeout=15 "$1" -O "$2"; }
  else
    fetch() { wget -q -O "$2" "$1"; }
  fi
  fetch_headers() { wget -S -O /dev/null "$1" 2>&1; }
else
  echo "Neither curl nor wget found. Install one of them and retry." >&2
  exit 1
fi

# 返回 URL 对应资源的大小（字节）；拿不到时为空
fetch_size() {
  fetch_headers "$1" 2>/dev/null | tr -d '\r' |
    sed -n 's/^[Cc]ontent-[Ll]ength: *//p' | tail -1
}

# 人类可读大小（1024 进制）
human_size() {
  awk -v bytes="$1" 'BEGIN {
    if (bytes >= 1073741824) printf "%.1f GB", bytes / 1073741824;
    else if (bytes >= 1048576) printf "%.1f MB", bytes / 1048576;
    else if (bytes >= 1024) printf "%.1f KB", bytes / 1024;
    else printf "%d B", bytes;
  }'
}

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
  # 重定向目标的 release 页 URL 形如 .../releases/tag/vX.Y.Z → 后续下载
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
    ensure_bin_entry || true
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

ASSET_URL="${DOWNLOAD_BASE}/${ASSET}"

# 先 HEAD 拿预期大小；终端可显示进度条，非交互保持静默。
ASSET_SIZE="$(fetch_size "$ASSET_URL" || true)"
if [ -n "$ASSET_SIZE" ]; then
  printf 'Downloading %s (%s)…\n' "$ASSET" "$(human_size "$ASSET_SIZE")"
else
  echo "Downloading ${ASSET}…"
fi

fetch "$ASSET_URL" "$TMP_DIR/pi-web-x" ||
  {
    echo "Download failed: ${ASSET}" >&2
    echo "Check your network or proxy, then re-run the installer." >&2
    exit 1
  }
echo "Binary downloaded."

echo "Downloading SHA256SUMS…"
fetch "${DOWNLOAD_BASE}/SHA256SUMS" "$TMP_DIR/SHA256SUMS" ||
  {
    echo "Download failed: SHA256SUMS" >&2
    echo "Check your network or proxy, then re-run the installer." >&2
    exit 1
  }
echo "SHA256SUMS downloaded."

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

# 赋权并落盘（真实安装根，内置资产与二进制同目录）
mkdir -p "$INSTALL_DIR"
chmod +x "$TMP_DIR/pi-web-x"
mv "$TMP_DIR/pi-web-x" "$INSTALL_DIR/pi-web-x"
echo "Installed pi-web-x ${TARGET_VERSION_LABEL} to ${INSTALL_DIR}/pi-web-x"

# ---------------------------------------------------------------------------
# 旧安装根迁移（ADR 0006）：默认目录从 ~/pi-web-x 改为 ~/.pi-web-x。
# 仅当用户未用 --dir 覆盖（INSTALL_DIR 仍是默认值）且旧目录存在时执行：
# 整目录搬移（二进制 + 内置资产 + export-html），成功后不保留旧目录。
# ---------------------------------------------------------------------------
LEGACY_INSTALL_DIR="$HOME/pi-web-x"
if [ "$INSTALL_DIR" = "$HOME/.pi-web-x" ] && [ -d "$LEGACY_INSTALL_DIR" ] && [ ! -e "$INSTALL_DIR/pi-web-x" ]; then
  echo "Migrating legacy install directory: ${LEGACY_INSTALL_DIR} → ${INSTALL_DIR}"
  if [ -d "$INSTALL_DIR" ] && [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
    echo "Warning: target ${INSTALL_DIR} is not empty; skipping automatic migration." >&2
    echo "Move ${LEGACY_INSTALL_DIR} manually if needed." >&2
  else
    mkdir -p "$HOME"
    mv "$LEGACY_INSTALL_DIR" "$INSTALL_DIR"
    echo "Migrated existing data to ${INSTALL_DIR}."
  fi
fi

# ---------------------------------------------------------------------------
# 命令入口：$BIN_DIR/pi-web-x 符号链接 → 真实二进制
#
# 旧布局（单文件直接装在 $BIN_DIR）会被自动迁移：实体文件先备份再替换。
# 符号链接让 PATH 目录保持“只放命令”的纯粹性，资产仍随真实二进制旁。
# ---------------------------------------------------------------------------
ensure_bin_entry() {
  mkdir -p "$BIN_DIR"
  if [ -L "$BIN_DIR/pi-web-x" ]; then
    if [ "$(readlink "$BIN_DIR/pi-web-x")" = "$INSTALL_DIR/pi-web-x" ]; then
      return 0
    fi
    rm -f "$BIN_DIR/pi-web-x"
  elif [ -e "$BIN_DIR/pi-web-x" ]; then
    # 旧布局的实体文件：备份（保留 --version 后缀）后再替换，避免误删用户文件
    OLD_VERSION="$("$BIN_DIR/pi-web-x" --version 2>/dev/null || echo legacy)"
    OLD_BACKUP="$BIN_DIR/pi-web-x.old-${OLD_VERSION}"
    mv "$BIN_DIR/pi-web-x" "$OLD_BACKUP"
    echo "Migrated legacy install: ${BIN_DIR}/pi-web-x → ${OLD_BACKUP}"
  fi
  ln -s "$INSTALL_DIR/pi-web-x" "$BIN_DIR/pi-web-x"
  echo "Command entry created: ${BIN_DIR}/pi-web-x → ${INSTALL_DIR}/pi-web-x"
}

ensure_bin_entry

# PATH 提示（针对命令入口目录）
case ":$PATH:" in
*":$BIN_DIR:"*) : ;; # 已在 PATH 中
*)
  echo
  echo "NOTE: ${BIN_DIR} is not on your PATH."
  echo "Add it with:"
  echo "  echo 'export PATH=\"${BIN_DIR}:\$PATH\"' >> ~/.$(basename "$SHELL")rc"
  echo "  export PATH=\"${BIN_DIR}:\$PATH\""
  ;;
esac

echo
echo "Next steps:"
echo "  - Run 'pi-web-x' to start the UI; built-in assets (themes etc.) are"
echo "    fetched automatically on first start (needs network or a mirror)."
echo "  - Fully offline environment: fetch pi-web-x-assets-${TARGET_VERSION_LABEL}.tar.gz"
echo "    and run 'pi-web-x assets install <path>' once (or unpack it next to the binary)."
echo "  - Update anytime with 'pi-web-x update' (or re-run this script)."
echo "Run 'pi-web-x --help' to get started, or just 'pi-web-x' to open the UI."
