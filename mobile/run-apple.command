#!/usr/bin/env bash
# Apple — run the native iOS app via Expo (Simulator or a connected iPhone).
# Run on macOS (double-click in Finder, or `./run-apple.command`).
# Note: iOS cannot capture system audio (Apple blocks it); the iOS build uses
# its own music source, not the Windows/Electron loopback path.
set -euo pipefail
cd "$(dirname "$0")"
npm run apple
