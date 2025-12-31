# 文件说明
`sample.sql`: 一段待格式化的sql代码
`output.sql`: 目前插件格式化后的结果
`expect.sql`: 我所期望的结果

你的目标就是使得修改过后的插件，在`sample.sql`上格式化后的结果与`expect.sql`保持完全一致。

# 目前的核心差异点
## select字段未对齐
我要求在所有的CTE内部，每一个select的字段单独处于一行，并且前后字段保持左端对齐。

## CTE的结尾括号问题
结尾的括号现在有缩进四格，但是我要求它需要比CTE内部的select领先四格