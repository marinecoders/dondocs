#!/bin/bash
# Bundle TeX Live packages into JavaScript for SwiftLaTeX
# This avoids HTTP fetching issues and works fully offline
# Packages are organized by kpathsea format code for proper loading

# Get script directory for proper paths
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT="$SCRIPT_DIR/js/texlive-packages.js"
LIB_DIR="$SCRIPT_DIR/lib/texlive/pdftex"

echo "/**" > "$OUTPUT"
echo " * TeX Live Packages for SwiftLaTeX Browser Compilation" >> "$OUTPUT"
echo " * Auto-generated - DO NOT EDIT" >> "$OUTPUT"
echo " * Generated: $(date)" >> "$OUTPUT"
echo " * Format codes: 3=tfm, 10=cfg/fmt, 26=cls/clo, 27=sty, 28=fd, 32=def" >> "$OUTPUT"
echo " */" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Use array format with format code for each file
echo "const TEXLIVE_PACKAGES = [" >> "$OUTPUT"

# Function to add a file with format code
add_file() {
    local filepath="$1"
    local filename="$2"
    local format="$3"

    if [ -f "$filepath" ]; then
        echo "  { format: $format, filename: '$filename', content: \`" >> "$OUTPUT"
        # Escape backticks and backslashes for JS template literal
        sed 's/\\/\\\\/g; s/`/\\`/g; s/\$/\\$/g' "$filepath" >> "$OUTPUT"
        echo "\` }," >> "$OUTPUT"
        echo "  Added: $filename (format $format)"
    fi
}

# Add .cls files (format 26)
for f in "$LIB_DIR"/26/*.cls; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 26
done

# Add .clo files (format 26)
for f in "$LIB_DIR"/26/*.clo; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 26
done

# Add .mkii files (format 26 - ConTeXt Mark II files)
for f in "$LIB_DIR"/26/*.mkii; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 26
done

# Add .sty files (format 27 AND format 26 - TeX may request either)
for f in "$LIB_DIR"/27/*.sty; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 27
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 26
done

# Add .ltx files (format 27 AND format 26 - TeX may request either)
for f in "$LIB_DIR"/27/*.ltx; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 27
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 26
done

# Add .def files (format 32 AND format 26 - TeX may request either)
for f in "$LIB_DIR"/32/*.def; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 32
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 26
done

# Add .dfu files (format 32 AND format 26 - unicode definition files)
for f in "$LIB_DIR"/32/*.dfu; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 32
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 26
done

# Add .fd files (format 28)
for f in "$LIB_DIR"/28/*.fd; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 28
done

# Add .cfg files (format 10 AND format 26 - TeX may request either)
for f in "$LIB_DIR"/10/*.cfg; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 10
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 26
done

# Add pdftex.map (format 11 - font map)
for f in "$LIB_DIR"/11/*.map; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 11
done

# Add encoding files (format 44 - enc files)
for f in "$LIB_DIR"/enc/*.enc; do
    [ -f "$f" ] && add_file "$f" "$(basename "$f")" 44
done

echo "];" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Font metrics (binary - base64 encoded)
echo "// Font metrics (binary - base64 encoded, format 3)" >> "$OUTPUT"
echo "const TEXLIVE_FONTS = [" >> "$OUTPUT"

for f in "$LIB_DIR"/3/*; do
    if [ -f "$f" ] && [[ "$f" == *.tfm ]]; then
        filename=$(basename "$f")
        echo "  { format: 3, filename: '$filename', content: '$(base64 < "$f" | tr -d '\n')' }," >> "$OUTPUT"
        echo "  Added font: $filename"
    fi
done

echo "];" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Type1 fonts (binary - base64 encoded, format 32 - same as .def files)
echo "// Type1 fonts (binary - base64 encoded, format 32)" >> "$OUTPUT"
echo "const TEXLIVE_TYPE1_FONTS = [" >> "$OUTPUT"

for f in "$LIB_DIR"/pfb/*.pfb; do
    if [ -f "$f" ]; then
        filename=$(basename "$f")
        echo "  { format: 32, filename: '$filename', content: '$(base64 < "$f" | tr -d '\n')' }," >> "$OUTPUT"
        echo "  Added Type1 font: $filename"
    fi
done

echo "];" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Virtual fonts (binary - base64 encoded, format 33)
echo "// Virtual fonts (binary - base64 encoded, format 33)" >> "$OUTPUT"
echo "const TEXLIVE_VF_FONTS = [" >> "$OUTPUT"

for f in "$LIB_DIR"/33/*.vf; do
    if [ -f "$f" ]; then
        filename=$(basename "$f")
        echo "  { format: 33, filename: '$filename', content: '$(base64 < "$f" | tr -d '\n')' }," >> "$OUTPUT"
        echo "  Added VF font: $filename"
    fi
done

echo "];" >> "$OUTPUT"
echo "" >> "$OUTPUT"

# Attachment files (images, etc. - base64 encoded)
echo "// Attachment files (images - base64 encoded)" >> "$OUTPUT"
echo "const TEXLIVE_ATTACHMENTS = [" >> "$OUTPUT"

# Include dod-seal.png from the repo's attachments folder
REPO_DIR="$(dirname "$SCRIPT_DIR")"
if [ -f "$REPO_DIR/attachments/dod-seal.png" ]; then
    echo "  { filename: 'dod-seal.png', content: '$(base64 < "$REPO_DIR/attachments/dod-seal.png" | tr -d '\n')' }," >> "$OUTPUT"
    echo "  Added attachment: dod-seal.png"
fi

echo "];" >> "$OUTPUT"

echo ""
echo "Generated $OUTPUT"
