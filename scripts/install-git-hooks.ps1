$ErrorActionPreference = 'Stop'

git config core.hooksPath .githooks
if ($LASTEXITCODE -ne 0) {
  throw 'Could not configure the Git hooks path.'
}
Write-Host 'findEmm Git hooks installed. Pre-commit checks now run before every commit.'
