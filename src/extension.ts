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

        // --- 1. 基础紧凑规则 ---
        const compactRules = [
            { regex: /select\s*[\r\n]+\s*/gi, replacement: 'select  ' },
            { regex: /from\s*[\r\n]+\s*/gi, replacement: 'from ' },
            { regex: /where\s*[\r\n]+\s*/gi, replacement: 'where ' },
            { regex: /having\s*[\r\n]+\s*/gi, replacement: 'having ' },
            { regex: /group\s+by\s*[\r\n]+\s*/gi, replacement: 'group by ' },
            { regex: /order\s+by\s*[\r\n]+\s*/gi, replacement: 'order by ' },
            { regex: /with\s*[\r\n]+\s*([a-zA-Z0-9_]+)\s+as/gi, replacement: 'with $1 as' },
            { regex: /with\s+([a-zA-Z0-9_]+)\s*[\r\n]+\s*as/gi, replacement: 'with $1 as' },
            // 修正全局关键字缩进：将 8-12 格的关键字回归到 4 格 (针对 CTE 内部)
            // 增加 join 到此规则
            { regex: /\n\s{8,12}(select|from|where|group|having|order|limit|join|left|right|inner|full|cross)/gi, replacement: '\n    $1' },
        ];

        for (const rule of compactRules) {
            formattedText = formattedText.replace(rule.regex, rule.replacement);
        }

        // --- 2. 修复问题一：CTE 间隔和顶格 ---
        formattedText = formattedText.replace(/\),\s*(?:[\r\n]+\s*)?([a-zA-Z0-9_]+)\s+as/gi, '),\n\n$1 as');
        formattedText = formattedText.replace(/\)\s*[\r\n]+\s*(select\s{2})/gi, ')\n\n$1');
        formattedText = formattedText.replace(/\)\n\s+select/gi, ')\n\nselect');

        // --- 3. 修复 SELECT 字段对齐与 JOIN 逻辑 ---
        const lines = formattedText.split('\n');
        let finalLines: string[] = [];
        let lastFromOrJoinIndent: number = 0;
        let i = 0;

        while (i < lines.length) {
            let line = lines[i];
            let trimmed = line.trimStart();
            let lowerTrimmed = trimmed.toLowerCase();

            // 记录最近的 FROM 缩进作为 JOIN 基准
            if (lowerTrimmed.startsWith('from ')) {
                const m = line.match(/^(\s*)from/i);
                lastFromOrJoinIndent = m ? m[1].length : 0;
            }

            // 处理 CTE 结束括号 (强制顶格)
            if (trimmed === ')' || trimmed === '),') {
                finalLines.push(trimmed);
                i++;
                continue;
            }

            // 3.1 识别 SELECT 块
            if (lowerTrimmed.startsWith('select  ')) {
                const match = line.match(/^(\s*)select/i);
                const selectIndent = match ? match[1].length : 0;
                
                let blockLines: string[] = [line];
                let j = i + 1;
                while (j < lines.length) {
                    let nextLine = lines[j];
                    let nextTrimmed = nextLine.trimStart().toLowerCase();
                    if (nextTrimmed.startsWith('from ')) break;
                    if (nextTrimmed.startsWith('select ') || nextTrimmed === ')' || nextTrimmed === '),') break;
                    blockLines.push(nextLine);
                    j++;
                }

                if (blockLines.length > 1) {
                    let minFieldIndent = Infinity;
                    for (let k = 1; k < blockLines.length; k++) {
                        if (!blockLines[k].trim()) continue;
                        const m = blockLines[k].match(/^(\s+)/);
                        const indentLen = m ? m[1].length : 0;
                        if (indentLen < minFieldIndent) minFieldIndent = indentLen;
                    }
                    const targetBaseIndent = selectIndent + 8;
                    const delta = (minFieldIndent === Infinity) ? 0 : (targetBaseIndent - minFieldIndent);
                    finalLines.push(blockLines[0]);
                    for (let k = 1; k < blockLines.length; k++) {
                        let bLine = blockLines[k];
                        if (!bLine.trim()) {
                            finalLines.push(bLine);
                            continue;
                        }
                        const m = bLine.match(/^(\s+)/);
                        const currentIndent = m ? m[1].length : 0;
                        finalLines.push(' '.repeat(Math.max(0, currentIndent + delta)) + bLine.trimStart());
                    }
                } else {
                    finalLines.push(blockLines[0]);
                }
                i = j; 
                continue;
            }

            // 3.2 识别 JOIN 块
            const joinMatch = lowerTrimmed.match(/^(?:left\s+|right\s+|inner\s+|full\s+|cross\s+)?join\s+/i);
            if (joinMatch) {
                const joinIndent = lastFromOrJoinIndent;
                // 强制 JOIN 缩进与上一个 FROM/JOIN 一致
                let currentLine = ' '.repeat(joinIndent) + trimmed;
                
                // 如果 ON 在同一行，将其拆分
                if (currentLine.toLowerCase().includes(' on ')) {
                    const parts = currentLine.split(/\s+on\s+/i);
                    finalLines.push(parts[0]); // JOIN 语句
                    finalLines.push(' '.repeat(joinIndent + 4) + 'on ' + parts[1]); // ON 条件
                } else {
                    finalLines.push(currentLine);
                }
                
                lastFromOrJoinIndent = joinIndent; // 更新基准
                i++;
                continue;
            }

            finalLines.push(line);
            i++;
        }
        formattedText = finalLines.join('\n');

        // --- 4. 修复 WHERE 内部对齐 ---
        const wherePassLines = formattedText.split('\n');
        let currentWhereIndent: number | null = null;
        let resultLines: string[] = [];

        for (let k = 0; k < wherePassLines.length; k++) {
            const line = wherePassLines[k];
            const trimmed = line.trimStart();
            const lower = trimmed.toLowerCase();

            if (lower.startsWith('where ')) {
                const match = line.match(/^(\s*)where/i);
                currentWhereIndent = match ? match[1].length : 0;
                resultLines.push(line);
                continue;
            }

            if (currentWhereIndent !== null) {
                if (lower.startsWith('group by') || lower.startsWith('order by') || lower.startsWith('having') || lower.startsWith('limit') || lower.startsWith('select ') || trimmed === ')' || trimmed === '),') {
                    currentWhereIndent = null;
                    resultLines.push(line);
                    continue;
                }

                if (lower.startsWith('and ') || lower.startsWith('or ')) {
                    const m = line.match(/^(\s+)/);
                    const currentIndent = m ? m[1].length : 0;
                    if (currentIndent > currentWhereIndent + 4) {
                        resultLines.push(' '.repeat(currentWhereIndent + 4) + trimmed);
                        continue;
                    }
                }
                const m = line.match(/^(\s+)/);
                const currentIndent = m ? m[1].length : 0;
                if (currentIndent > currentWhereIndent + 4 && !lower.startsWith('case')) {
                     resultLines.push(' '.repeat(currentWhereIndent + 4) + trimmed);
                     continue;
                }
            }
            resultLines.push(line);
        }
        formattedText = resultLines.join('\n');

        // --- 5. 修复嵌套括号块 ---
        const nestedBlockRegex = /((?:and|or|on)\s+\(\s*[\r\n]+)([\s\S]*?)(\n\s*\))/gi;
        formattedText = formattedText.replace(nestedBlockRegex, (match, head, body, tail) => {
            const indentMatch = head.match(/^(\s*)/);
            const headIndent = indentMatch ? indentMatch[1].length : 0;
            const bodyIndent = ' '.repeat(headIndent + 4);
            const indentedBody = body.split('\n').map((line: string) => {
                if (line.trim() === '') return line;
                return bodyIndent + line.trimStart();
            }).join('\n');
            return head + indentedBody + '\n' + ' '.repeat(headIndent) + ')';
        });

        // --- 6. 修复 CASE WHEN (栈模式) ---
        const caseLines = formattedText.split('\n');
        let caseStack: number[] = [];
        let finalCaseLines: string[] = [];

        for (let i = 0; i < caseLines.length; i++) {
            const line = caseLines[i];
            const trimmed = line.trimStart();
            const lowerTrimmed = trimmed.toLowerCase();

            if (lowerTrimmed.startsWith('case')) {
                const match = line.match(/^(\s*)case/i);
                caseStack.push(match ? match[1].length : 0);
                finalCaseLines.push(line);
                continue;
            }

            if (caseStack.length > 0) {
                const currentCaseIndent = caseStack[caseStack.length - 1];
                if (lowerTrimmed.startsWith('end')) {
                    finalCaseLines.push(' '.repeat(currentCaseIndent) + trimmed);
                    caseStack.pop();
                    continue;
                }
                if (lowerTrimmed.startsWith('when ') || lowerTrimmed.startsWith('else ') || lowerTrimmed.startsWith('then ')) {
                    finalCaseLines.push(' '.repeat(currentCaseIndent + 4) + trimmed);
                    continue;
                }
                const m = line.match(/^(\s+)/);
                if (m) {
                    finalCaseLines.push(' '.repeat(currentCaseIndent + 8) + trimmed);
                } else {
                    finalCaseLines.push(line);
                }
            } else {
                finalCaseLines.push(line);
            }
        }
        formattedText = finalCaseLines.join('\n');

        // --- 7. GROUP BY / ON 细节对齐 ---
        // 确保 ON 后的 AND 缩进正确
        // 这是一个比较复杂的后处理，我们通过再次行扫描来微调 ON 块内部的 AND
        const finalSweepLines = formattedText.split('\n');
        let currentOnIndent: number | null = null;
        let finalSweepResult: string[] = [];
        for (let k = 0; k < finalSweepLines.length; k++) {
            const line = finalSweepLines[k];
            const trimmed = line.trimStart();
            if (trimmed.toLowerCase().startsWith('on ')) {
                const m = line.match(/^(\s*)on/i);
                currentOnIndent = m ? m[1].length : 0;
                finalSweepResult.push(line);
                continue;
            }
            if (currentOnIndent !== null) {
                if (trimmed.toLowerCase().startsWith('and ')) {
                    finalSweepResult.push(' '.repeat(currentOnIndent) + trimmed);
                    continue;
                }
                // 退出 ON 块
                if (trimmed.match(/^(join|left|right|inner|full|cross|where|group|order|limit|select|insert|update|delete|union|\)|$),/i)) {
                    currentOnIndent = null;
                }
            }
            finalSweepResult.push(line);
        }
        formattedText = finalSweepResult.join('\n');

        // GROUP BY 单行
        const groupByRegex = /(group\s+by[\s\S]*?)(having|order\s+by|limit|\)|;|$)/gi; 
        formattedText = formattedText.replace(groupByRegex, (match: string, content: string, tail: string) => {
            const cleanContent = content.replace(/,\s*[\r\n]+\s*/g, ', ');
            return cleanContent + tail;
        });

        // --- 用户自定义正则 ---
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
            const fullRange = new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
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
        if (!editor) return;
        const selection = editor.selection;
        const config = vscode.workspace.getConfiguration('sql-beautify');
        
        if (selection.isEmpty) {
             const text = editor.document.getText();
             const formatted = formatLogic(text, config);
             const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(text.length));
             editor.edit(editBuilder => {
                 editBuilder.replace(fullRange, formatted);
             });
        } else {
            const text = editor.document.getText(selection);
            const formatted = formatLogic(text, config);
            editor.edit(editBuilder => {
                editBuilder.replace(selection, formatted);
            });
        }
    });

    context.subscriptions.push(commandDisposable);
}

export function deactivate() {}
