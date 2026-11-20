#Requires -Version 5.1
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$exitCode = 0

function Assert-GitCommand {
    param([string]$Action)
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: $Action"
    }
}

Push-Location $repoRoot
try {
    git rev-parse --is-inside-work-tree *> $null
    Assert-GitCommand 'repository check'

    $branch = (git branch --show-current).Trim()
    Assert-GitCommand 'current branch check'
    if (-not $branch) {
        throw 'Cannot publish from a detached HEAD.'
    }

    Write-Host 'Publishing to GitHub...'
    git add -A
    Assert-GitCommand 'git add'

    $staged = @(git diff --cached --name-only)
    Assert-GitCommand 'staged change check'
    if ($staged.Count -eq 0) {
        Write-Host 'No changes to publish.' -ForegroundColor Yellow
    } else {
        $message = 'Publish ' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')
        git commit -m $message
        Assert-GitCommand 'git commit'

        git rev-parse --abbrev-ref --symbolic-full-name '@{u}' *> $null
        if ($LASTEXITCODE -eq 0) {
            git push
        } else {
            git push --set-upstream origin $branch
        }
        Assert-GitCommand 'git push'

        Write-Host ('Pushed: ' + $message) -ForegroundColor Green
        Write-Host 'GitHub Actions will build and deploy the site.'
    }
} catch {
    Write-Host ''
    Write-Host ('Publish failed: ' + $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
} finally {
    Pop-Location
}

exit $exitCode
