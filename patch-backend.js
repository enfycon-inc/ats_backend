const fs = require('fs');
const path = require('path');

function replaceInFile(filePath, replacements) {
  let content = fs.readFileSync(filePath, 'utf8');
  let original = content;
  for (const [search, replace] of replacements) {
    content = content.split(search).join(replace);
  }
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Updated ${filePath}`);
  }
}

// 1. Backend Jobs module replacements
const backendJobsDir = path.join(__dirname, 'src', 'jobs');

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(dirPath);
  });
}

const backendReplacements = [
  ['primaryRecruiterId', 'recruiterId'],
  ['primary_recruiter_id', 'recruiter_id'],
  ['primaryRecruiter', 'recruiter'],
  ['primaryRecruiterName', 'recruiterName'],
  ['primary_recruiter_name', 'recruiter_name'],
  // Drop createdBy / created_by for JOBS. 
  // Let's replace 'j.created_by' with 'j.account_manager_id' in queries just in case they were used together.
  ['j.created_by = $${paramIndex}::uuid OR j.account_manager_id', 'j.account_manager_id'],
  ['j.created_by = $${paramIndex}::uuid \n          OR j.account_manager_id', 'j.account_manager_id'],
  ['uc.id = j.created_by', 'uc.id = j.account_manager_id'], // So creator_name resolves from account_manager
  ['row.created_by ?? ', ''],
  ['row.createdBy ?? ', '']
];

walkDir(backendJobsDir, (filePath) => {
  if (filePath.endsWith('.ts')) {
    replaceInFile(filePath, backendReplacements);
  }
});

console.log('Backend Jobs patching done.');
