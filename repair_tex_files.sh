#!/bin/bash

# Directory to scan
SEARCH_DIR="web/lib/texlive"

echo "Scanning for corrupt font files in $SEARCH_DIR..."

# Function to check and repair
repair_file() {
    local file="$1"
    # Check if file starts with doctype (HTML)
    if head -c 20 "$file" | grep -q "<!DOCTYPE"; then
        echo "Corrupt file found: $file"
        local filename=$(basename "$file")
        
        # Try to find valid file using kpsewhich
        local valid_path=$(kpsewhich "$filename")
        
        if [ -n "$valid_path" ] && [ -f "$valid_path" ]; then
            echo "  Found valid replacement: $valid_path"
            cp "$valid_path" "$file"
            echo "  Repaired."
        else
            echo "  ERROR: Could not find valid replacement for $filename"
        fi
    fi
}

# Export function for find? No, just loop.
# Find all files in subdirectories
find "$SEARCH_DIR" -type f | while read -r file; do
    repair_file "$file"
done

echo "Repair complete."
