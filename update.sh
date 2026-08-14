#!/bin/bash
# TomiLite OTA Update Script
# Downloads the latest release and replaces the current installation.

set -e

REPO="tomatohub/tomilite"
INSTALL_DIR="$(cd "$(dirname "$0")" && pwd)"
TEMP_DIR="/tmp/tomilite-update"

echo "TomiLite OTA Updater"
echo "   Checking for latest version..."

# Fetch latest release info
LATEST=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" \
  -H "User-Agent: TomiLite" \
  -H "Accept: application/vnd.github+json")

VERSION=$(echo "$LATEST" | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": "\(.*\)".*/\1/')
DOWNLOAD_URL=$(echo "$LATEST" | grep '"browser_download_url"' | head -1 | sed 's/.*"browser_download_url": "\(.*\)".*/\1/')

if [ -z "$DOWNLOAD_URL" ]; then
  echo "   ❌ Could not find download URL in latest release."
  exit 1
fi

echo "   Latest version: $VERSION"
echo "   Downloading: $DOWNLOAD_URL"

# Download
mkdir -p "$TEMP_DIR"
cd "$TEMP_DIR"

curl -L -o update.zip "$DOWNLOAD_URL"
echo "   ✅ Downloaded."

# Stop running services
echo "   Stopping TomiLite..."
pkill -f "tomilite" 2>/dev/null || true
sleep 2

# Backup current version
BACKUP_DIR="$INSTALL_DIR/.backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
echo "   Backup → $BACKUP_DIR"
cp -r "$INSTALL_DIR"/* "$BACKUP_DIR/" 2>/dev/null || true

# Extract update
echo "   Installing update..."
unzip -o update.zip -d "$INSTALL_DIR" > /dev/null

# Reinstall dependencies
cd "$INSTALL_DIR"
npm install --production 2>&1 | tail -3

# Restart
echo "   Starting TomiLite v$VERSION..."
bash start.sh > /dev/null 2>&1 &

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "   TomiLite updated to $VERSION!"
echo "   Open http://localhost:3002"
