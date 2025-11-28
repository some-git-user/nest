#!/bin/bash
set -e

# Get package information
PACKAGE_JSON="../package.json"
PKG_NAME=$(jq -r .name $PACKAGE_JSON)
PKG_VERSION=$(jq -r .version $PACKAGE_JSON)
PKG_ARCH="amd64"
MAINTAINER=$(jq -r .author $PACKAGE_JSON)
DESC=$(jq -r .description $PACKAGE_JSON)

BUILD_DIR="./nest-deb"
BIN_SOURCE="../standalone/nest"

if [ ! -f "$BIN_SOURCE" ]; then
  echo "Nest binary not found at $BIN_SOURCE. Build it first!"
  exit 1
fi

# Cleanup
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR/DEBIAN"
mkdir -p "$BUILD_DIR/usr/bin"
mkdir -p "$BUILD_DIR/lib/systemd/system"

# Copy files
cp "$BIN_SOURCE" "$BUILD_DIR/usr/bin/nest"
cp nest.service "$BUILD_DIR/lib/systemd/system/nest.service"
cp postinst "$BUILD_DIR/DEBIAN/postinst"

# Set permissions
chmod 755 "$BUILD_DIR/DEBIAN/postinst"
chmod 755 "$BUILD_DIR/usr/bin/nest"

# Create control file
cat > "$BUILD_DIR/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $PKG_VERSION
Section: base
Priority: optional
Architecture: $PKG_ARCH
Maintainer: $MAINTAINER
Description: $DESC
EOF

# Build package
dpkg-deb --build --root-owner-group "$BUILD_DIR"

echo "Package built: $(pwd)/nest-deb.deb"

# Cleanup
rm -rf "$BUILD_DIR"