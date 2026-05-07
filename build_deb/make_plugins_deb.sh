#!/bin/bash
set -e

# Get package information
PACKAGE_JSON="../package.json"
PKG_VERSION=$(jq -r .version $PACKAGE_JSON)
PKG_NAME="nest-plugins"
PKG_ARCH="all"
MAINTAINER=$(jq -r .author $PACKAGE_JSON)
DESC="Plugin collection for the nest monitoring application"

BUILD_DIR="./nest-plugins-deb"
PLUGINS_SRC="../plugins"
BUILD_DEB="nest-plugins-deb.deb"

# Plugin files to package (source .ts files)
PLUGIN_FILES=(
    check_debian_eol.ts
    check_nextcloud_serverinfo.ts
)

# Validate sources
for f in "${PLUGIN_FILES[@]}"; do
    if [ ! -f "$PLUGINS_SRC/$f" ]; then
        echo "Plugin source not found: $PLUGINS_SRC/$f" >&2
        exit 1
    fi
done

# Cleanup
rm -rf "$BUILD_DIR"
rm -rf "$BUILD_DEB"
mkdir -p "$BUILD_DIR/DEBIAN"
mkdir -p "$BUILD_DIR/usr/share/nest-plugins"

# Stage plugin files
for f in "${PLUGIN_FILES[@]}"; do
    cp "$PLUGINS_SRC/$f" "$BUILD_DIR/usr/share/nest-plugins/$f"
done

# Copy maintainer scripts
cp plugins-postinst "$BUILD_DIR/DEBIAN/postinst"
cp plugins-postrm   "$BUILD_DIR/DEBIAN/postrm"

# Set permissions
chmod 755 "$BUILD_DIR/DEBIAN/postinst"
chmod 755 "$BUILD_DIR/DEBIAN/postrm"
chmod 644 "$BUILD_DIR/usr/share/nest-plugins/"*.ts

# Create control file
# Depends on the main nest package to ensure /etc/nest/nest.conf is present.
cat > "$BUILD_DIR/DEBIAN/control" <<EOF
Package: $PKG_NAME
Version: $PKG_VERSION
Section: base
Priority: optional
Installed-Size: $(du -s "$BUILD_DIR" | awk '{print $1}')
Architecture: $PKG_ARCH
Depends: nest (= $PKG_VERSION)
Maintainer: $MAINTAINER
Description: $DESC
EOF

# Build package
dpkg-deb --build --root-owner-group "$BUILD_DIR"

echo "Package built: $(pwd)/$BUILD_DEB"

# Cleanup
rm -rf "$BUILD_DIR"
