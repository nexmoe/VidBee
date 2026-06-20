#!/bin/bash
set -e

# GitHub issue #378: Electron's SUID sandbox helper must be owned by root and
# carry the setuid bit (mode 4755), otherwise the app aborts on launch with
# "The SUID sandbox helper binary was found, but is not configured correctly."
# electron-builder does not reliably set this for .deb installs, so fix it here
# in the Debian postinst maintainer script. productName is "VidBee", so the
# install prefix is /opt/VidBee.
SANDBOX="/opt/VidBee/chrome-sandbox"
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX"
  chmod 4755 "$SANDBOX"
fi

exit 0
