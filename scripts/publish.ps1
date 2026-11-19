#Requires -Version 5.1
<#
  发布脚本：git add / commit / push，由仓库根目录的 .bat 双击入口调用。
  本文件必须保存为 UTF-8 with BOM，否则 Windows PowerShell 5.1 会按代码页读取中文。
  .bat 入口保持纯 ASCII + CRLF，中文提示统一放在这里，避免 cmd 按代码页解析批处理时出错。
#>
[CmdletBinding()]
param(
    [string]$Message,
    [switch]$Quick,
    [switch]$Watch,
    [int]$IntervalSeconds = 30,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$exitCode = 0

function Test-Repo {
    git rev-parse --is-inside-work-tree *> $null
    if ($LASTEXITCODE -ne 0) { throw '当前目录不是 Git 仓库。' }

    git rev-parse --abbrev-ref --symbolic-full-name '@{u}' *> $null
    if ($LASTEXITCODE -ne 0) { throw '当前分支没有上游分支，请先执行 git push -u origin <分支名>。' }
}

function Invoke-Publish {
    param([string]$CommitMessage)

    git add -A
    if ($LASTEXITCODE -ne 0) { throw 'git add 失败。' }

    $staged = @(git diff --cached --name-only)
    if ($staged.Count -eq 0) { return $false }

    if (-not $CommitMessage) {
        $CommitMessage = '发布文章 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    }

    git commit -m $CommitMessage
    if ($LASTEXITCODE -ne 0) { throw 'git commit 失败。' }

    git push
    if ($LASTEXITCODE -ne 0) { throw 'git push 失败，请检查远程仓库、分支和网络。' }

    Write-Host ('已推送：' + $CommitMessage) -ForegroundColor Green
    return $true
}

if ($Quick) {
    if (-not $Message) { $Message = '更新内容' }
    $NoPause = $true
}

Push-Location $repoRoot
try {
    Test-Repo

    if ($Watch) {
        Write-Host '启动自动发布监视，按 Ctrl+C 停止。'
        while ($true) {
            try {
                $null = Invoke-Publish -CommitMessage ('自动发布 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
            } catch {
                Write-Host ('发布失败：' + $_.Exception.Message) -ForegroundColor Red
            }
            Start-Sleep -Seconds $IntervalSeconds
        }
    }

    Write-Host '正在发布文章到 GitHub...'
    if (Invoke-Publish -CommitMessage $Message) {
        Write-Host '发布完成！GitHub Actions 将自动构建和部署网站。'
        Write-Host '请稍等片刻后访问 https://honors123456.github.io'
    } else {
        Write-Host '没有需要提交的更改。' -ForegroundColor Yellow
    }
} catch {
    Write-Host ''
    Write-Host ('发布失败：' + $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
} finally {
    Pop-Location
}

if (-not $Watch -and -not $NoPause) {
    $null = Read-Host '按 Enter 键关闭窗口'
}
exit $exitCode