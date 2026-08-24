import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const roots = ['apps/client', 'apps/server', 'README_zh-TW.md', 'docs'];
const forbidden = ['导入','导出','另存为','图片','字体','字号','图层','设置','预览','对齐','删除','工作区','用户界面'];
const findings = [];
async function scan(target) {
  const info = await readdir(target, { withFileTypes: true }).catch(() => null);
  if (info) {
    for (const item of info) await scan(path.join(target, item.name));
    return;
  }
  if (!/\.(?:tsx?|html|md|txt|csv)$/.test(target)) return;
  const content = await readFile(target, 'utf8');
  for (const term of forbidden) if (content.includes(term)) findings.push(`${target}: ${term}`);
}
for (const root of roots) await scan(root);
if (findings.length) throw new Error(`發現簡體中文阻擋詞：\n${findings.join('\n')}`);
console.log('zh-TW static scan PASS');
