const { format } = require('sql-formatter');
const fs = require('fs');
const path = require('path');

const workspaceRoot = '/Users/lilithgames/sql-beautify';
const samplePath = path.join(workspaceRoot, 'test/sample.sql');
const sampleSql = fs.readFileSync(samplePath, 'utf8');

const config = {
    dialect: 'sql',
    uppercase: false,
    indent: '    ',
    customRules: []
};

function formatLogic(text) {
    const dialect = config.dialect || 'sql';
    const uppercase = config.uppercase;
    const indent = config.indent || '    ';
    
    let formattedText = text;

    try {
        const indentOptions = {};
        if (indent === '\t') {
            indentOptions.useTabs = true;
        } else {
            indentOptions.tabWidth = indent.length;
        }

        formattedText = format(text, {
            language: dialect,
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
    let currentSelectIndent = null;
    const newLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trimStart();

        if (trimmedLine.toLowerCase().startsWith('select  ')) {
            const match = line.match(/^(\s*)select/i);
            currentSelectIndent = match ? match[1].length : 0;
            newLines.push(line);
            continue;
        }

        if (currentSelectIndent !== null) {
            if (trimmedLine.toLowerCase().startsWith('from ') || trimmedLine.toLowerCase().startsWith(')')) {
                const indentStr = ' '.repeat(currentSelectIndent);
                newLines.push(indentStr + trimmedLine);
                currentSelectIndent = null;
                continue;
            }

            if (line.trim() === '') {
                newLines.push(line);
                continue;
            }

            const match = line.match(/^(\s+)/);
            const originalIndent = match ? match[1].length : 0;
            const targetIndent = currentSelectIndent + 8 + (originalIndent - (currentSelectIndent + 4));
            newLines.push(' '.repeat(Math.max(0, targetIndent)) + trimmedLine);
        } else {
            newLines.push(line);
        }
    }
    formattedText = newLines.join('\n');

    // --- 4. 括号结尾修正 ---
    formattedText = formattedText.replace(/[\r\n]+\s+\)/g, '\n)');
    formattedText = formattedText.replace(/[\r\n]+\s+\),/g, '\n),');

    // --- 5. GROUP BY 单行修复 ---
    const groupByRegex = /(group\s+by[\s\S]*?)(having|order\s+by|limit|;|$)/gi; 
    formattedText = formattedText.replace(groupByRegex, (match, content, tail) => {
        const cleanContent = content.replace(/,\s*[\r\n]+\s*/g, ', ');
        return cleanContent + tail;
    });

    return formattedText;
}

const result = formatLogic(sampleSql);
console.log('--- OUTPUT START ---');
console.log(result);
console.log('--- OUTPUT END ---');
