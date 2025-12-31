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
            // 全局 Dedent 修正：将 8 格缩进降低到 4 格（主要针对 CTE 内容）
            { regex: /\n\s{8}/g, replacement: '\n    ' },
        ];

        for (const rule of compactRules) {
            formattedText = formattedText.replace(rule.regex, rule.replacement);
        }

        // --- 2. 修复问题一：CTE 间隔和顶格 ---
        formattedText = formattedText.replace(/\),\s*[\r\n]+\s*([a-zA-Z0-9_]+)\s+as/g, '),\n\n$1 as');
        formattedText = formattedText.replace(/\)\s*[\r\n]+\s*(select\s{2})/gi, ')\n\n$1');
        formattedText = formattedText.replace(/\)\n\s+select/gi, ')\n\nselect');

        // --- 3. 修复问题二：所有 Select 字段对齐 (S + 8) ---
        const lines = formattedText.split('\n');
        let currentSelectIndent: number | null = null;
        let resultLines: string[] = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmedLine = line.trimStart();

            // 检测 SELECT 块开始
            if (trimmedLine.toLowerCase().startsWith('select  ')) {
                const match = line.match(/^(\s*)select/i);
                currentSelectIndent = match ? match[1].length : 0;
                resultLines.push(line);
                continue;
            }

            // 在 SELECT 块内部
            if (currentSelectIndent !== null) {
                // 检测块结束 (遇到 FROM 或 CTE 结束括号)
                if (trimmedLine.toLowerCase().startsWith('from ') || trimmedLine === ')') {
                    const indentStr = ' '.repeat(currentSelectIndent);
                    resultLines.push(indentStr + trimmedLine);
                    currentSelectIndent = null;
                    continue;
                }

                if (line.trim() === '') {
                    resultLines.push(line);
                    continue;
                }

                // 计算对齐缩进
                const match = line.match(/^(\s+)/);
                const originalIndent = match ? match[1].length : 0;
                
                // 默认偏移公式：selectIndent + 8 (保留原有相对缩进差异)
                // 假设原本字段层级是 selectIndent + 4
                const baseFieldIndent = currentSelectIndent + 4;
                const targetIndent = currentSelectIndent + 8 + (originalIndent - baseFieldIndent);
                
                resultLines.push(' '.repeat(Math.max(0, targetIndent)) + trimmedLine);
            } else {
                resultLines.push(line);
            }
        }
        formattedText = resultLines.join('\n');

        // --- 4. 修复问题三：WHERE 中的 AND/OR ---
        // 目标：将 or ( 后的内容缩进加深
        formattedText = formattedText.replace(/((?:and|or)\s+\(\s*[\r\n]+)\s{4}(\S)/gi, '$1        $2');
        formattedText = formattedText.replace(/(\n\s{4})(and|or)\b/gi, '$1    $2');

        // --- 5. 修复问题四：CASE WHEN 内部缩进与 THEN 换行 ---
        // 5.1 WHEN 语句缩进修正
        // 5.2 THEN 换行
        formattedText = formattedText.replace(/(\s+when[\s\S]*?)\s+then\s+/gi, (match: string, whenPart: string) => {
            const lines = whenPart.split('\n');
            const lastLine = lines[lines.length - 1];
            const indentMatch = lastLine.match(/^(\s+)/);
            const baseIndent = indentMatch ? indentMatch[1] : '            ';
            return whenPart + '\n' + baseIndent + 'then ';
        });

        // --- 6. 结尾对齐修复 ---
        // CTE 结束括号顶格
        formattedText = formattedText.replace(/[\r\n]+\s{4,8}\)/g, '\n)');
        formattedText = formattedText.replace(/[\r\n]+\s{4,8}\),/g, '\n),');

        // GROUP BY 单行
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
