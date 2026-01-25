#!/usr/bin/env python3
"""
PDF Box Boundary Extractor

This script extracts rectangle/box boundaries from PDF form templates
and outputs TypeScript code for use in PDF generators.

Requirements:
    pip install pdfplumber

Usage:
    python scripts/extract-pdf-boxes.py public/templates/NAVMC10274_page2.pdf
    python scripts/extract-pdf-boxes.py public/templates/NAVMC118_template.pdf
    python scripts/extract-pdf-boxes.py --config public/templates/NAVMC118.boxes.json

The script will:
1. Detect all rectangles in the PDF
2. Filter out very small or page-sized rectangles
3. Group nearby rectangles (form field boxes)
4. Output TypeScript code with box definitions

For forms with poor auto-detection, use a .boxes.json config file.
"""

import sys
import json
from pathlib import Path

try:
    import pdfplumber
except ImportError:
    print("Error: pdfplumber is required. Install with: pip install pdfplumber")
    sys.exit(1)


# =============================================================================
# JSON Configuration Support
# =============================================================================

def load_box_config(config_path: str) -> dict:
    """
    Load box definitions from a JSON config file.

    Config format:
    {
      "template": "NAVMC118_template.pdf",
      "description": "NAVMC 118(11) Administrative Remarks",
      "pageSize": { "width": 612, "height": 792 },
      "boxes": {
        "name": { "left": 148, "top": 142, "width": 206, "height": 16 },
        "edipi": { "left": 465, "top": 142, "width": 106, "height": 16 },
        ...
      }
    }
    """
    with open(config_path, 'r') as f:
        config = json.load(f)

    boxes = []
    for name, coords in config.get('boxes', {}).items():
        box = {
            'name': name,
            'left': coords['left'],
            'top': coords['top'],
            'width': coords['width'],
            'height': coords['height'],
            'source': 'config',
        }
        boxes.append(box)

    # Sort by position (top to bottom, left to right)
    boxes.sort(key=lambda b: (-b['top'], b['left']))

    return {
        'boxes': boxes,
        'metadata': {
            'template': config.get('template', ''),
            'description': config.get('description', ''),
        }
    }


def create_box_config_template(pdf_path: str, boxes: list) -> str:
    """
    Generate a JSON config template for manual editing.
    """
    config = {
        "template": Path(pdf_path).name,
        "description": "TODO: Add form description",
        "pageSize": {"width": 612, "height": 792},
        "boxes": {}
    }

    for i, box in enumerate(boxes):
        name = box.get('name', f'field{i + 1}')
        config['boxes'][name] = {
            'left': box['left'],
            'top': box['top'],
            'width': box['width'],
            'height': box['height'],
        }

    return json.dumps(config, indent=2)


def extract_boxes(pdf_path: str, min_size: float = 10, max_size: float = 600):
    """
    Extract rectangle boxes from a PDF file.

    Args:
        pdf_path: Path to the PDF file
        min_size: Minimum width/height to consider (filters tiny lines)
        max_size: Maximum width/height to consider (filters page borders)

    Returns:
        List of box dictionaries with left, top, width, height
    """
    boxes = []

    with pdfplumber.open(pdf_path) as pdf:
        for page_num, page in enumerate(pdf.pages):
            page_height = page.height

            # Get all rectangles on the page
            rects = page.rects or []
            lines = page.lines or []

            print(f"\nPage {page_num + 1}: Found {len(rects)} rectangles, {len(lines)} lines")

            # Process rectangles
            for rect in rects:
                x0 = rect['x0']
                y0 = rect['y0']
                x1 = rect['x1']
                y1 = rect['y1']

                width = x1 - x0
                height = y1 - y0

                if width < min_size or height < min_size:
                    continue
                if width > max_size or height > max_size:
                    continue

                pdf_top = page_height - y0

                box = {
                    'left': round(x0, 1),
                    'top': round(pdf_top, 1),
                    'width': round(width, 1),
                    'height': round(abs(height), 1),
                    'page': page_num + 1,
                    'source': 'rect',
                }
                boxes.append(box)

            # Try to construct boxes from horizontal and vertical lines
            h_lines = [l for l in lines if abs(l['y0'] - l['y1']) < 2]  # Horizontal
            v_lines = [l for l in lines if abs(l['x0'] - l['x1']) < 2]  # Vertical

            print(f"  - {len(h_lines)} horizontal lines, {len(v_lines)} vertical lines")

            # Find boxes formed by intersecting lines
            line_boxes = find_boxes_from_lines(h_lines, v_lines, page_height, min_size, max_size)
            boxes.extend(line_boxes)

    # Sort by position (top to bottom, left to right)
    boxes.sort(key=lambda b: (-b['top'], b['left']))

    return boxes


def find_boxes_from_lines(h_lines, v_lines, page_height, min_size, max_size, tolerance=5):
    """
    Find rectangular boxes formed by intersecting horizontal and vertical lines.
    Uses improved algorithm that:
    1. Clusters lines by Y-position (horizontal) and X-position (vertical)
    2. Finds boxes where lines approximately form rectangles
    3. Handles partial line overlaps (common in military forms)
    """
    boxes = []

    # Sort lines
    h_lines = sorted(h_lines, key=lambda l: l['y0'])
    v_lines = sorted(v_lines, key=lambda l: l['x0'])

    # Cluster horizontal lines by Y position
    h_clusters = cluster_lines_by_position(h_lines, 'y0', tolerance)
    v_clusters = cluster_lines_by_position(v_lines, 'x0', tolerance)

    # For each pair of horizontal line clusters
    for i, h1_cluster in enumerate(h_clusters):
        for h2_cluster in h_clusters[i+1:]:
            h1_y = sum(l['y0'] for l in h1_cluster) / len(h1_cluster)
            h2_y = sum(l['y0'] for l in h2_cluster) / len(h2_cluster)

            height = abs(h2_y - h1_y)
            if height < min_size or height > max_size:
                continue

            top_y = min(h1_y, h2_y)
            bottom_y = max(h1_y, h2_y)

            # Find vertical line clusters that span between these horizontals
            spanning_v_clusters = []
            for v_cluster in v_clusters:
                v_top = min(min(l['y0'], l['y1']) for l in v_cluster)
                v_bottom = max(max(l['y0'], l['y1']) for l in v_cluster)

                # Check if vertical lines approximately span the horizontal gap
                if v_top <= top_y + tolerance * 2 and v_bottom >= bottom_y - tolerance * 2:
                    v_x = sum(l['x0'] for l in v_cluster) / len(v_cluster)
                    spanning_v_clusters.append((v_x, v_cluster))

            # Sort by X position
            spanning_v_clusters.sort(key=lambda x: x[0])

            # For each pair of vertical clusters, check if we have a valid box
            for j, (v1_x, v1_cluster) in enumerate(spanning_v_clusters):
                for v2_x, v2_cluster in spanning_v_clusters[j+1:]:
                    width = abs(v2_x - v1_x)
                    if width < min_size or width > max_size:
                        continue

                    # Check if horizontal lines span this width (with relaxed tolerance)
                    h1_span = get_line_span(h1_cluster)
                    h2_span = get_line_span(h2_cluster)

                    h1_covers = h1_span[0] <= v1_x + tolerance * 2 and h1_span[1] >= v2_x - tolerance * 2
                    h2_covers = h2_span[0] <= v1_x + tolerance * 2 and h2_span[1] >= v2_x - tolerance * 2

                    if h1_covers and h2_covers:
                        pdf_top = page_height - top_y

                        box = {
                            'left': round(v1_x, 1),
                            'top': round(pdf_top, 1),
                            'width': round(width, 1),
                            'height': round(height, 1),
                            'page': 1,
                            'source': 'lines',
                        }
                        boxes.append(box)

    return boxes


def cluster_lines_by_position(lines, pos_key, tolerance):
    """
    Group lines that are at approximately the same position.
    """
    if not lines:
        return []

    clusters = []
    used = set()

    for i, line in enumerate(lines):
        if i in used:
            continue

        cluster = [line]
        pos = line[pos_key]

        for j, other in enumerate(lines[i+1:], i+1):
            if j in used:
                continue
            if abs(other[pos_key] - pos) < tolerance:
                cluster.append(other)
                used.add(j)

        clusters.append(cluster)
        used.add(i)

    return clusters


def get_line_span(lines):
    """
    Get the total horizontal span of a cluster of horizontal lines.
    """
    min_x = min(min(l['x0'], l['x1']) for l in lines)
    max_x = max(max(l['x0'], l['x1']) for l in lines)
    return (min_x, max_x)


def merge_nearby_boxes(boxes, threshold: float = 5):
    """
    Merge boxes that are very close together (likely same field).
    """
    if not boxes:
        return boxes

    merged = []
    used = set()

    for i, box1 in enumerate(boxes):
        if i in used:
            continue

        # Find boxes that overlap or are very close
        group = [box1]
        for j, box2 in enumerate(boxes[i+1:], i+1):
            if j in used:
                continue

            # Check if boxes are close
            if (abs(box1['left'] - box2['left']) < threshold and
                abs(box1['top'] - box2['top']) < threshold):
                group.append(box2)
                used.add(j)

        # Use the largest box in the group
        best = max(group, key=lambda b: b['width'] * b['height'])
        merged.append(best)
        used.add(i)

    return merged


def generate_typescript(boxes, variable_name: str = "PAGE_BOXES"):
    """
    Generate TypeScript code for box definitions.
    """
    lines = [
        f"const {variable_name}: Record<string, BoxBoundary> = {{",
    ]

    for i, box in enumerate(boxes):
        name = f"field{i + 1}"
        padding = ' ' * max(0, 16 - len(name))
        lines.append(
            f"  {name}:{padding}{{ name: '{name}', "
            f"left: {box['left']}, top: {box['top']}, "
            f"width: {box['width']}, height: {box['height']} }},"
        )

    lines.append("};")
    return '\n'.join(lines)


def print_visual_map(boxes, page_width: float = 612, page_height: float = 792):
    """
    Print a simple ASCII visualization of box positions.
    """
    print("\n" + "=" * 60)
    print("VISUAL MAP (approximate positions)")
    print("=" * 60)

    # Scale to terminal size
    term_width = 60
    term_height = 30

    grid = [[' ' for _ in range(term_width)] for _ in range(term_height)]

    for i, box in enumerate(boxes):
        # Scale coordinates
        x = int((box['left'] / page_width) * (term_width - 1))
        y = int(((page_height - box['top']) / page_height) * (term_height - 1))

        # Clamp to grid
        x = max(0, min(x, term_width - 1))
        y = max(0, min(y, term_height - 1))

        # Mark position
        marker = str(i + 1) if i < 9 else chr(ord('A') + i - 9)
        if y < term_height and x < term_width:
            grid[y][x] = marker

    # Print grid
    print("┌" + "─" * term_width + "┐")
    for row in grid:
        print("│" + ''.join(row) + "│")
    print("└" + "─" * term_width + "┘")

    # Print legend
    print("\nLegend:")
    for i, box in enumerate(boxes):
        marker = str(i + 1) if i < 9 else chr(ord('A') + i - 9)
        print(f"  {marker}: ({box['left']}, {box['top']}) - {box['width']}x{box['height']}")


def save_annotated_image(pdf_path: str, boxes: list, output_path: str = None):
    """
    Save a PNG image of the PDF with detected boxes highlighted.
    Requires: pip install pdf2image Pillow
    """
    try:
        from pdf2image import convert_from_path
        from PIL import ImageDraw, ImageFont
    except ImportError:
        print("Note: Install pdf2image and Pillow for visual output:")
        print("  pip install pdf2image Pillow")
        return None

    # Convert PDF to image
    images = convert_from_path(pdf_path, dpi=72)  # 72 DPI = 1 point per pixel
    if not images:
        return None

    img = images[0]
    draw = ImageDraw.Draw(img)

    # Draw detected boxes
    for i, box in enumerate(boxes):
        # Convert from PDF coords (origin bottom-left) to image coords (origin top-left)
        img_y_top = img.height - box['top']
        img_y_bottom = img_y_top + box['height']

        # Draw rectangle
        color = (255, 0, 0) if box.get('source') == 'rect' else (0, 0, 255)
        draw.rectangle(
            [box['left'], img_y_top, box['left'] + box['width'], img_y_bottom],
            outline=color,
            width=2
        )

        # Draw label
        label = str(i + 1) if i < 9 else chr(ord('A') + i - 9)
        draw.text((box['left'] + 2, img_y_top + 2), label, fill=color)

    # Save
    if output_path is None:
        output_path = Path(pdf_path).stem + '_boxes.png'

    img.save(output_path)
    print(f"\nAnnotated image saved to: {output_path}")
    return output_path


def interactive_mode(pdf_path: str):
    """
    Interactive mode to manually define boxes with guidance.
    """
    print("\n" + "=" * 60)
    print("INTERACTIVE BOX DEFINITION")
    print("=" * 60)
    print("""
To manually measure boxes, open the PDF in a viewer that shows coordinates.

Recommended tools:
- Adobe Acrobat: View > Show/Hide > Cursor Coordinates
- PDF-XChange Editor: View > Toolbars > Status Bar (shows cursor position)
- Preview (Mac): Tools > Show Inspector, then look at position

PDF Coordinate System:
- Origin (0,0) is at BOTTOM-LEFT of page
- X increases to the right
- Y increases upward
- Units are points (72 points = 1 inch)
- Letter size page = 612 x 792 points

Enter box coordinates below. Type 'done' when finished.
Format: name left top width height
Example: actionNo 427 724 88 14
    """)

    boxes = []
    while True:
        try:
            line = input("\nBox (name left top width height): ").strip()
            if line.lower() in ('done', 'quit', 'exit', ''):
                break

            parts = line.split()
            if len(parts) != 5:
                print("Error: Need 5 values: name left top width height")
                continue

            name = parts[0]
            left, top, width, height = map(float, parts[1:])

            box = {
                'name': name,
                'left': left,
                'top': top,
                'width': width,
                'height': height,
            }
            boxes.append(box)
            print(f"  Added: {name} at ({left}, {top}) size {width}x{height}")

        except ValueError as e:
            print(f"Error: {e}")
        except KeyboardInterrupt:
            break

    if boxes:
        print("\n" + "=" * 60)
        print("YOUR BOX DEFINITIONS")
        print("=" * 60)
        print(generate_typescript_named(boxes))


def generate_typescript_named(boxes):
    """Generate TypeScript with actual field names."""
    lines = ["const PAGE_BOXES: Record<string, BoxBoundary> = {"]
    for box in boxes:
        name = box['name']
        padding = ' ' * max(0, 16 - len(name))
        lines.append(
            f"  {name}:{padding}{{ name: '{name}', "
            f"left: {box['left']}, top: {box['top']}, "
            f"width: {box['width']}, height: {box['height']} }},"
        )
    lines.append("};")
    return '\n'.join(lines)


def main():
    if len(sys.argv) < 2:
        print("PDF Box Boundary Extractor")
        print("=" * 40)
        print("\nUsage:")
        print("  python extract-pdf-boxes.py <pdf_file> [options]")
        print("  python extract-pdf-boxes.py --config <config.json>")
        print("\nOptions:")
        print("  --min-size N      Minimum box size (default: 10)")
        print("  --max-size N      Maximum box size (default: 600)")
        print("  --interactive     Enter boxes manually with guidance")
        print("  --save-image      Save annotated PNG showing detected boxes")
        print("  --save-config     Save detected boxes as JSON config template")
        print("  --config FILE     Load boxes from JSON config (skip auto-detection)")
        print("\nExamples:")
        print("  python scripts/extract-pdf-boxes.py public/templates/NAVMC10274_page2.pdf")
        print("  python scripts/extract-pdf-boxes.py template.pdf --interactive")
        print("  python scripts/extract-pdf-boxes.py template.pdf --save-image")
        print("  python scripts/extract-pdf-boxes.py template.pdf --save-config")
        print("  python scripts/extract-pdf-boxes.py --config public/templates/NAVMC118.boxes.json")
        print("\nJSON Config Format:")
        print("  {")
        print('    "template": "NAVMC118_template.pdf",')
        print('    "description": "NAVMC 118(11) Administrative Remarks",')
        print('    "boxes": {')
        print('      "name": { "left": 148, "top": 142, "width": 206, "height": 16 },')
        print('      "edipi": { "left": 465, "top": 142, "width": 106, "height": 16 }')
        print("    }")
        print("  }")
        sys.exit(1)

    # Check for config-only mode
    if '--config' in sys.argv:
        config_idx = sys.argv.index('--config')
        if config_idx + 1 >= len(sys.argv):
            print("Error: --config requires a file path")
            sys.exit(1)
        config_path = sys.argv[config_idx + 1]

        if not Path(config_path).exists():
            print(f"Error: Config file not found: {config_path}")
            sys.exit(1)

        print(f"Loading box definitions from: {config_path}")
        result = load_box_config(config_path)
        boxes = result['boxes']

        if result['metadata'].get('description'):
            print(f"Description: {result['metadata']['description']}")

        print(f"Loaded {len(boxes)} box definitions\n")

        # Print visual map and TypeScript
        print_visual_map(boxes)

        print("\n" + "=" * 60)
        print("TYPESCRIPT CODE")
        print("=" * 60)
        print(generate_typescript_named(boxes))
        return

    pdf_path = sys.argv[1]

    # Parse optional arguments
    min_size = 10
    max_size = 600
    interactive = '--interactive' in sys.argv
    save_image = '--save-image' in sys.argv
    save_config = '--save-config' in sys.argv

    for i, arg in enumerate(sys.argv[2:], 2):
        if arg == '--min-size' and i + 1 < len(sys.argv):
            min_size = float(sys.argv[i + 1])
        elif arg == '--max-size' and i + 1 < len(sys.argv):
            max_size = float(sys.argv[i + 1])

    if not Path(pdf_path).exists():
        print(f"Error: File not found: {pdf_path}")
        sys.exit(1)

    if interactive:
        interactive_mode(pdf_path)
        return

    print(f"Extracting boxes from: {pdf_path}")
    print(f"Filter: min_size={min_size}, max_size={max_size}")

    # Extract boxes
    boxes = extract_boxes(pdf_path, min_size, max_size)
    print(f"\nFound {len(boxes)} boxes after filtering")

    # Merge nearby boxes
    boxes = merge_nearby_boxes(boxes)
    print(f"After merging: {len(boxes)} unique boxes")

    # Save annotated image if requested
    if save_image:
        save_annotated_image(pdf_path, boxes)

    # Save config template if requested
    if save_config:
        config_path = Path(pdf_path).stem + '.boxes.json'
        config_content = create_box_config_template(pdf_path, boxes)
        with open(config_path, 'w') as f:
            f.write(config_content)
        print(f"\nConfig template saved to: {config_path}")
        print("Edit this file to rename fields and adjust coordinates as needed.")

    # Print visual map
    print_visual_map(boxes)

    # Print JSON
    print("\n" + "=" * 60)
    print("RAW JSON DATA")
    print("=" * 60)
    print(json.dumps(boxes, indent=2))

    # Print TypeScript code
    print("\n" + "=" * 60)
    print("TYPESCRIPT CODE")
    print("=" * 60)
    print(generate_typescript(boxes))

    print("\n" + "=" * 60)
    print("NEXT STEPS")
    print("=" * 60)
    print("1. Review the boxes above and rename 'field1', 'field2', etc.")
    print("2. Copy the TypeScript code into your generator file")
    print("3. Map field names to your data structure")
    print("\nTip: Use --save-config to generate a JSON template for manual editing")
    print("Tip: Use --interactive mode to manually define boxes with proper names")


if __name__ == '__main__':
    main()
