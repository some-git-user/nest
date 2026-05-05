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
BUILD_DEB="nest-deb.deb"

if [ ! -f "$BIN_SOURCE" ]; then
  echo "Nest binary not found at $BIN_SOURCE. Build it first!"
  exit 1
fi

# Cleanup
rm -rf "$BUILD_DIR"
rm -rf "$BUILD_DEB"
mkdir -p "$BUILD_DIR/DEBIAN"
mkdir -p "$BUILD_DIR/usr/bin"
mkdir -p "$BUILD_DIR/lib/systemd/system"
mkdir -p "$BUILD_DIR/etc/nest"

# Copy files
cp "$BIN_SOURCE" "$BUILD_DIR/usr/bin/nest"
cp nest.service "$BUILD_DIR/lib/systemd/system/nest.service"
cp postinst "$BUILD_DIR/DEBIAN/postinst"
cp nest.conf "$BUILD_DIR/etc/nest/nest.conf"

# Set permissions
chmod 755 "$BUILD_DIR/DEBIAN/postinst"
chmod 755 "$BUILD_DIR/usr/bin/nest"
chmod 640 "$BUILD_DIR/lib/systemd/system/nest.service"
chmod 600 "$BUILD_DIR/etc/nest/nest.conf"

# Create control file
cat > "$BUILD_DIR/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $PKG_VERSION
Section: base
Priority: optional
Installed-Size: $(du -s "$BUILD_DIR" | awk '{print $1}')
Architecture: $PKG_ARCH
Maintainer: $MAINTAINER
Description: $DESC
EOF

# Mark config files as conffiles so dpkg preserves local changes on upgrade.
cat > "$BUILD_DIR/DEBIAN/conffiles" <<EOF
/etc/nest/nest.conf
EOF

# Sanity-check package metadata so config handling cannot silently regress.
if [ ! -f "$BUILD_DIR/etc/nest/nest.conf" ]; then
  echo "Error: missing packaged config at $BUILD_DIR/etc/nest/nest.conf"
  exit 1
fi

if ! grep -Fxq "/etc/nest/nest.conf" "$BUILD_DIR/DEBIAN/conffiles"; then
  echo "Error: /etc/nest/nest.conf is not declared in DEBIAN/conffiles"
  exit 1
fi

# Build package
dpkg-deb --build --root-owner-group "$BUILD_DIR"

echo "Package built: $(pwd)/$BUILD_DEB"

# Cleanup
rm -rf "$BUILD_DIR"