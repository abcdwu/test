"""Create small, independently verified per-subject downloads from the audited bank."""
import base64
import collections
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def main():
    encoded = (ROOT / 'questions.txt').read_bytes()
    bank = json.loads(gzip.decompress(base64.b64decode(encoded)))
    grouped = collections.defaultdict(list)
    for question in bank:
        # Audit-only distractor citations duplicate explanation text. All user-visible
        # content, stable identities, answers and original page references are retained.
        grouped[question['subject']].append({key: value for key, value in question.items() if key != 'answerEvidence'})
    directory = ROOT / 'bank'
    directory.mkdir(exist_ok=True)
    subjects = {}
    for subject, questions in sorted(grouped.items()):
        content = json.dumps(questions, ensure_ascii=False, separators=(',', ':')).encode()
        compressed = gzip.compress(content, compresslevel=9, mtime=0)
        digest = hashlib.sha256(compressed).hexdigest()
        filename = f'{subject}.{digest[:16]}.json.gz'
        (directory / filename).write_bytes(compressed)
        subjects[subject] = {'count': len(questions), 'file': filename, 'sha256': digest, 'bytes': len(compressed)}
    manifest = {'version': 1, 'sourceSha256': hashlib.sha256(encoded).hexdigest(),
                'total': len(bank), 'subjects': subjects}
    (directory / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps({'catalogBytes': (directory / 'manifest.json').stat().st_size,
                      'total': len(bank), 'subjects': subjects}, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    main()
