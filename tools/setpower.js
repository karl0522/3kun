// 批量改战力：node tools/setpower.js 卡名=战力 卡名=战力 ...
// 只改 data/cards.js 里对应卡牌的 power 字段，其他内容不动。改完会自动运行校验。
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '../data/cards.js');
let s = fs.readFileSync(file, 'utf8');
let changed = 0;
process.argv.slice(2).forEach(arg => {
	const [name, v] = arg.split('=');
	const re = new RegExp('(name:"' + name + '", faction:"[a-z]+", kind:"(?:unit|token)", rarity:"[a-z]+", row:"[a-z]+", power:)(\\d+)');
	if (!re.test(s)) { console.log('没找到单位牌：' + name); process.exitCode = 1; return; }
	s = s.replace(re, (m, a, old) => { if (old !== v) { changed++; console.log(`${name}: ${old} -> ${v}`); } return a + v; });
});
fs.writeFileSync(file, s);
console.log('共修改 ' + changed + ' 张');
require('child_process').execFileSync(process.execPath, [path.resolve(__dirname, 'validate.js')], { stdio: 'inherit' });
