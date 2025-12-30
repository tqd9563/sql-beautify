import * as vscode from 'vscode';
import { format } from 'sql-formatter';

interface CustomRule {
    regex: string;
    replacement: string;
    flags?: string;
}

export function activate(context: vscode.ExtensionContext) {
    console.log('Extension "sql-beautify" is now active!');

    // --- 核心格式化逻辑 ---
    const formatLogic = (text: string, config: vscode.WorkspaceConfiguration) => {
        const dialect = config.get<string>('dialect') || 'sql';
        const uppercase = config.get<boolean>('uppercase');
        const indent = config.get<string>('indent') || '  ';
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
            });
        } catch (e) {
            console.error('SQL Formatter Error:', e);
            // 格式化失败返回原文或空，这里返回原文意味着不做更改
            return text; 
        }

        // 2. 正则表达式后处理 (魔改逻辑)
        for (const rule of customRules) {
            if (rule.regex) {
                try {
                    const flags = rule.flags || 'gm';
                    // 处理转义字符，JSON 配置中的字符串也是转义过的
                    const re = new RegExp(rule.regex, flags);
                    formattedText = formattedText.replace(re, rule.replacement || '');
                } catch (e) {
                    console.error(`Invalid Regex Rule: ${rule.regex}`, e);
                }
            }
        }
        
        return formattedText;
    };

    // --- 1. 注册全文格式化 ---
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

    // --- 2. 注册选区格式化 (Format Selection) ---
    const rangeProvider = vscode.languages.registerDocumentRangeFormattingEditProvider('sql', {
        provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range): vscode.TextEdit[] {
            const config = vscode.workspace.getConfiguration('sql-beautify');
            const text = document.getText(range); // 只获取选中的文本
            const formatted = formatLogic(text, config);
            
            return [vscode.TextEdit.replace(range, formatted)];
        }
    });

    context.subscriptions.push(docProvider, rangeProvider);

    // --- 3. (可选) 修改 Hello World 命令为手动格式化选中内容 ---
    const commandDisposable = vscode.commands.registerCommand('sql-beautify.helloWorld', () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const selection = editor.selection;
        // 如果没有选中任何文本，则尝试格式化全文，或者提示用户
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
