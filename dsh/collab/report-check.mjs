#!/usr/bin/env node
// 交回前自查：`node report-check.mjs <file|->` prints what a [report]/[ask] still misses.
// Exit 0 means it would be accepted; 1 lists the problems, so a member can fix before handing back.
import { readFileSync } from 'node:fs';
import { checkReport, REPORT_SKELETON } from './team-exit.mjs';

const arg = process.argv[2];
const text = arg === undefined || arg === '-' ? readFileSync(0, 'utf8') : readFileSync(arg, 'utf8');
const problems = checkReport(text);
if (problems.length === 0) { console.log('交回格式没问题'); process.exit(0); }
console.error('还差：');
for (const problem of problems) console.error(`- ${problem}`);
console.error('\n照这个填：\n' + REPORT_SKELETON);
process.exit(1);
