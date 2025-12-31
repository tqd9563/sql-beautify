# <div align="center">Lilith Antifraud SQL Beautify</div>

![Typescript version](https://img.shields.io/badge/typescript-5.7.2-blue.svg) ![Vscode version](https://img.shields.io/badge/vscode-1.105.0-blue.svg) ![Version](https://img.shields.io/badge/version-0.0.1-green.svg)

## 简介
基于SQL-Formatter魔改的自定义SQL格式化插件(Lilith反欺诈团队内部使用)

## 使用
全选SQL代码，然后`cmd+shift+p`打开命令面板，最后输入命令`Antifradu SQL Beautify: Go Go Go`即可

## 特性

- global style
  - 关键字全小写
  - 缩进标准为4 spaces
- select
  - select后的第一个字段与select保持同一行，中间空两格空格；
  - 其余字段保持独立一行一个，且所有字段保持左对齐
- where
  - where语句内的and关键字其，缩进层级统一为”比where多4格“。
- join
  - join的缩进层级与前一个from关键字，或是前一个join关键字保持一致
  - join的条件语句（即on和and关键字），与join分处不同的行，每一个条件单独位于一行，且整体缩进相较于join关键字要多4 spaces
- other key words
  - /from/join/where/group by/order by 等关键字后先接空格 + 字段名/表名
- case when
  - case和end左对齐
  - 内部的每一个when占据单独一行，且when语句的缩进深度比case和end要多出4格
- CTE
  - 多个CTE之间需要空行隔开，且CTE的表名需顶格
  - CTE内部的整个select代码块，整体缩进4格（相较于CTE的表名）