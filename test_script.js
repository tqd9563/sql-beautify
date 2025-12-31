
const { format } = require('sql-formatter');
const fs = require('fs');

// Read sample.sql - ADJUSTED PATH
const sampleSql = fs.readFileSync('test/sample.sql', 'utf8');

console.log('--- Input SQL ---');
console.log(sampleSql);

// Mock Configuration
const config = {
    dialect: 'sql',
    uppercase: false,
    indent: '    ',
    customRules: []
};

// --- Replicate Logic from extension.ts ---
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

    // --- Compact Rules ---
    const compactRules = [
        { regex: /select\s*\n\s+/gi, replacement: 'select  ' },
        { regex: /from\s*\n\s+/gi, replacement: 'from ' },
        { regex: /where\s*\n\s+/gi, replacement: 'where ' },
        { regex: /having\s*\n\s+/gi, replacement: 'having ' },
        { regex: /with\s*\n\s*([a-zA-Z0-9_]+)\s+as/gi, replacement: 'with $1 as' },
        { regex: /with\s+([a-zA-Z0-9_]+)\s*\n\s*as/gi, replacement: 'with $1 as' }
    ];

    for (const rule of compactRules) {
        formattedText = formattedText.replace(rule.regex, rule.replacement);
    }
    
    return formattedText;
}

const result = formatLogic(sampleSql);
console.log('\n--- Formatted Output ---');
console.log(result);

// Read expected - ADJUSTED PATH
const expected = fs.readFileSync('test/expect.sql', 'utf8');

const normalize = (str) => str.replace(/\r\n/g, '\n').trim();

if (normalize(result) === normalize(expected)) {
    console.log('\n✅ SUCCESS: Output matches expected result!');
} else {
    console.log('\n❌ FAILURE: Output does not match expected result.');
    console.log('\n--- Diff (Expected vs Actual) ---');
    const expectedLines = normalize(expected).split('\n');
    const resultLines = normalize(result).split('\n');
    for (let i = 0; i < Math.max(expectedLines.length, resultLines.length); i++) {
        if (expectedLines[i] !== resultLines[i]) {
            console.log(`Line ${i + 1}:`);
            console.log(`  EXP: "${expectedLines[i] || ''}"`);
            console.log(`  ACT: "${resultLines[i] || ''}"`);
        }
    }
}

