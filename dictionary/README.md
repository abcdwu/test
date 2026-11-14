# Offline word lookup

English–Chinese general definitions are a subset of [ECDICT](https://github.com/skywind3000/ECDICT), pinned to commit `39cfb9672c0906b63569e0453c2e6abfb9ab182a` and distributed under the included MIT [LICENSE](LICENSE). The question bank's English vocabulary selects the subset. A small, separately labeled list of common legal meanings is maintained in `scripts/build_dictionary.py`; definitions are reading aids, not translations of the question or its answer.

Rebuild using the pinned upstream `ecdict.csv`:

```sh
python3 scripts/build_dictionary.py /path/to/ecdict.csv --revision 39cfb9672c0906b63569e0453c2e6abfb9ab182a
```

The manifest contains the resulting compressed file's SHA-256 and length. Lookup downloads that file only on first use, verifies it, and caches it locally. No words or question text are sent to a translation service.
