// Database integrity check
const Database = require('better-sqlite3');
const path = require('path');

try {
    console.log('Starting database integrity check...');
    const db = new Database(path.join(__dirname, 'data', 'vipb.db'));
    
    // 1. Get all tables
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
    console.log(`Found ${tables.length} tables in database`);
    
    const tableResults = [];
    const foreignKeyIssues = [];
    const jsonValidationIssues = [];
    
    for (const table of tables) {
        try {
            // Count rows
            const count = db.prepare(`SELECT COUNT(*) as cnt FROM "${table.name}"`).get().cnt;
            tableResults.push({ table: table.name, rowCount: count, status: 'OK' });
            
            // Get table info to check for foreign keys
            const tableInfo = db.prepare(`PRAGMA table_info("${table.name}")`).all();
            
            // Check for foreign key columns
            const foreignKeyColumns = tableInfo.filter(col => col.name.endsWith('_id') && col.name !== 'id');
            for (const col of foreignKeyColumns) {
                const referencedTable = col.name.replace('_id', 's'); // Simple heuristic
                if (tables.some(t => t.name === referencedTable)) {
                    // Check for orphaned records
                    const orphanQuery = `
                        SELECT COUNT(*) as orphan_count 
                        FROM "${table.name}" t
                        LEFT JOIN "${referencedTable}" r ON t."${col.name}" = r.id
                        WHERE t."${col.name}" IS NOT NULL AND r.id IS NULL
                    `;
                    try {
                        const orphans = db.prepare(orphanQuery).get().orphan_count;
                        if (orphans > 0) {
                            foreignKeyIssues.push({
                                table: table.name,
                                column: col.name,
                                referencedTable: referencedTable,
                                orphanCount: orphans
                            });
                        }
                    } catch (e) {
                        // Table might not have expected structure
                    }
                }
            }
            
            // Check JSON fields if present
            const jsonColumns = ['config', 'settings', 'data', 'metadata', 'config_fields', 'stats', 'steps'];
            for (const colName of jsonColumns) {
                if (tableInfo.some(col => col.name === colName)) {
                    const invalidJsonQuery = `
                        SELECT COUNT(*) as invalid_count 
                        FROM "${table.name}" 
                        WHERE "${colName}" IS NOT NULL 
                        AND "${colName}" != ''
                        AND json_valid("${colName}") = 0
                    `;
                    try {
                        const invalidCount = db.prepare(invalidJsonQuery).get().invalid_count;
                        if (invalidCount > 0) {
                            jsonValidationIssues.push({
                                table: table.name,
                                column: colName,
                                invalidCount: invalidCount
                            });
                        }
                    } catch (e) {
                        // Column might not be JSON type
                    }
                }
            }
            
        } catch (e) {
            tableResults.push({ table: table.name, rowCount: 0, status: `ERROR: ${e.message}` });
        }
    }
    
    console.log('\n=== DATABASE INTEGRITY CHECK RESULTS ===');
    
    console.log('\n1. Table Row Counts:');
    console.table(tableResults);
    
    console.log('\n2. Foreign Key Issues:');
    if (foreignKeyIssues.length === 0) {
        console.log('✓ No foreign key issues found');
    } else {
        console.table(foreignKeyIssues);
    }
    
    console.log('\n3. JSON Field Validation Issues:');
    if (jsonValidationIssues.length === 0) {
        console.log('✓ All JSON fields are valid');
    } else {
        console.table(jsonValidationIssues);
    }
    
    // Specific checks mentioned in requirements
    console.log('\n4. Specific Checks:');
    
    // Check settings table JSON fields
    if (tables.some(t => t.name === 'settings')) {
        const settingsCols = db.prepare("PRAGMA table_info('settings')").all();
        const jsonCols = settingsCols.filter(col => ['config', 'value', 'data'].includes(col.name));
        
        for (const col of jsonCols) {
            const invalidJson = db.prepare(`
                SELECT COUNT(*) as cnt FROM settings 
                WHERE "${col.name}" IS NOT NULL 
                AND "${col.name}" != ''
                AND json_valid("${col.name}") = 0
            `).get().cnt;
            
            if (invalidJson > 0) {
                console.log(`⚠️  settings.${col.name}: ${invalidJson} invalid JSON records`);
            } else {
                console.log(`✓ settings.${col.name}: All JSON records are valid`);
            }
        }
    }
    
    // Check esim_providers.config_fields
    if (tables.some(t => t.name === 'esim_providers')) {
        const invalidConfigFields = db.prepare(`
            SELECT COUNT(*) as cnt FROM esim_providers 
            WHERE config_fields IS NOT NULL 
            AND config_fields != ''
            AND json_valid(config_fields) = 0
        `).get().cnt;
        
        if (invalidConfigFields > 0) {
            console.log(`⚠️  esim_providers.config_fields: ${invalidConfigFields} invalid JSON records`);
        } else {
            console.log(`✓ esim_providers.config_fields: All JSON records are valid`);
        }
    }
    
    // Check emails.customer_id foreign key
    if (tables.some(t => t.name === 'emails') && tables.some(t => t.name === 'customers')) {
        const orphanedEmails = db.prepare(`
            SELECT COUNT(*) as cnt FROM emails e
            LEFT JOIN customers c ON e.customer_id = c.id
            WHERE e.customer_id IS NOT NULL AND c.id IS NULL
        `).get().cnt;
        
        if (orphanedEmails > 0) {
            console.log(`⚠️  emails.customer_id: ${orphanedEmails} orphaned records (referenced customer doesn't exist)`);
        } else {
            console.log(`✓ emails.customer_id: No orphaned records`);
        }
    }
    
    db.close();
    console.log('\nDatabase integrity check completed.');
    
    // Save results
    const fs = require('fs');
    const results = {
        tableCounts: tableResults,
        foreignKeyIssues,
        jsonValidationIssues,
        timestamp: new Date().toISOString()
    };
    
    fs.writeFileSync(
        path.join(__dirname, 'database-check-results.json'),
        JSON.stringify(results, null, 2)
    );
    console.log('Results saved to database-check-results.json');
    
} catch (error) {
    console.error('Database check failed:', error.message);
}