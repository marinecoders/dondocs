"""Guard writable source folders; published revisions and built-ins are read-only."""
import json
import sys
from pathlib import Path


def source_folder(root: Path, folder: str, allow_external: bool = False) -> Path:
    root = root.resolve()
    requested = Path(folder)
    if requested.is_absolute() and not allow_external:
        raise ValueError('Expected a single source folder name')
    if not folder or '\\' in folder or (not requested.is_absolute() and (requested.name != folder or folder in ('.', '..'))):
        raise ValueError('Expected a single source folder name')
    destination = (requested if requested.is_absolute() else root / folder).resolve()
    if requested.is_absolute() and requested.parent.resolve().is_relative_to(root) and destination != requested.parent.resolve() / requested.name:
        raise ValueError('Source-folder symlinks are protected from import')
    if destination.parent != root:
        if not allow_external or not requested.is_absolute() or destination.is_relative_to(root) or destination == root:
            raise ValueError('Expected a source folder directly under templates; published revisions are protected')
    if (destination / 'boxes.json').exists():
        raise ValueError('Built-in form is protected from import')
    index = root / 'index.json'
    if destination.parent == root and index.exists():
        data = json.loads(index.read_text())
        for row in data['templates']:
            if row.get('builtin') or row.get('id') in ('navmc10274', 'navmc11811'):
                if destination == (root / row.get('sourceDirectory', row['directory'])).resolve():
                    raise ValueError('Built-in form is protected from import')
    return destination


if __name__ == '__main__':
    try:
        print(source_folder(Path(sys.argv[1]), sys.argv[2], '--external' in sys.argv[3:]))
    except (ValueError, OSError) as error:
        sys.exit(f'Form destination refused: {error}')
