"""Verify the source coverage inventory and generated bank; do not claim legal certification."""
import base64
import collections
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
def read(path): return json.loads((ROOT / path).read_text())
def sha(data): return hashlib.sha256(data).hexdigest()
source = (ROOT / 'questions.txt').read_bytes()
bank = json.loads(gzip.decompress(base64.b64decode(source)))
metadata = read('question-metadata.json')
manifest = read('sources/manifest.json')
coverage = read('audit/source-coverage.json')
legacy = read('audit/legacy-id-map.json')['questions']
issues = []
by_key = {}
for index, question in enumerate(bank):
    key = f"{question['source']['document']}:{question['source']['questionNumber']}"
    if key in by_key: issues.append({'kind': 'duplicate-source-question', 'key': key})
    by_key[key] = question
    if question['id'] != metadata['questions'][index]['id'] or question['subject'] != metadata['questions'][index]['subject']:
        issues.append({'kind': 'metadata-mismatch', 'key': key})
    if len(question['choices']) != 4 or not all(question['choices']) or len(set(question['choices'])) != 4:
        issues.append({'kind': 'invalid-choices', 'key': key})
    if set(question['answerEvidence']['excludedChoices']) != set('ABCD') - {question['answer']}:
        issues.append({'kind': 'source-discussion-mismatch', 'key': key})
if sha(source) != metadata['bankSha256']: issues.append({'kind': 'bank-sha-mismatch'})
for document in manifest['documents']:
    if sha((ROOT / document['path']).read_bytes()) != document['sha256']:
        issues.append({'kind': 'original-pdf-sha-mismatch', 'document': document['id']})
    for number in range(1, document['completeQuestions'] + 1):
        if f"{document['id']}:{number}" not in by_key:
            issues.append({'kind': 'missing-source-question', 'document': document['id'], 'number': number})
for document in coverage['documents']:
    if [page['page'] for page in document['pageCoverage']] != list(range(1, document['pages'] + 1)):
        issues.append({'kind': 'missing-or-duplicate-page', 'document': document['document']})
    for page in document['pageCoverage']:
        if page['kind'] == 'document-overlap':
            key = f"{page['document']}:{page['questionNumber']}"
            if key not in by_key: issues.append({'kind': 'unresolved-overlap', 'key': key})
            continue
        key = f"{document['document']}:{page['questionNumber']}"
        field = 'questionPages' if page['kind'] == 'question' else 'explanationPages'
        if page['page'] not in by_key[key]['source'][field]: issues.append({'kind': 'page-owner-mismatch', 'key': key, 'page': page['page']})
for key, identity in legacy.items():
    if by_key.get(key, {}).get('id') != identity['id']: issues.append({'kind': 'legacy-id-lost', 'key': key})
report = {'auditDate': '2026-11-05', 'completeQuestions': len(bank),
          'sourcePages': coverage['sourcePages'], 'sourceCoverageVerified': not issues,
          'independentAnswerKeyAvailable': False,
          'answerBasis': 'Original explanations identify three distractors; citations are stored per question. This is source correspondence verification, not independent legal certification.',
          'subjectCounts': dict(sorted(collections.Counter(question['subject'] for question in bank).items())),
          'preservedLegacyIds': len(legacy), 'restoredQuestions': len(bank) - len(legacy),
          'originalFigurePages': sum(document['pagesWithImages'] for document in coverage['documents']),
          'issues': issues}
(ROOT / 'audit/question-bank-audit.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(report, ensure_ascii=False, indent=2))
if issues: raise SystemExit(1)
