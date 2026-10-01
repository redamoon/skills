# NOTICE

This skill is a fork of [coji/natural-japanese](https://github.com/coji/natural-japanese), licensed under the MIT License:

```
MIT License

Copyright (c) 2026 coji

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`references/`（`diagnose.md` を除く一部は文言を軽微に調整）と `assets/style-profile-template.md` は原典からほぼそのまま移植した。`scripts/`（`lint.ts` / `outline.ts` / `terms.ts` / `textcore.ts`）は原典の Python 実装（sudachipy 版）のロジック・閾値を踏襲しつつ、TypeScript + kuromoji.js へ書き直したもの。差分は `SKILL.md` の「原典からの変更点」を参照。

---

比喩動詞カタログ（`references/metaphor-verbs.md`）、質感を装う疑似具体語・抽象比喩名詞・必殺技造語（`references/forbidden-patterns.md` の該当節）、表記・装飾の不自然さ（文末コロン・emダッシュ・和欧文間の半角空白・言い換えカッコ）、意味保持の4点チェック（`references/revision-guide.md`）、および `scripts/lint.ts` の `metaphor_verb` / `slop_vocabulary` / `trailing_colon` / `em_dash` / `unnatural_halfwidth_space` / `redundant_bracket` / `sentence_end_repetition` の各検出器は、[yomiyasu](https://github.com/nanaism/yomiyasu) の規範・カタログ・リンターを土台に、当スキルの構成へ再構成したもの。yomiyasu も MIT License（Copyright (c) 2026 nanaism）で公開されている。

```
MIT License

Copyright (c) 2026 nanaism

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
