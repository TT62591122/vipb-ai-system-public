// Route file static check
const fs = require('fs');
const path = require('path');

console.log('Starting route file static checks...');

// Get all route files
const routesDir = path.join(__dirname, 'routes');
const routeFiles = fs.readdirSync(routesDir).filter(file => file.endsWith('.js'));

console.log(`Found ${routeFiles.length} route files`);

const routeResults = [];

for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    try {
        // Try to require the route file
        delete require.cache[require.resolve(filePath)];
        require(filePath);
        routeResults.push({
            file: file,
            status: 'OK',
            error: ''
        });
        console.log(`✓ ${file}: OK`);
    } catch (error) {
        routeResults.push({
            file: file,
            status: 'ERROR',
            error: error.message
        });
        console.log(`✗ ${file}: ERROR - ${error.message}`);
    }
}

// Check server.js for route mounting order
console.log('\nChecking server.js route mounting order...');
try {
    const serverContent = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    
    // Look for route mounting patterns
    const routePatterns = [
        { regex: /app\.(?:get|post|put|delete|use)\s*\(\s*["'][^"']*["']/g, desc: 'Route definitions' },
        { regex: /app\.use\s*\(\s*["'][^"']*["']\s*,\s*require\s*\(/g, desc: 'Route mounting with require' }
    ];
    
    const wildcardRoutes = [];
    const lines = serverContent.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check for wildcard routes
        if (line.includes('*') && (line.includes('app.get') || line.includes('app.use'))) {
            wildcardRoutes.push({
                line: i + 1,
                content: line.trim()
            });
        }
        
        // Check for route mounting
        if (line.includes('app.use') && line.includes('routes/')) {
            console.log(`  Line ${i + 1}: ${line.trim()}`);
        }
    }
    
    console.log('\nWildcard routes found:');
    if (wildcardRoutes.length === 0) {
        console.log('  ✓ No wildcard routes found');
    } else {
        wildcardRoutes.forEach(route => {
            console.log(`  Line ${route.line}: ${route.content}`);
        });
    }
    
    // Check for async error handling
    console.log('\nChecking for unhandled async errors...');
    const asyncFuncPattern = /async\s+function\s+\w+|const\s+\w+\s*=\s*async\s*\(/g;
    const tryCatchPattern = /try\s*\{[^}]*catch\s*\(/g;
    
    const asyncMatches = [...serverContent.matchAll(asyncFuncPattern)];
    const tryCatchMatches = [...serverContent.matchAll(tryCatchPattern)];
    
    console.log(`  Found ${asyncMatches.length} async functions`);
    console.log(`  Found ${tryCatchMatches.length} try-catch blocks`);
    
    if (asyncMatches.length > tryCatchMatches.length * 1.5) {
        console.log('  ⚠️  Warning: Possible unhandled async errors');
    } else {
        console.log('  ✓ Async error handling looks adequate');
    }
    
} catch (error) {
    console.log(`✗ Error reading server.js: ${error.message}`);
}

// Check all route files for async error handling
console.log('\nChecking route files for async error handling...');
const routeFileIssues = [];

for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Count async functions
        const asyncFuncs = (content.match(/async\s+(function|\()/g) || []).length;
        
        // Count try-catch blocks
        const tryCatches = (content.match(/try\s*\{/g) || []).length;
        
        if (asyncFuncs > 0 && tryCatches < asyncFuncs * 0.7) {
            routeFileIssues.push({
                file: file,
                asyncFuncs: asyncFuncs,
                tryCatches: tryCatches,
                issue: 'Possible unhandled async errors'
            });
        }
    } catch (error) {
        // Skip if can't read
    }
}

if (routeFileIssues.length > 0) {
    console.log('Route files with possible async error handling issues:');
    routeFileIssues.forEach(issue => {
        console.log(`  ${issue.file}: ${issue.asyncFuncs} async functions, ${issue.tryCatches} try-catch blocks`);
    });
} else {
    console.log('✓ All route files have adequate async error handling');
}

// Save results
const results = {
    routeFiles: routeResults,
    timestamp: new Date().toISOString()
};

fs.writeFileSync(
    path.join(__dirname, 'route-check-results.json'),
    JSON.stringify(results, null, 2)
);

console.log('\nRoute static checks completed.');
console.log(`Successfully checked ${routeResults.filter(r => r.status === 'OK').length}/${routeFiles.length} route files`);