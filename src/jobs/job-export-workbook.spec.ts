import { jobExportWorkbook } from './job-export-workbook';

describe('job export workbook', () => {
  it('writes two Excel worksheets and treats formula-like candidate names as literal text', () => {
    const workbook = jobExportWorkbook([
      { name: 'Jobs Summary', rows: [['Job code', 'Submissions done'], ['JOB-1', 0]] },
      { name: 'Job Submissions', rows: [['Candidate name'], ['=HYPERLINK("https://example.com")'], ['A & B\u0000']] },
    ]);
    expect(workbook.readUInt32LE(0)).toBe(0x04034b50);
    const contents = workbook.toString();
    expect(contents).toContain('name="Jobs Summary"');
    expect(contents).toContain('name="Job Submissions"');
    expect(contents).toContain('t="inlineStr"');
    expect(contents).toContain('=HYPERLINK(&quot;https://example.com&quot;)');
    expect(contents).not.toContain('<f>');
    expect(contents).toContain('<c><v>0</v></c>');
    expect(contents).toContain('A &amp; B');
    expect(workbook.readUInt32LE(workbook.length - 22)).toBe(0x06054b50);
  });
});
