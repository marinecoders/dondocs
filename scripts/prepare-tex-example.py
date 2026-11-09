"""Stage the checked-in TeX example without writing build files into tex/."""
import argparse
from pathlib import Path
import shutil


def prepare(output: Path) -> None:
    root = Path(__file__).resolve().parent.parent
    output = output.resolve()
    if output == root or output == root / "tex" or root / "tex" in output.parents:
        raise ValueError("Choose a build directory outside the TeX source directory")
    output.mkdir(parents=True, exist_ok=True)
    for source in (root / "tex").glob("*.tex"):
        shutil.copyfile(source, output / source.name)
    for source in (root / "tex/templates").glob("*.tex"):
        shutil.copyfile(source, output / source.name)
    attachments = output / "attachments"
    attachments.mkdir(exist_ok=True)
    for source in (root / "public/attachments").glob("*.png"):
        shutil.copyfile(source, attachments / source.name)
    # The example includes two references and no enclosures or recipient lists.
    (output / "flags.tex").write_text("\\setHasReferences\n")
    for name in ("encl-config.tex", "distribution-config.tex", "copyto-config.tex"):
        (output / name).write_text("% No entries in the standalone example.\n")
    (output / "swiftlatex-compat.sty").write_text(
        "\\ProvidesPackage{swiftlatex-compat}[Native pdfTeX compatibility]\n"
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    prepare(parser.parse_args().output)
