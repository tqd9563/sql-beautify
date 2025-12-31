const { format } = require('sql-formatter');
const fs = require('fs');
const path = require('path');

const workspaceRoot = '/Users/lilithgames/sql-beautify';
const samplePath = path.join(workspaceRoot, 'test/group1/sample.sql');
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

    // --- 0. 预处理 ---
    // 确保 case 始终在新的一行
    formattedText = formattedText.replace(/,\s*case\b/gi, ',\ncase');

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
        // 我们暂时禁用这个全局 Dedent，因为它会干扰我们的精确控制
        // { regex: /\n\s{8}/g, replacement: '\n    ' },
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
    let resultLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trimStart();

        // 顶格处理 CTE 结束括号
        if (trimmedLine === ')' || trimmedLine === '),') {
            resultLines.push(trimmedLine);
            currentSelectIndent = null;
            continue;
        }

        if (trimmedLine.toLowerCase().startsWith('select  ')) {
            const match = line.match(/^(\s*)select/i);
            currentSelectIndent = match ? match[1].length : 0;
            resultLines.push(line);
            continue;
        }

        if (currentSelectIndent !== null) {
            if (trimmedLine.toLowerCase().startsWith('from ')) {
                const indentStr = ' '.repeat(currentSelectIndent);
                resultLines.push(indentStr + trimmedLine);
                currentSelectIndent = null;
                continue;
            }

            if (line.trim() === '') {
                resultLines.push(line);
                continue;
            }

            const match = line.match(/^(\s+)/);
            const originalIndent = match ? match[1].length : 0;
            
            // 找出 select 后面应该缩进的基准。
            // 假设 sql-formatter 对于顶层 select (0格) 的字段缩进是 4 格。
            // 对于 CTE 内部 select (8格) 的字段缩进是 12 格。
            // 规律是：字段缩进 = select缩进 + 4 (sql-formatter 默认)
            // 我们的目标是：字段缩进 = select缩进 + 8
            
            // 我们需要先知道这个 select 关键字在 sql-formatter 输出中实际的缩进。
            // 但在这里我们已经做了一些替换。
            
            // 我们可以假设：如果 trimmedLine 开始于 case/sum/column，
            // 且 originalIndent > currentSelectIndent，那么它就是一个字段行。
            
            if (originalIndent > currentSelectIndent) {
                 const targetIndent = currentSelectIndent + 8 + (originalIndent - (currentSelectIndent + 4));
                 resultLines.push(' '.repeat(Math.max(0, targetIndent)) + trimmedLine);
            } else {
                 resultLines.push(line);
            }
        } else {
            resultLines.push(line);
        }
    }
    formattedText = resultLines.join('\n');

    // --- 4. 修复问题三：WHERE 中的 AND/OR ---
    const nestedWhereRegex = /((?:and|or)\s+\(\s*[\r\n]+)([\s\S]*?)(\n\s*\))/gi;
    formattedText = formattedText.replace(nestedWhereRegex, (match, head, body, tail) => {
        const indentMatch = head.match(/^(\s*)/);
        const headIndent = indentMatch ? indentMatch[1].length : 0;
        const bodyIndent = ' '.repeat(headIndent + 4);
        
        const indentedBody = body.split('\n').map(line => {
            if (line.trim() === '') return line;
            return bodyIndent + line.trimStart();
        }).join('\n');
        
        return head + indentedBody + '\n' + ' '.repeat(headIndent) + ')';
    });

    // --- 5. 修复问题四：CASE WHEN 内部缩进与 THEN 换行 ---
    // 5.1 THEN 换行
    formattedText = formattedText.replace(/(\bwhen\b[\s\S]*?)\s+\bthen\b\s+/gi, (match, whenPart) => {
        const lines = whenPart.split('\n');
        const lastLine = lines[lines.length - 1];
        const indentMatch = lastLine.match(/^(\s+)/);
        const baseIndent = indentMatch ? indentMatch[1] : '            ';
        return whenPart + '\n' + baseIndent + 'then ';
    });
    
    // 5.2 CASE 内部整体对齐
    const caseBlockRegex = /(\bcase\b[\s\S]*?\bend\b)/gi;
    formattedText = formattedText.replace(caseBlockRegex, (match) => {
        const lines = match.split('\n');
        if (lines.length <= 1) return match;
        
        const firstLineIndentMatch = lines[0].match(/^(\s*)case/i);
        const firstLineIndent = firstLineIndentMatch ? firstLineIndentMatch[1].length : 0;
        
        return lines.map((line, idx) => {
            if (idx === 0) return line;
            if (line.trim() === '') return line;
            
            const trimmed = line.trimStart();
            if (trimmed.toLowerCase().startsWith('when ') || trimmed.toLowerCase().startsWith('else ') || trimmed.toLowerCase().startsWith('end')) {
                return ' '.repeat(firstLineIndent + 4) + trimmed;
            }
            if (trimmed.toLowerCase().startsWith('then ')) {
                return ' '.repeat(firstLineIndent + 4) + trimmed;
            }
            // case 内部的其他内容（如 when 内部的 and）
            return ' '.repeat(firstLineIndent + 8) + trimmed;
        }).join('\n');
    });

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
