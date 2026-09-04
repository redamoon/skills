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
