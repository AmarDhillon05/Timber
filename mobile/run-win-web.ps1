# Windows (web) — run the app in your browser via the Expo web dev server.
# Usage (Windows PowerShell, from the Windows host — not WSL):
#   ./run-win-web.ps1
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot
npm run win:web
