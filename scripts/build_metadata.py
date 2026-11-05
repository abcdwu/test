"""Add stable IDs and the existing source's eight subject groups without rewriting it."""
import base64
import gzip
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = (ROOT / "questions.txt").read_bytes()
questions = json.loads(gzip.decompress(base64.b64decode(source)))

# Zero-based, end-exclusive ranges from the original ordered question bank.
# The first two questions in the criminal-procedure section concern substantive
# attempt/accessory liability, so they belong in criminal law instead.
GROUPS = [
    (0, 282, "civil-procedure"),
    (282, 547, "evidence"),
    (547, 549, "criminal-law"),
    (549, 626, "criminal-procedure"),
    (626, 894, "contracts"),
    (894, 993, "torts"),
    (993, 1148, "criminal-law"),
    (1148, 1387, "constitutional-law"),
    (1387, 1635, "real-property"),
]
assert len(questions) == 1635, "Source changed; review subject boundaries before rebuilding"
metadata = []
for index, question in enumerate(questions):
    subject, = [key for start, end, key in GROUPS if start <= index < end]
    identity = json.dumps([question["stem"], question["choices"]], ensure_ascii=False, separators=(",", ":"))
    question_id = "mbe-" + hashlib.sha256(identity.encode()).hexdigest()[:24]
    metadata.append({"id": question_id, "subject": subject})
assert len({item["id"] for item in metadata}) == len(metadata), "Duplicate question IDs"
result = {"bankSha256": hashlib.sha256(source).hexdigest(), "questions": metadata}
(ROOT / "question-metadata.json").write_text(json.dumps(result, indent=2) + "\n")
print(f"Built metadata for {len(metadata)} questions")
