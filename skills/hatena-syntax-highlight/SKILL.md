---
name: hatena-syntax-highlight
description: はてなブログのMarkdownモードでコードブロックのシンタックスハイライトを使用する際の記法ルールとベストプラクティス。
license: MIT
---

# はてなブログ シンタックスハイライト スキル

## When to Use

- はてなブログ（Markdownモード）の記事でコードブロックを記述・編集する際
- はてなブログ向け記事のコードブロックに言語指定を付ける・直す際
- はてなブログでシンタックスハイライトが効いていない・意図と違う表示になっているとき

## Instructions

### シンタックスハイライト

はてなブログでは、コードブロックのシンタックスハイライトに対応しています。

**Markdownモードでの記法：**

```perl
my $name = "Hatena";
print "Hello, $name\n";
```

上記のように、コードブロックの開始部分で言語を指定することで、その言語に応じたシンタックスハイライトが適用されます。

### 対応言語

はてなブログは500以上のファイルタイプ（プログラミング言語）に対応しています。主な言語例：

- `perl`, `python`, `ruby`, `javascript`, `typescript`, `java`, `go`, `rust`, `php`, `c`, `cpp`, `csharp`, `swift`, `kotlin`, `dart`, `elixir`, `crystal`, `nim`, `zig`, `jsx`, `tsx`, `terraform`, `hcl`, `toml`, `yaml`, `json`, `html`, `css`, `sql`, `bash`, `sh`, `zsh`, `markdown`, `dockerfile` など

### 注意事項

- コードブロックは必ず行頭から記述する
- 言語名は小文字で指定する（例：`javascript`、`typescript`）
- はてな記法のスーパーpre記法（`>||言語名||`）も使用可能だが、Markdownモードでは上記の記法を推奨

詳細は[はてなブログ ヘルプ - シンタックスハイライト](https://help.hatenablog.com/entry/markup/syntaxhighlight)を参照してください。
