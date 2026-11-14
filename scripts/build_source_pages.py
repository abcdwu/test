"""Extract small, lossless PDF page chunks and audit every original page."""
import hashlib, json
from pathlib import Path
import fitz

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / 'sources' / 'pages'
BLOCK = 32

def main():
    TARGET.mkdir(exist_ok=True)
    builder = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    old_manifest = TARGET / 'manifest.json'
    if old_manifest.exists():
        old = json.loads(old_manifest.read_text())
        if old.get('builderSha256') == builder and all(
            hashlib.sha256((ROOT / 'sources' / (name + '.pdf')).read_bytes()).hexdigest() == info['sourceSha256']
            and all((TARGET / chunk['file']).exists() and hashlib.sha256((TARGET / chunk['file']).read_bytes()).hexdigest() == chunk['sha256'] for chunk in info['chunks'])
            for name, info in old['subjects'].items()):
            print('Existing verified page chunks are current', flush=True); return
    manifest = {'version': 1, 'blockSize': BLOCK, 'builderSha256': builder, 'subjects': {}}
    used = set()
    total_bytes = total_pages = 0
    for path in sorted((ROOT / 'sources').glob('*.pdf')):
        source = fitz.open(path)
        chunks = []
        for first in range(0, len(source), BLOCK):
            last = min(first + BLOCK, len(source))
            # Selecting from a full clone preserves catalog-level optional-content
            # layers; inserting pages alone changes some originals' rendering.
            out = fitz.open(path); out.select(list(range(first, last)))
            # Tags, outlines and form trees can retain excluded pages and images.
            # Keep the visual document layers and color output intent only.
            for key in out.xref_get_keys(out.pdf_catalog()):
                if key not in ['Type', 'Pages', 'OCProperties', 'OutputIntents']:
                    out.xref_set_key(out.pdf_catalog(), key, 'null')
            data = out.tobytes(garbage=4, deflate=True, no_new_id=True); out.close()
            digest = hashlib.sha256(data).hexdigest()
            name = f'{path.stem}.{first + 1}-{last}.{digest[:16]}.pdf'
            (TARGET / name).write_bytes(data)
            used.add(name)
            check = fitz.open(stream=data, filetype='pdf')
            assert len(check) == last - first
            for local, original in enumerate(range(first, last)):
                a, b = source[original], check[local]
                assert a.rect == b.rect and a.rotation == b.rotation
                assert a.get_text() == b.get_text(), (path.name, original + 1, 'text')
                # Compare every page's rendered pixels, including image-only pages.
                x = a.get_pixmap(matrix=fitz.Matrix(.25, .25), alpha=False)
                y = b.get_pixmap(matrix=fitz.Matrix(.25, .25), alpha=False)
                assert x.width == y.width and x.height == y.height and x.samples == y.samples, (path.name, original + 1, 'pixels')
            check.close()
            chunks.append({'file': name, 'first': first + 1, 'last': last, 'bytes': len(data), 'sha256': digest})
            total_bytes += len(data)
        manifest['subjects'][path.stem] = {'pages': len(source), 'sourceSha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'chunks': chunks}
        total_pages += len(source)
        print(path.name, len(source), 'pages verified;', len(chunks), 'chunks', flush=True)
        source.close()
    manifest['verifiedPages'] = total_pages
    manifest['bytes'] = total_bytes
    (TARGET / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    for old in TARGET.glob('*.pdf'):
        if old.name not in used: old.unlink()
    print(f'Verified {total_pages} pages, {total_bytes} bytes; original PDFs unchanged', flush=True)

if __name__ == '__main__': main()
