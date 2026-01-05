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
# CHROME LAUNCHER (Linux)
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

# Try different Chrome executable names (varies by distribution)
if command -v google-chrome &> /dev/null; then
    google-chrome --allow-file-access-from-files "file://$INDEX_FILE" &
elif command -v google-chrome-stable &> /dev/null; then
    google-chrome-stable --allow-file-access-from-files "file://$INDEX_FILE" &
elif command -v chromium &> /dev/null; then
    chromium --allow-file-access-from-files "file://$INDEX_FILE" &
elif command -v chromium-browser &> /dev/null; then
    chromium-browser --allow-file-access-from-files "file://$INDEX_FILE" &
else
    echo "Error: Chrome or Chromium not found in PATH."
    echo "Please install Google Chrome or Chromium, or add it to your PATH."
    exit 1
fi
