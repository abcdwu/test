# 本地 PDF.js

本目录使用 npm 包 [`pdfjs-dist@6.5.438`](https://www.npmjs.com/package/pdfjs-dist/v/6.5.438)，上游项目为 [Mozilla PDF.js](https://github.com/mozilla/pdf.js)。`pdf.mjs`、`pdf.worker.mjs` 及所需字体、CMaps、WASM 解码器和 ICC 资源随本站托管，用于显示 `sources/` 中的原题与解析页面，无需外部 CDN 或 PDF 转换服务。

PDF.js 采用 Apache License 2.0，完整许可保留在 [LICENSE](LICENSE)。字体及解码依赖的独立许可也随相应资源保留在 `standard_fonts/`、`wasm/` 和 `iccs/` 内；更新或重新分发时须一并保留这些许可和源码中的版权声明。

升级时应从同一版本的 `pdfjs-dist` 更新主库、worker 和资源目录，避免版本混用，并运行 `npm test` 及 `tests/browser-check.cjs` 验证原页显示。本站的加载入口为 `pdf-source.js`。
