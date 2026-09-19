#!/bin/sh
# Compatibility wrapper; the implementation is cross-platform Node.js.
set -eu
node "$(dirname "$0")/build-host.mjs"
