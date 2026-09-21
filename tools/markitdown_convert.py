"""Convertit un document en Markdown via Microsoft MarkItDown.

Usage:
  python markitdown_convert.py <fichier>

Écrit le Markdown sur stdout (UTF-8). Les erreurs vont sur stderr.
"""

from __future__ import annotations

import sys


def main() -> int:
    if len(sys.argv) < 2 or not sys.argv[1].strip():
        print("Usage: markitdown_convert.py <fichier>", file=sys.stderr)
        return 2

    path = sys.argv[1]
    try:
        from markitdown import MarkItDown
    except ImportError:
        print(
            "Le paquet markitdown n'est pas installé. "
            "Dans Réglages → Import documents, cliquez « Installer MarkItDown », "
            "ou : pip install -r tools/requirements-markitdown.txt",
            file=sys.stderr,
        )
        return 3

    try:
        md = MarkItDown()
        result = md.convert(path)
    except Exception as exc:  # noqa: BLE001 — surface clear error to the app
        print(f"Conversion MarkItDown échouée : {exc}", file=sys.stderr)
        return 1

    text = (getattr(result, "text_content", None) or getattr(result, "markdown", None) or "")
    if not isinstance(text, str):
        text = str(text)
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not text:
        print("Conversion vide — fichier non pris en charge ou sans contenu textuel.", file=sys.stderr)
        return 1

    sys.stdout.write(text)
    if not text.endswith("\n"):
        sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
