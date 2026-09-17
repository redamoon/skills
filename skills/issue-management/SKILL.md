---
name: Issue管理スキル
description: GitHub Issueの作成・親Issue（エピック）への紐づけ・孤立Issueの棚卸しを行います。本文の「## 決定」節を正本として保ち、更新履歴はコメントに残します。「Issueを作って」「親Issueに紐づけて」「親を持たないIssueを一覧化して」と依頼されたときに使用します。
license: MIT
---

# Issue管理スキル

このスキルは、Issueそのものの整備（作成・親子付け・棚卸し）を扱います。Sub-issueの指示文の中身を書くときは `sub-issue-instruction-template` スキルを使います。

## When to Use

- 新しいIssueを作成するとき
- Issueに親Issue（エピック）を紐づけるとき
- 親を持たない、宙に浮いたIssueを洗い出したいとき
- 既存Issueの本文を更新するとき

## Instructions

### 親Issue（エピック）への紐づけ

Issue作成時、親となるエピックがある場合は、本文に「## 親Issue（エピック）」セクションを設け、番号を記載します。

```markdown
## 親Issue（エピック）
#123
```

本文にリンクを書くだけでは、GitHub上の親子関係（Sub-issue登録）にはなりません。GitHub CLIやAPI経由で明示的に登録します。作成をUI経由で行う場合も、テンプレートにこの記法を仕込んでおけば、後続の自動化から親番号を拾えます。

### 本文とコメントの役目を分ける

Issueの現在の結論は、本文の「## 決定」節が正本です。コメントは経緯であり、本文の記述を上書きする力を持ちません。

既存Issueの本文を更新するときは、次を守ります。

- 本文は常に最新状態だけを残す
- 変更履歴（更新日・変更した箇所・変更理由）はコメントに残す

「## 決定」節がまだない古いIssueを読むときは、コメントも全件読みます。最終的な決定が、本文ではなくコメント側にしか残っていない場合があるためです。

### 孤立Issueの棚卸し

親を持たない、宙に浮いたIssueを定期的に洗い出します。GraphQL APIで、`parent`が存在しないOPEN issueを列挙できます。

```bash
gh api graphql -f query='
query {
  repository(owner: "OWNER", name: "REPO") {
    issues(first: 100, states: OPEN) {
      nodes {
        number
        title
        url
        parent {
          id
        }
      }
    }
  }
}' --jq '.data.repository.issues.nodes[] | select(.parent == null) | "\(.number) \(.title) \(.url)"'
```

洗い出したIssueは、適切なエピックに紐づけるか、単独のIssueとして扱うかを人間が判断します。

## よくある問題

### コメントの内容を正として扱ってしまう

本文の「## 決定」節を更新せずコメントだけに新しい決定を書くと、次に読んだ人が古い本文の記述を正しいと誤解します。決定が変わったら、必ず本文の「## 決定」節を更新します。

### エピックへの紐づけを忘れる

本文にリンクを書いただけで満足すると、GitHub上は親子関係になっていません。addSubIssueの仕組み、またはGitHub CLI/APIで明示的に登録します。

## 参考資料

- [Adding sub-issues - GitHub Docs](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues)
