# Native Windows entry point for the Git Bash installer. Python and Git for
# Windows are prerequisites; this script never installs or upgrades them.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$ReaDirectory
)

$ErrorActionPreference = 'Stop'
$reaPath = (Resolve-Path -LiteralPath $ReaDirectory).Path
$installerPath = Join-Path $PSScriptRoot 'install.sh'
$gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
$bashCandidates = @(
    $(if ($gitCommand) { Join-Path (Split-Path (Split-Path $gitCommand.Source -Parent) -Parent) 'bin\bash.exe' }),
    (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Git\bin\bash.exe' }),
    (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
)
$bashPath = $bashCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Leaf) } | Select-Object -First 1
if (-not $bashPath) {
    throw 'Git for Windows bash.exe was not found. Add git.exe to PATH or run install.sh from Git Bash.'
}

# Forward-slash drive paths are understood by Git Bash and avoid shell quoting.
& $bashPath ($installerPath.Replace('\', '/')) ($reaPath.Replace('\', '/'))
if ($LASTEXITCODE -ne 0) {
    throw "REA Windows installation failed with exit code $LASTEXITCODE."
}
