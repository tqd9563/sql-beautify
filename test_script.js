const { format } = require('sql-formatter');
const fs = require('fs');
const path = require('path');

const workspaceRoot = '/Users/lilithgames/sql-beautify';
const samplePath = path.join(workspaceRoot, 'test/group2/sample.sql');
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
    formattedText = formattedText.replace(/([^\n])\s*\bcase\b/gi, '$1\ncase');
    formattedText = formattedText.replace(/([^\n])\s*\bwhen\b/gi, '$1\nwhen');
    formattedText = formattedText.replace(/([^\n])\s*\bthen\b/gi, '$1\nthen');
    formattedText = formattedText.replace(/([^\n])\s*\belse\b/gi, '$1\nelse');
    formattedText = formattedText.replace(/([^\n])\s*\bend\b/gi, '$1\nend');

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
    ];

    for (const rule of compactRules) {
        formattedText = formattedText.replace(rule.regex, rule.replacement);
    }

    // --- 2. 修复问题一：CTE 间隔和顶格 ---
    formattedText = formattedText.replace(/\),\s*(?:[\r\n]+\s*)?([a-zA-Z0-9_]+)\s+as/gi, '),\n\n$1 as');
    formattedText = formattedText.replace(/\)\s*[\r\n]+\s*(select\s{2})/gi, ')\n\n$1');
    formattedText = formattedText.replace(/\)\n\s+select/gi, ')\n\nselect');

    // --- 3. 核心修复逻辑：块级处理 ---
    const lines = formattedText.split('\n');
    let finalLines = [];
    let i = 0;

    while (i < lines.length) {
        let line = lines[i];
        let trimmed = line.trimStart();
        let lowerTrimmed = trimmed.toLowerCase();

        if (trimmed === ')' || trimmed === '),') {
            finalLines.push(trimmed);
            i++;
            continue;
        }

        if (lowerTrimmed.startsWith('select  ')) {
            const match = line.match(/^(\s*)select/i);
            const selectIndent = match ? match[1].length : 0;
            
            let blockLines = [line];
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

    // --- 4. WHERE 嵌套 ---
    const nestedWhereRegex = /((?:and|or)\s+\(\s*[\r\n]+)([\s\S]*?)(\n\s*\))/gi;
    formattedText = formattedText.replace(nestedWhereRegex, (match, head, body, tail) => {
        const indentMatch = head.match(/^(\s*)/);
        const headIndent = indentMatch ? indentMatch[1].length : 0;
        const bodyIndent = ' '.repeat(headIndent + 4);
        
        const indentedBody = body.split('\n').map((line) => {
            if (line.trim() === '') return line;
            return bodyIndent + line.trimStart();
        }).join('\n');
        
        return head + indentedBody + '\n' + ' '.repeat(headIndent) + ')';
    });

    // --- 5. CASE WHEN 内部 ---
    const caseLines = formattedText.split('\n');
    let caseStack = [];
    let resultLines = [];

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

    // --- 6. GROUP BY 单行 ---
    // 修改：增加对 ) 的支持，防止吞掉换行
    const groupByRegex = /(group\s+by[\s\S]*?)(having|order\s+by|limit|\)|;|$)/gi; 
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
