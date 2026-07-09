const ts = require('typescript');
const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../ats_frontend_main/app/(dashboard)/job-posting/new/page.tsx');
console.log("Checking file syntax errors on disk:", filePath);

const program = ts.createProgram([filePath], {
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX,
  skipLibCheck: true,
  allowJs: true
});

const diagnostics = ts.getPreEmitDiagnostics(program);

const syntaxErrors = diagnostics.filter(diag => {
  const code = diag.code;
  // Ignore module resolution errors (2307)
  return code !== 2307;
});

if (syntaxErrors.length === 0) {
  console.log("No syntax or non-module errors found on disk!");
} else {
  console.log(`Found ${syntaxErrors.length} syntax/TS errors:`);
  syntaxErrors.forEach(diag => {
    if (diag.file) {
      const { line, character } = diag.file.getLineAndCharacterOfPosition(diag.start);
      console.log(`${diag.file.fileName} (${line + 1},${character + 1}): [TS${diag.code}] ${ts.flattenDiagnosticMessageText(diag.messageText, '\n')}`);
    } else {
      console.log(`[TS${diag.code}] ${ts.flattenDiagnosticMessageText(diag.messageText, '\n')}`);
    }
  });
}
