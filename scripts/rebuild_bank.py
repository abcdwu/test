"""Rebuild every complete source question, with page coverage and stable identities.

Requires PyMuPDF. Originals in sources/ are the content authority. An unmatched,
ambiguous or changed input stops the build; nothing is silently skipped.
"""
import base64
import bisect
import collections
import concurrent.futures
import gzip
import hashlib
import json
import re
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[1]


def digest(value):
    return hashlib.sha256(value).hexdigest()


def lines_from_words(words):
    lines = collections.defaultdict(list)
    for word in words:
        lines[word[5], word[6]].append(word)
    ordered = sorted(lines.values(), key=lambda line: (min(word[1] for word in line), min(word[0] for word in line)))
    return "\n".join(" ".join(word[4] for word in sorted(line, key=lambda word: word[0])) for line in ordered).strip()


def source_page_text(page, page_number):
    # Printed page numbers are outside the body. Keep numerical body/table data.
    words = page.get_text("words")
    kept = [word for word in words if not (word[4] == str(page_number) and word[1] > 735)]
    return lines_from_words(kept)


def parse_document(document):
    path = ROOT / document["path"]
    assert digest(path.read_bytes()) == document["sha256"], f"Changed original PDF: {path}"
    pdf = fitz.open(path)
    assert len(pdf) == document["pages"]
    pages = []
    question_pages = []
    for index, page in enumerate(pdf):
        text_page = page.get_textpage()
        words = page.get_text("words", textpage=text_page)
        # All eight source PDFs put actual A-D labels at x=92.4pt. Party names
        # such as 'A.' inside Civil Procedure facts use a different x position.
        labels = sorted((word for word in words if re.fullmatch(r"[ABCD]\.", word[4])
                         and abs(word[0] - 92.4) < .2), key=lambda word: word[1])
        if "".join(word[4][0] for word in labels) == "ABCD":
            question_pages.append(index + 1)
        text = page.get_text("text", textpage=text_page, sort=True)
        text = re.sub(rf"(?m)^[ \t]*{index + 1}[ \t]*$", "", text).strip()
        pages.append({"text": text, "words": words, "labels": labels,
                      "images": len(page.get_images()), "drawings": len(page.get_drawings())})
    overlaps = {item["page"]: item for item in document.get("overlaps", [])}
    assert len(question_pages) == document["completeQuestions"] + len(overlaps), (
        document["id"], "Question count does not match independently audited inventory", len(question_pages))
    records = []
    coverage = {}
    for position, number in enumerate(question_pages):
        if number in overlaps:
            coverage[number] = {**overlaps[number], "overlapType": overlaps[number]["kind"], "kind": "document-overlap"}
            continue
        end = question_pages[position + 1] - 1 if position + 1 < len(question_pages) else len(pdf)
        page = pages[number - 1]
        labels = page["labels"]
        stem_words = [word for word in page["words"] if word[1] < labels[0][1] - .5
                      and not (word[4] == str(number) and word[1] > 735)]
        stem = lines_from_words(stem_words)
        choices = []
        for choice, label in enumerate(labels):
            next_y = labels[choice + 1][1] - .5 if choice < 3 else 735
            choice_words = [word for word in page["words"] if word[0] > 104
                            and label[1] - .5 <= word[1] < next_y]
            choices.append(re.sub(r"\s+", " ", lines_from_words(choice_words)))
        assert stem and len(choices) == 4 and all(choices), (document["id"], number, "Incomplete question")
        assert len(set(choices)) == 4, (document["id"], number, "Duplicate choices")
        explanation_pages = list(range(number + 1, end + 1))
        assert explanation_pages, (document["id"], number, "Missing explanation")
        mentions = []
        explanation_parts = []
        boundaries = []
        cursor = 0
        for source_number in explanation_pages:
            text = pages[source_number - 1]["text"]
            boundaries.append(cursor)
            explanation_parts.append(text)
            cursor += len(text) + 2
        explanation = "\n\n".join(explanation_parts)
        # A parenthetical can start at the bottom of one page and finish on the
        # next (e.g. Criminal Law q32, pp91-92). Parse the entire source span.
        for match in re.finditer(r"\(Choices?\s+([^)]*)\)", explanation):
            group = match.group(1)
            letters = sorted(set(re.findall(r"\b[ABCD]\b", group)))
            remainder = re.sub(r"\b(?:[ABCD]|and|or)\b|[\s,&]", "", group)
            assert not remainder and letters, (document["id"], number, "Unparsed choice discussion", group)
            mentions.append({"page": explanation_pages[bisect.bisect_right(boundaries, match.start()) - 1],
                             "endPage": explanation_pages[bisect.bisect_right(boundaries, match.end() - 1) - 1],
                             "letters": letters, "label": match.group(0),
                             "context": explanation[max(0, match.start() - 100):min(len(explanation), match.end() + 450)]})
        excluded = set(letter for mention in mentions for letter in mention["letters"])
        candidates = set("ABCD") - excluded
        assert len(candidates) == 1 and len(excluded) == 3, (document["id"], number, "Unresolved source answer", candidates)
        ordinal = len(records) + 1
        subject = "criminal-law" if document["id"] == "criminal-procedure" and ordinal <= 2 else document["subject"]
        explanation = re.sub(r"^Explanation:\s*", "", explanation)
        record = {
            "subject": subject, "stem": stem, "choices": choices,
            "answer": candidates.pop(), "explanation": explanation,
            "source": {"document": document["id"], "questionNumber": ordinal,
                       "questionPages": [number], "explanationPages": explanation_pages,
                       "pdfPath": document["path"], "sha256": document["sha256"]},
            "answerEvidence": {"basis": "source-explanation-distractor-discussions",
                               "independentAnswerKey": False, "excludedChoices": sorted(excluded),
                               "citations": mentions},
        }
        records.append(record)
        for n in range(number, end + 1):
            assert n not in coverage, (document["id"], n, "Page assigned twice")
            coverage[n] = {"kind": "question" if n == number else "explanation", "questionNumber": ordinal,
                           "hasImages": bool(pages[n - 1]["images"]), "hasText": bool(pages[n - 1]["text"])}
    assert len(coverage) == len(pdf) and set(coverage) == set(range(1, len(pdf) + 1)), (document["id"], "Unaccounted pages")
    assert len(records) == document["completeQuestions"]
    summary = {"document": document["id"], "sourceSha256": document["sha256"], "pages": len(pdf),
               "questions": len(records), "pagesWithImages": sum(bool(page["images"]) for page in pages),
               "pageCoverage": [{"page": number, **item} for number, item in sorted(coverage.items())]}
    return records, summary


def main():
    manifest = json.loads((ROOT / "sources/manifest.json").read_text())
    legacy = json.loads((ROOT / "audit/legacy-id-map.json").read_text())["questions"]
    with concurrent.futures.ProcessPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(parse_document, manifest["documents"]))
    bank, coverage, retained = [], [], set()
    for records, summary in results:
        coverage.append(summary)
        for question in records:
            key = f'{question["source"]["document"]}:{question["source"]["questionNumber"]}'
            previous = legacy.get(key)
            question["id"] = previous["id"] if previous else "mbe-" + digest(key.encode())[:24]
            if previous:
                retained.add(previous["id"])
            bank.append(question)
    assert len(bank) == sum(document["completeQuestions"] for document in manifest["documents"])
    assert len({question["id"] for question in bank}) == len(bank)
    assert retained == {record["id"] for record in legacy.values()}, "Lost a legacy wrong-book identity"
    assert len({(question["source"]["document"], question["source"]["questionNumber"]) for question in bank}) == len(bank)
    data = json.dumps(bank, ensure_ascii=False, separators=(",", ":")).encode()
    encoded = base64.b64encode(gzip.compress(data, compresslevel=9, mtime=0))
    (ROOT / "questions.txt").write_bytes(encoded)
    metadata = {"schemaVersion": 2, "bankSha256": digest(encoded),
                "questions": [{"id": question["id"], "subject": question["subject"]} for question in bank]}
    (ROOT / "question-metadata.json").write_text(json.dumps(metadata, indent=2) + "\n")
    counts = dict(sorted(collections.Counter(question["subject"] for question in bank).items()))
    report = {"version": 2, "sourceMappingVerified": True, "independentAnswerKeyAvailable": False,
              "answerBasis": "Each source explanation discusses exactly three distractor choices; all source citations are retained.",
              "completeQuestions": len(bank), "sourcePages": sum(document["pages"] for document in manifest["documents"]),
              "retainedLegacyIds": len(retained), "restoredQuestions": len(bank) - len(retained),
              "subjectCounts": counts, "documents": coverage}
    (ROOT / "audit/source-coverage.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({key: report[key] for key in ["completeQuestions", "sourcePages", "retainedLegacyIds", "restoredQuestions", "subjectCounts"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
