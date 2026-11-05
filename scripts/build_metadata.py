"""Rebuild metadata from immutable source identities, never by positional ranges."""
import base64
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / 'questions.txt').read_bytes()
questions = json.loads(gzip.decompress(base64.b64decode(source)))
manifest = json.loads((ROOT / 'sources/manifest.json').read_text())
assert len(questions) == sum(item['completeQuestions'] for item in manifest['documents'])
assert len({question['id'] for question in questions}) == len(questions)
assert all(question.get('source') and question.get('answerEvidence') for question in questions)
result = {'schemaVersion': 2, 'bankSha256': hashlib.sha256(source).hexdigest(),
          'questions': [{'id': question['id'], 'subject': question['subject']} for question in questions]}
(ROOT / 'question-metadata.json').write_text(json.dumps(result, indent=2) + '\n')
print(f'Built metadata for {len(questions)} source-traced questions; IDs preserved')
