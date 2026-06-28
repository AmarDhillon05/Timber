# Windows (electron) — run the app as a desktop window with system-audio
# loopback capture. Builds the web export, then launches the Electron shell.
# Must run on the WINDOWS host (PowerShell), NOT inside WSL, so it can capture
# Windows system audio and show a real window.
#
# Usage:
#   ./run-win-electron.ps1            # build + run packaged web export
#   ./run-win-electron.ps1 -Dev       # attach Electron to a running `npm run win:web`
param([switch]$Dev)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

if ($Dev) {
  # Expects `npm run win:web` already running on http://localhost:8081.
  npm run win:electron:dev
} else {
  npm run win:electron
}
