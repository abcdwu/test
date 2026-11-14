"""Build a small, offline English/Chinese dictionary for every bank word."""
import argparse, base64, csv, gzip, hashlib, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEGAL = {
    'consideration': '对价（合同成立中的交换价值）', 'battery': '殴击：故意造成有害或冒犯性的身体接触',
    'assault': '袭击：故意使他人合理畏惧即将发生的有害或冒犯性接触', 'tort': '侵权行为',
    'conversion': '侵占：严重干涉他人动产权益', 'equity': '衡平法；衡平权益（依语境）',
    'equitable': '衡平法上的；公平的', 'motion': '动议；申请', 'complaint': '起诉状',
    'service': '送达；服务（依语境）', 'process': '法律程序；诉讼文书', 'instrument': '法律文书；票据',
    'execution': '执行；签署；死刑执行（依语境）', 'title': '所有权；权属；条文标题（依语境）',
    'issue': '争议焦点；签发；发行（依语境）', 'estate': '财产权益；遗产（依语境）',
    'devise': '遗嘱处分；遗赠（传统上尤指不动产）', 'devisee': '不动产受遗赠人',
    'remainder': '余留权益；剩余部分（依语境）', 'executory': '将来生效的；待履行的',
    'jurisdiction': '管辖权', 'estoppel': '禁反言', 'promissory': '承诺的', 'negligence': '过失',
    'liability': '法律责任', 'liable': '承担法律责任的', 'lien': '留置权；担保权益', 'injunction': '禁令',
    'damages': '损害赔偿金', 'statute': '成文法；制定法', 'hearsay': '传闻证据',
    'impeachment': '对证人信用的攻击；对公职人员的弹劾（依语境）', 'venue': '审判地点；地域管辖',
    'standing': '诉讼资格；原告适格', 'attachment': '财产扣押；附着', 'pleading': '诉辩文书；诉答',
    'waiver': '权利放弃', 'waive': '放弃权利', 'remedy': '法律救济', 'remand': '发回重审；移回原法院',
    'res': '事物；事项（拉丁语，常见于 res judicata 等法律短语）', 'judicata': '已裁判的（拉丁语；res judicata 指既判力）',
}

def main():
    parser = argparse.ArgumentParser(); parser.add_argument('csv'); parser.add_argument('--revision', required=True)
    args = parser.parse_args()
    questions = json.loads(gzip.decompress(base64.b64decode((ROOT / 'questions.txt').read_bytes())))
    corpus = ' '.join(q['stem'] + ' ' + ' '.join(q['choices']) + ' ' + q['explanation'] for q in questions)
    words = set(word.lower().replace('’', "'") for word in re.findall(r"[A-Za-z]+(?:['’][A-Za-z]+)*", corpus)) | set(LEGAL)
    rows = {}
    with open(args.csv) as source:
        for row in csv.DictReader(source):
            word = row['word'].lower()
            if word not in rows or row['translation']: rows[word] = row
    def forms(word):
        yield word
        if word.endswith("'s"): yield word[:-2]
        if word.endswith('ies'): yield word[:-3] + 'y'
        if word.endswith('s'): yield word[:-1]
        if word.endswith('es'): yield word[:-2]
        for ending in ['ing', 'ed']:
            if word.endswith(ending):
                stem = word[:-len(ending)]; yield stem; yield stem + 'e'
                if len(stem) > 2 and stem[-1] == stem[-2]: yield stem[:-1]
    entries = {}
    for word in sorted(words):
        entry = {}
        candidates = list(forms(word))
        for form in candidates:
            if form in LEGAL: entry['legal'] = LEGAL[form]; break
        for form in candidates:
            row = rows.get(form)
            if row and re.search('[\u4e00-\u9fff]', row['translation']):
                entry['translation'] = row['translation'].replace('\\n', '\n')
                if form != word: entry['lemma'] = form
                break
        if entry: entries[word] = entry
    target = ROOT / 'dictionary'; target.mkdir(exist_ok=True)
    payload = gzip.compress(json.dumps(entries, ensure_ascii=False, separators=(',', ':')).encode(), mtime=0)
    digest = hashlib.sha256(payload).hexdigest(); name = 'words.' + digest[:16] + '.json.gz'
    (target / name).write_bytes(payload)
    for old in target.glob('words.*.json.gz'):
        if old.name != name: old.unlink()
    (target / 'manifest.json').write_text(json.dumps({'version': 1, 'file': name, 'sha256': digest, 'bytes': len(payload),
        'entries': len(entries), 'corpusWords': len(words), 'source': 'ECDICT', 'revision': args.revision}, indent=2) + '\n')
    print(f'Dictionary: {len(entries)}/{len(words)} corpus words; {len(payload)} bytes compressed')

if __name__ == '__main__': main()
