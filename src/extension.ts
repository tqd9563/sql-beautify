import * as vscode from 'vscode';
import { format } from 'sql-formatter';

interface CustomRule {
    regex: string;
    replacement: string;
    flags?: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "sql-beautify" is now active!');

    const formatLogic = (text: string, config: vscode.WorkspaceConfiguration) => {
        const dialect = config.get<string>('dialect') || 'sql';
        const uppercase = config.get<boolean>('uppercase');
        const indent = config.get<string>('indent') || '    '; 
        const customRules = config.get<CustomRule[]>('customRules') || [];

        let formattedText = text;

        try {
            const indentOptions: any = {};
            if (indent === '\t') {
                indentOptions.useTabs = true;
            } else {
                indentOptions.tabWidth = indent.length;
            }

            formattedText = format(text, {
                language: dialect as any,
                keywordCase: uppercase ? 'upper' : 'preserve',
                ...indentOptions,
                linesBetweenQueries: 2,
            });
        } catch (e) {
            console.error('SQL Formatter Error:', e);
            return text; 
        }

        const compactRules = [
            // 1. SELECT: 2 spaces, no newline
            { regex: /select\s*[\r\n]+\s*/gi, replacement: 'select  ' },
            // 2. FROM: 1 space, no newline
            { regex: /from\s*[\r\n]+\s*/gi, replacement: 'from ' },
            // 3. WHERE: 1 space, no newline
            { regex: /where\s*[\r\n]+\s*/gi, replacement: 'where ' },
            // 4. HAVING: 1 space, no newline
            { regex: /having\s*[\r\n]+\s*/gi, replacement: 'having ' },
            // 5. GROUP BY: 1 space, no newline
            { regex: /group\s+by\s*[\r\n]+\s*/gi, replacement: 'group by ' },
            // 6. WITH: 1 space, join with alias + as
            { regex: /with\s*[\r\n]+\s*([a-zA-Z0-9_]+)\s+as/gi, replacement: 'with $1 as' },
            { regex: /with\s+([a-zA-Z0-9_]+)\s*[\r\n]+\s*as/gi, replacement: 'with $1 as' },
            
            // 7. Indentation Fix (Global 8->4 space dedent)
            { regex: /\n(\s{8}|\t{2})/g, replacement: '\n    ' },
        ];

        for (const rule of compactRules) {
            formattedText = formattedText.replace(rule.regex, rule.replacement);
        }

        // --- GROUP BY 单行修复逻辑 ---
        const groupByRegex = /(group\s+by[\s\S]*?)(having|order\s+by|limit|;|$)/i;
        const match = formattedText.match(groupByRegex);
        if (match) {
            const fullBlock = match[0]; 
            const content = match[1];   
            const tail = match[2];     
            const cleanContent = content.replace(/,\s*[\r\n]+\s*/g, ', ');
            const newBlock = cleanContent + tail;
            formattedText = formattedText.replace(fullBlock, newBlock);
        }

        // --- SELECT 字段对齐修复 ---
        // 修正逻辑：
        // 之前的 output 中，字段缩进是 8 空格 (select ... \n        acc_create_os)。
        // 我们的目标是 12 空格 (select  ... \n            acc_create_os)。
        // 但是最新的 output 显示变成了：
        // select  media_src,
        //                 acc_create_os, (16空格？)
        //             from ... (12空格？)
        // 
        // 原因：之前的逻辑 `content.replace(/\n\s{4}/g, '\n            ')` 
        // 可能是因为在上一步 `Indentation Fix` 之后，缩进确实变成了 4 空格。
        // 但是，如果 `sql-formatter` 输出的结构比较复杂，或者我们之前的 fix 导致了缩进混乱。
        // 
        // 让我们重新审视 output.sql (上次失败的结果):
        // 3|                acc_create_os,  <-- 这里缩进非常深，可能有 16 个空格？
        // 4|                sum(acc_create_count) as create_cnt
        // 5|            from ...
        // 
        // 这说明我的正则替换太激进，或者基础缩进判断错了。
        // 
        // 新策略：
        // 1. 我们不再盲目替换 `\n\s{4}`，因为这会误伤 `from` 语句（因为 `from` 也可能缩进了 4 格）。
        // 2. 我们只针对 `select` 列表中的行进行缩进调整。
        //    如何识别 select 列表？即 `select` 开始，到 `from` 结束之间的内容。
        //    在这个区间内，除了第一行（包含 select），其他行都应该是字段。
        //    但是，最后一行的 `from` 可能会紧跟在字段后面（如果没有换行），或者在新行。
        //    在我们的 compactRules 中，from 被强制到了行首（如果前面有换行）。
        // 
        // 让我们精确控制：
        // 找到 select 块。
        // 遍历其中的每一行。
        // 如果行以空白开头，并且不是 `from` 关键字开头，那么它就是字段行。
        // 强制设置字段行的缩进为 12 空格。
        // 如果行是 `from`，确保它缩进为 4 空格。

        const selectRegex = /(select\s{2}[\s\S]*?)(from)/i;
        const selectMatch = formattedText.match(selectRegex);
        if (selectMatch) {
            const fullBlock = selectMatch[0]; 
            const content = selectMatch[1];   
            const tail = selectMatch[2];      

            // 分割 content 为多行
            const lines = content.split('\n');
            const newLines = lines.map((line, index) => {
                if (index === 0) return line; // 第一行是 'select  xxx'，不动
                
                // 检查是否是空行
                if (!line.trim()) return line;

                // 字段行：强制缩进 12 空格
                // 去掉原有的缩进，加上 12 空格
                return '            ' + line.trimStart();
            });

            const alignedContent = newLines.join('\n');
            
            // 确保 tail (from) 前面有正确的缩进 (4空格)
            // 但是 tail 只是 'from' 字符串，我们需要看它在 formattedText 中的上下文。
            // 在我们的正则中，fullBlock 是 select...from。
            // 替换回去时，from 前面的换行符包含在 content 的末尾吗？
            // regex: (select...)(from).
            // content 包含了 select 到 from 之前的所有字符，包括最后一个字段后的换行符（如果有）。
            // 如果 content 结尾是 \n，那么 alignedContent 结尾也是 \n。
            // 那么 from 就会紧跟 \n。
            // 我们希望 from 缩进 4 空格。
            // 所以 tail 应该变成 '    from' ? 
            // 不，from 前面的缩进可能已经在 content 的最后一行了？
            // 不，split('\n') 会把最后一行（如果是空行或者包含空白）保留。
            
            // 让我们看看实际情况。
            // output.sql:
            // ...
            // sum(...) as create_cnt
            // from ...
            // 
            // content 结束于 `create_cnt\n    ` (假设有缩进)。
            // tail 是 `from`。
            // 
            // 修正：我们把 `tail` 改为 `    from` (4空格)。
            // 并在 alignedContent 结尾去掉可能存在的额外缩进？
            // 或者更简单：我们不把 `from` 包含在正则组里，只匹配 `select ...` 直到 `from` 前面。
            // regex: `/(select\s{2}[\s\S]*?)(\s+from)/i` ?
            
            // 让我们保持简单的 `replace` 逻辑，但对 `tail` 做处理。
            // 注意：如果 `from` 前面没有换行（Compact Mode），我们不应该加换行。
            // 但我们的 Compact Rules 2 已经处理了 `from`。
            // 
            // 实际上，问题出在之前的 `replace(/\n\s{4}/g, ...)` 把 `\n    from` 也给替换了。
            // 现在我们要避免这种情况。
            
            // 重组 fullBlock
            // 注意：tail 是 "from"。我们需要确保它前面是 4 空格（如果是新行）。
            // 但在上面的 map 逻辑里，最后一行（如果是 from 前面的缩进）会被处理成 12 空格。
            // 比如 `\n    ` -> `\n            `。
            // 这样 `from` 就变成了 12 空格缩进。这就解释了为什么 `from` 也多缩进了。
            
            // 解决：在 map 里面判断，如果这一行全是空白（且是最后一行），或者这一行后面紧跟 from...
            // 其实，split 后的数组，最后一行如果只是缩进，它也是一行。
            // 
            // 我们可以直接操作 alignedContent 字符串。
            // 如果 alignedContent 结尾是空白，把它改成 4 空格。
            let finalContent = alignedContent;
            if (finalContent.match(/\s+$/)) {
                 finalContent = finalContent.replace(/\s+$/, '\n    ');
            }

            const newBlock = finalContent + tail;
            formattedText = formattedText.replace(fullBlock, newBlock);
        }

        // --- CTE 结尾括号修复 ---
        formattedText = formattedText.replace(/[\r\n]+\s{4}\)/g, '\n)');
        formattedText = formattedText.replace(/[\r\n]+\s{4}\),/g, '\n),');

        // --- 用户自定义正则后处理 ---
        for (const rule of customRules) {
            if (rule.regex) {
                try {
                    const flags = rule.flags || 'gm';
                    const re = new RegExp(rule.regex, flags);
                    formattedText = formattedText.replace(re, rule.replacement || '');
                } catch (e) {
                    console.error(`Invalid Regex Rule: ${rule.regex}`, e);
                }
            }
        }
        
        return formattedText;
    };

    const docProvider = vscode.languages.registerDocumentFormattingEditProvider('sql', {
        provideDocumentFormattingEdits(document: vscode.TextDocument): vscode.TextEdit[] {
            const config = vscode.workspace.getConfiguration('sql-beautify');
            const formatted = formatLogic(document.getText(), config);
            const fullRange = new vscode.Range(
                document.positionAt(0),
                document.positionAt(document.getText().length)
            );
            return [vscode.TextEdit.replace(fullRange, formatted)];
        }
    });

    const rangeProvider = vscode.languages.registerDocumentRangeFormattingEditProvider('sql', {
        provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range): vscode.TextEdit[] {
            const config = vscode.workspace.getConfiguration('sql-beautify');
            const text = document.getText(range);
            const formatted = formatLogic(text, config);
            return [vscode.TextEdit.replace(range, formatted)];
        }
    });

    context.subscriptions.push(docProvider, rangeProvider);

    const commandDisposable = vscode.commands.registerCommand('sql-beautify.helloWorld', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const selection = editor.selection;
        if (selection.isEmpty) {
             const text = editor.document.getText();
             const config = vscode.workspace.getConfiguration('sql-beautify');
             const formatted = formatLogic(text, config);
             const fullRange = new vscode.Range(
                editor.document.positionAt(0),
                editor.document.positionAt(text.length)
             );
             editor.edit(editBuilder => {
                 editBuilder.replace(fullRange, formatted);
             });
             return;
        }

        const text = editor.document.getText(selection);
        const config = vscode.workspace.getConfiguration('sql-beautify');
        const formatted = formatLogic(text, config);

        editor.edit(editBuilder => {
            editBuilder.replace(selection, formatted);
        });
    });

    context.subscriptions.push(commandDisposable);
}

export function deactivate() {}
