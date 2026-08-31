<#
.SYNOPSIS
    Pi Web X 一键安装脚本（Windows PowerShell）

.DESCRIPTION
    自动探测 Windows x64/arm64 架构，从 GitHub Releases 下载对应的最新
    pi-web-x.exe，校验 SHA256SUMS 后安装到用户目录，并注册到用户级 PATH。

.PARAMETER Dir
    安装目录（默认 $HOME\pi-web-x：真实二进制与内置资产同目录）。

.PARAMETER Version
    指定版本（如 v0.9.0）；缺省时跟随 GitHub latest 重定向。

.PARAMETER Force
    已安装同版本时强制重装。

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File install.ps1
    # 或一行式:
    irm https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.ps1 | iex
#>
[CmdletBinding()]
param(
    [string]$Dir,
    [string]$Version,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$Repo = "xiaojueshi/pi-web-x"
$BaseUrl = "https://github.com/$Repo"

if ([string]::IsNullOrWhiteSpace($Dir)) {
    $Dir = Join-Path $HOME "pi-web-x"
}
$InstallDir = [System.IO.Path]::GetFullPath($Dir)
$Exe = Join-Path $InstallDir "pi-web-x.exe"

# ---------------------------------------------------------------------------
# 架构探测：AMD64 → x64，ARM64 → arm64
# ---------------------------------------------------------------------------
$Arch = switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { "x64" }
    "ARM64" { "arm64" }
    default { throw "Unsupported architecture: $($env:PROCESSOR_ARCHITECTURE)" }
}
$Asset = "pi-web-x-windows-$Arch.exe"

# ---------------------------------------------------------------------------
# 解析目标版本（VERSION 为空时用 latest 重定向的 tag 只做展示/对比）
# ---------------------------------------------------------------------------
$ResolvedVersion = $Version
if ([string]::IsNullOrWhiteSpace($ResolvedVersion)) {
    try {
        $Response = Invoke-WebRequest -Uri "$BaseUrl/releases/latest" -Method Head -MaximumRedirection 0 -ErrorAction SilentlyContinue
        $Location = $Response.Headers.Location
        if ($Location -match "releases/tag/(.+)$") {
            $ResolvedVersion = $Matches[1]
        }
    } catch {
        # HEAD 跟随不了重定向时保持 latest（下载阶段仍用 latest 入口），不阻断
    }
}
$TargetLabel = if ($ResolvedVersion) { $ResolvedVersion } else { "latest" }

# ---------------------------------------------------------------------------
# 幂等：已装同版本且未 --Force 时跳过；否则提示
# ---------------------------------------------------------------------------
$InstalledVersion = $null
if (-not $Force -and (Test-Path $Exe)) {
    try {
        $InstalledVersion = (& $Exe --version).Trim()
    } catch {
        $InstalledVersion = $null
    }
    # --version 输出无 v 前缀，tag 有 v 前缀，对比前统一去掉，保证幂等判断可靠
    $InstalledNorm = ($InstalledVersion -replace "^v", "")
    $ResolvedNorm = ($ResolvedVersion -replace "^v", "")
    if ($ResolvedNorm -and $InstalledNorm -eq $ResolvedNorm) {
        Write-Host "pi-web-x $InstalledNorm is already installed at $Exe. Use -Force to reinstall."
        exit 0
    }
    if (-not $Version) {
        Write-Host "Found installed pi-web-x $InstalledVersion; installing $TargetLabel…"
    }
}

Write-Host "Installing pi-web-x $TargetLabel ($Asset) → $InstallDir"

$DownloadBase = if ($ResolvedVersion) {
    "$BaseUrl/releases/download/$ResolvedVersion"
} else {
    "$BaseUrl/releases/latest/download"
}

# ---------------------------------------------------------------------------
# 下载 + SHA256 校验（.exe 与 SHA256SUMS 都在同一 release）
# ---------------------------------------------------------------------------
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "pi-web-x-install"
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$ExePath = Join-Path $TempDir "pi-web-x.exe"
$SumPath = Join-Path $TempDir "SHA256SUMS"

Write-Host "Downloading $DownloadBase/$Asset…"
Invoke-WebRequest -Uri "$DownloadBase/$Asset" -OutFile $ExePath
Invoke-WebRequest -Uri "$DownloadBase/SHA256SUMS" -OutFile $SumPath

$ExpectedLine = Get-Content $SumPath | Where-Object { $_ -match "\s$([regex]::Escape($Asset))$" } | Select-Object -First 1
$Expected = if ($ExpectedLine) { ($ExpectedLine -split "\s+")[0].ToLower() } else { $null }

$Actual = (Get-FileHash -Path $ExePath -Algorithm SHA256).Hash.ToLower()
if ($null -eq $Expected) {
    throw "Checksum entry missing for $Asset; refusing an unverified install."
} elseif ($Expected -ne $Actual) {
    throw "Checksum mismatch for $Asset. Expected $Expected, got $Actual. Aborting."
} else {
    Write-Host "Checksum verified ($Actual)"
}

# ---------------------------------------------------------------------------
# 落盘 + 用户级 PATH 注册
# ---------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Move-Item -Force $ExePath $Exe
Write-Host "Installed pi-web-x $TargetLabel to $Exe"

$UserPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
$Token = $InstallDir
if ($UserPath -and $UserPath.Split(";") -contains $Token) {
    Write-Host "$InstallDir is already on the user PATH."
} else {
    # 方法实参位置不能直接嵌 if 表达式，先算出新值再传入
    $NewPath = if ($UserPath) { "$InstallDir;$UserPath" } else { $InstallDir }
    [System.Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    Write-Host "Added $InstallDir to your user PATH. Open a NEW terminal to use 'pi-web-x'."
}

Write-Host "Run 'pi-web-x --help' to get started, or just 'pi-web-x' to open the UI."
Write-Host "首次启动会自动获取内置资产（主题等）；内网离线请先获取 pi-web-x-assets 压缩包，再执行: pi-web-x assets install <包路径>"