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
            { regex: /with\s*[\r\n]+\s*([a-zA-Z0-9_]+)\s+as/gi, replacement: 'with $1 as' },
            { regex: /with\s+([a-zA-Z0-9_]+)\s*[\r\n]+\s*as/gi, replacement: 'with $1 as' },
            { regex: /\n(\s{8}|\t{2})/g, replacement: '\n    ' },
        ];

        for (const rule of compactRules) {
            formattedText = formattedText.replace(rule.regex, rule.replacement);
        }

        // --- 2. GROUP BY 单行修复 ---
        const groupByRegex = /(group\s+by[\s\S]*?)(having|order\s+by|limit|;|$)/gi; 
        formattedText = formattedText.replace(groupByRegex, (match: string, content: string, tail: string) => {
            const cleanContent = content.replace(/,\s*[\r\n]+\s*/g, ', ');
            return cleanContent + tail;
        });

        // --- 3. 修复问题一：CTE 间隔和顶格 ---
        
        // 3.1 CTE 之间空一行且顶格
        // 匹配 ), \n [空格] CTE_NAME as
        formattedText = formattedText.replace(/\),\s*[\r\n]+\s*([a-zA-Z0-9_]+)\s+as/g, '),\n\n$1 as');

        // 3.2 顶层 SELECT 顶格且空一行
        // 确保紧跟在 CTE 结束括号后的顶层 select 顶格且上方有空行
        formattedText = formattedText.replace(/\)\s*[\r\n]+\s*(select\s{2})/gi, ')\n\n$1');
        // 兜底处理：如果 select 前面已经被缩进了 (由于 Indentation Fix)
        formattedText = formattedText.replace(/\)\s*[\r\n]+\s*select/gi, ')\n\nselect');

        // 3.3 括号结尾修正
        formattedText = formattedText.replace(/[\r\n]+\s{4}\)/g, '\n)');
        formattedText = formattedText.replace(/[\r\n]+\s{4}\),/g, '\n),');

        // --- 4. 用户自定义正则 ---
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
             editor.edit(eb => eb.replace(fullRange, formatted));
        } else {
            const text = editor.document.getText(selection);
            const formatted = formatLogic(text, config);
            editor.edit(eb => eb.replace(selection, formatted));
        }
    });

    context.subscriptions.push(commandDisposable);
}

export function deactivate() {}
