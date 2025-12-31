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
            // 修正全局缩进：sql-formatter 在 CTE 内部有时会过度缩进关键字
            { regex: /\n\s{8,12}(select|from|where|group|having|order|limit)/gi, replacement: '\n    $1' },
        ];

        for (const rule of compactRules) {
            formattedText = formattedText.replace(rule.regex, rule.replacement);
        }

        // --- 2. 修复问题一：CTE 间隔和顶格 ---
        formattedText = formattedText.replace(/\),\s*[\r\n]+\s*([a-zA-Z0-9_]+)\s+as/g, '),\n\n$1 as');
        formattedText = formattedText.replace(/\)\s*[\r\n]+\s*(select\s{2})/gi, ')\n\n$1');
        formattedText = formattedText.replace(/\)\n\s+select/gi, ')\n\nselect');

        // --- 3. 核心修复逻辑：块级处理 (处理 Select 字段对齐) ---
        const lines = formattedText.split('\n');
        let finalLines: string[] = [];
        let i = 0;

        while (i < lines.length) {
            let line = lines[i];
            let trimmed = line.trimStart();
            let lowerTrimmed = trimmed.toLowerCase();

            // 3.1 处理 CTE 结束括号 (强制顶格)
            if (trimmed === ')' || trimmed === '),') {
                finalLines.push(trimmed);
                i++;
                continue;
            }

            // 3.2 识别 SELECT 块开始
            if (lowerTrimmed.startsWith('select  ')) {
                const match = line.match(/^(\s*)select/i);
                const selectIndent = match ? match[1].length : 0;
                
                // 收集整个 SELECT 块直到遇到 FROM
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
                    // 找到块内字段行的最小缩进
                    let minFieldIndent = Infinity;
                    for (let k = 1; k < blockLines.length; k++) {
                        if (!blockLines[k].trim()) continue;
                        const m = blockLines[k].match(/^(\s+)/);
                        const indentLen = m ? m[1].length : 0;
                        if (indentLen < minFieldIndent) minFieldIndent = indentLen;
                    }

                    // 计算目标对齐偏移 (selectIndent + 8)
                    const targetBaseIndent = selectIndent + 8;
                    const delta = (minFieldIndent === Infinity) ? 0 : (targetBaseIndent - minFieldIndent);

                    finalLines.push(blockLines[0]); // 第一行 select 原样
                    for (let k = 1; k < blockLines.length; k++) {
                        let bLine = blockLines[k];
                        if (!bLine.trim()) {
                            finalLines.push(bLine);
                            continue;
                        }
                        const m = bLine.match(/^(\s+)/);
                        const currentIndent = m ? m[1].length : 0;
                        const newIndent = Math.max(0, currentIndent + delta);
                        finalLines.push(' '.repeat(newIndent) + bLine.trimStart());
                    }
                } else {
                    finalLines.push(blockLines[0]);
                }

                i = j; 
                continue;
            }

            finalLines.push(line);
            i++;
        }
        formattedText = finalLines.join('\n');

        // --- 4. 修复问题三：WHERE 中的 AND/OR 嵌套 ---
        const nestedWhereRegex = /((?:and|or)\s+\(\s*[\r\n]+)([\s\S]*?)(\n\s*\))/gi;
        formattedText = formattedText.replace(nestedWhereRegex, (match, head, body, tail) => {
            const indentMatch = head.match(/^(\s*)/);
            const headIndent = indentMatch ? indentMatch[1].length : 0;
            const bodyIndent = ' '.repeat(headIndent + 4);
            
            const indentedBody = body.split('\n').map((line: string) => {
                if (line.trim() === '') return line;
                return bodyIndent + line.trimStart();
            }).join('\n');
            
            return head + indentedBody + '\n' + ' '.repeat(headIndent) + ')';
        });

        // --- 5. 修复问题四：CASE WHEN 内部格式精修 ---
        const caseLines = formattedText.split('\n');
        let caseStack: number[] = [];
        let resultLines: string[] = [];

        for (let i = 0; i < caseLines.length; i++) {
            const line = caseLines[i];
            const trimmed = line.trimStart();
            const lowerTrimmed = trimmed.toLowerCase();

            if (lowerTrimmed.startsWith('case')) {
                const match = line.match(/^(\s*)case/i);
                caseStack.push(match ? match[1].length : 0);
                resultLines.push(line);
                continue;
            }

            if (caseStack.length > 0) {
                const currentCaseIndent = caseStack[caseStack.length - 1];

                if (lowerTrimmed.startsWith('end')) {
                    resultLines.push(' '.repeat(currentCaseIndent) + trimmed);
                    caseStack.pop();
                    continue;
                }

                if (lowerTrimmed.startsWith('when ') || lowerTrimmed.startsWith('else ') || lowerTrimmed.startsWith('then ')) {
                    resultLines.push(' '.repeat(currentCaseIndent + 4) + trimmed);
                    continue;
                }
                
                const m = line.match(/^(\s+)/);
                if (m) {
                    resultLines.push(' '.repeat(currentCaseIndent + 8) + trimmed);
                } else {
                    resultLines.push(line);
                }
            } else {
                resultLines.push(line);
            }
        }
        formattedText = resultLines.join('\n');

        // --- 6. GROUP BY 单行修复 ---
        const groupByRegex = /(group\s+by[\s\S]*?)(having|order\s+by|limit|;|$)/gi; 
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
