#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# TSG Suite – broadcast tools for alignment, metering, and signal verification
# Maintained by David Thåst  ·  https://github.com/FiLORUX
#
# Built with the assumption that behaviour should be predictable,
# output should be verifiable, and silence should mean silence
#
# david@thast.se  ·  +46 700 30 30 60
# ═══════════════════════════════════════════════════════════════════════════════

# ═══════════════════════════════════════════════════════════════════════════════
# CHROME LAUNCHER (macOS)
# ═══════════════════════════════════════════════════════════════════════════════
# Opens Chrome with --allow-file-access-from-files flag for ES module support
# on file:// protocol.
#
# Security note: This flag allows ALL local files to access other local files.
# Only use in trusted environments. Close Chrome when finished.
# ═══════════════════════════════════════════════════════════════════════════════

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
INDEX_FILE="$PROJECT_DIR/index.html"

echo "Launching Chrome with file:// access enabled..."
echo "Opening: $INDEX_FILE"
echo ""
echo "⚠️  Security note: Close this Chrome window when finished."
echo ""

# Launch Chrome directly with the flag and file URL
# (using open -a with --args doesn't work if Chrome is already running)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --allow-file-access-from-files \
    "file://$INDEX_FILE" &
