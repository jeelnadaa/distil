#!/usr/bin/env sh
# Downloads Satoshi from Fontshare. Its licence (ITF FFL) allows self-hosting
# in our own app but not redistribution through a public repository, so the
# files are git-ignored and fetched on setup instead.
set -eu

dest="$(cd "$(dirname "$0")/.." && pwd)/assets/fonts"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

curl -fsSL -o "$tmp/satoshi.zip" "https://api.fontshare.com/v2/fonts/download/satoshi"
unzip -q -j -o "$tmp/satoshi.zip" \
  'Satoshi_Complete/Fonts/WEB/fonts/Satoshi-Variable.woff2' \
  'Satoshi_Complete/Fonts/WEB/fonts/Satoshi-VariableItalic.woff2' \
  -d "$dest"
echo "Satoshi installed to $dest"
