#Requires -Version 5.1
<#
  由仓库根目录的 publish.bat 调用。
  本文件保存为 UTF-8 with BOM，以兼容 Windows PowerShell 5.1 的中文提示。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot

function Assert-GitCommand {
    param([string]$Action)
    if ($LASTEXITCODE -ne 0) {
        throw "$Action 失败。"
    }
}

Push-Location $repoRoot
try {
    git rev-parse --is-inside-work-tree *> $null
    Assert-GitCommand '当前目录不是 Git 仓库'

    git rev-parse --abbrev-ref --symbolic-full-name '@{u}' *> $null
    if ($LASTEXITCODE -ne 0) {
        throw '当前分支没有上游分支，请先执行 git push -u origin <分支名>。'
    }

    Write-Host '正在发布文章到 GitHub...'
    git add -A
    Assert-GitCommand 'git add'

    $staged = @(git diff --cached --name-only)
    Assert-GitCommand '检查暂存改动'
    if ($staged.Count -eq 0) {
        Write-Host '没有需要提交的更改。' -ForegroundColor Yellow
        exit 0
    }

    $message = '发布文章 ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
    git commit -m $message
    Assert-GitCommand 'git commit'

    git push
    Assert-GitCommand 'git push'

    Write-Host ('已推送：' + $message) -ForegroundColor Green
    Write-Host 'GitHub Actions 将自动构建并部署网站。'
} catch {
    Write-Host ''
    Write-Host ('发布失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
} finally {
    Pop-Location
}
