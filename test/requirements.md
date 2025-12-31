# 文件说明
`sample.sql`: 一段待格式化的sql代码
`output.sql`: 目前插件格式化后的结果
`expect.sql`: 我所期望的结果

你的目标就是使得修改过后的插件，在`sample.sql`上格式化后的结果与`expect.sql`保持完全一致。

# 格式化规范
## CTE别名缩进
- 假设同时存在多个CTE, 每一个CTE都要与上一个CTE结束的括号之间空开一行, 并且每个CTE的名字都需要顶格
- 对于最后的select语句块，select关键字需要顶格，且与上一个CTE结束的括号之间空开一行
- CTE内部的select语句，要求
  - select关键字后空两格, 然后接第一个字段
  - 如果有多个字段，则每个字段需要单独处于一行，且与前后字段严格保持左端对齐（换句话说，从第二个select字段起，他们的缩进深度应该比这个CTE内部的select关键字的缩进深度多出8格。

## and / or代码块
假设一个and / or语句中出现多个and和or子条件的嵌套, 则需要使用()将它们括起来，并且:
- 每个子条件需要单独处于一行, 且缩进深度需要比外部的and/or关键字多4格
- 括号的结尾")"需要与外层的or关键字(或者是and关键字)处于相同的缩进深度

## case when的规范
默认标准写法为
case
    when ... then ...
    when ... then ...
    else ...
end
即：
- case和end左对齐
- 内部的每一个when占据单独一行，且when语句的缩进深度比case和end要多出4格


# 目前存在的问题
## 1. 多个CTE的空行和缩进问题
- 第二个CTE和第一个CTE之间没有空一行
- 第二个CTE没有顶格书写

## 2. CTE内部的select缩进问题
- 注意现在第一个CTE内部的select缩进是完全正确的！！！但是第二个CTE内部的select缩进有问题：从第二个select字段起，每个select字段的缩进深度应该比这个CTE内部的select关键字的缩进深度多出8格。以我们的sample中的第二个CTE（media_cnt as ...）为例，select的缩进格数是4，因此select的那些sum函数的缩进格数应该是12格，而不是现在的8格
  - 同时需要注意，现在sum内部的case when的相对缩进是正确的，需要保留

## 3. where条件中的and和or缩进不规范
结尾的where中，or语句块的)缺少缩进，需要和or关键词对齐，且内部的条件语句需要整体缩进4格

## 4. select中的case when缩进不规范
这里的case when也需要保持相对缩进规范，可以参考第二个CTE内部的case when写法，那个很标准