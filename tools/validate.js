// 数据校验：改完 data/cards.js 或 data/abilities.js 后运行  node tools/validate.js
// 有错误时退出码为 1。只做检查，不修改任何文件。
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const { CARDS } = require(path.join(ROOT, 'data/cards.js'));
const A = require(path.join(ROOT, 'data/abilities.js'));

// 还没有卡图、允许暂时缺图的牌（补图后从这里删掉）
const ART_PENDING = [];

const errors = [], warns = [];
const err = m => errors.push(m), warn = m => warns.push(m);
const FACTIONS = Object.keys(A.FACTION_DEFS);
const KINDS = ['leader', 'unit', 'special', 'weather', 'token'];
const ROWS = ['close', 'ranged', 'siege', 'agile'];

const ids = new Set(), names = new Set();
CARDS.forEach(c => {
	const tag = `[${c.id} ${c.name}]`;
	if (ids.has(c.id)) err(`${tag} id 重复`); ids.add(c.id);
	const nk = c.kind + '|' + c.name;
	if (names.has(nk)) err(`${tag} 同类型里卡名重复（同名牌应合并为一条并用 copies 表示张数）`); names.add(nk);
	if (!FACTIONS.includes(c.faction)) err(`${tag} 未知势力 ${c.faction}`);
	if (!KINDS.includes(c.kind)) err(`${tag} 未知类型 ${c.kind}`);

	if (c.kind === 'leader') {
		if (!A.LEADER_SKILL_DEFS[c.skill]) err(`${tag} 领袖技能 ${c.skill} 没有定义`);
		if (!A.PLAYABLE_FACTIONS.includes(c.faction)) err(`${tag} 领袖必须属于可选势力`);
	} else {
		if (!Array.isArray(c.abilities)) err(`${tag} 缺少 abilities`);
		(c.abilities || []).forEach(a => {
			if (!A.ABILITY_DEFS[a.k]) err(`${tag} 技能代号 ${a.k} 没有定义`);
			if (a.k === 'scorch_row' && !['close', 'ranged', 'siege'].includes(a.row)) err(`${tag} 火攻必须指定 row`);
			if (a.k === 'charm' && !(a.max > 0)) err(`${tag} 离间必须指定 max`);
		});
		if (c.kind === 'unit' || c.kind === 'token') {
			if (!ROWS.includes(c.row)) err(`${tag} 站位无效 ${c.row}`);
			if (!(Number.isInteger(c.power) && c.power >= 0)) err(`${tag} 战力无效 ${c.power}`);
			const hero = c.abilities.some(a => a.k === 'hero');
			if (hero !== (c.rarity === 'gold')) err(`${tag} 金卡与猛将必须一致（rarity=${c.rarity} hero=${hero}）`);
			if (c.kind === 'unit') {
				if (!(c.copies >= 1 && c.copies <= 3)) err(`${tag} copies 应为 1–3`);
				if (c.rarity !== 'bronze' && c.copies !== 1) err(`${tag} 金卡、银卡只能带 1 张`);
				if (c.abilities.some(a => a.k === 'bond') && c.copies < 2 && !CARDS.some(o => o !== c && o.name === c.name)) warn(`${tag} 有「同袍」但只能带 1 张，技能不会生效`);
				if (c.abilities.some(a => a.k === 'muster') && c.copies < 2) warn(`${tag} 有「死士」但只能带 1 张，技能不会生效`);
			}
		} else {
			if (!(c.copies >= 1 && c.copies <= 3)) err(`${tag} copies 应为 1–3`);
			if (c.abilities.length !== 1) err(`${tag} 特殊牌/天气牌应有且只有一个技能`);
		}
		if (c.only && !c.only.every(f => A.PLAYABLE_FACTIONS.includes(f))) err(`${tag} only 里有未知势力`);
	}
	// 卡图：原图 + 两种小图
	[['sanguo', '.png'], ['sanguo-sm', '.webp'], ['sanguo-md', '.webp']].forEach(([dir, ext]) => {
		if (!fs.existsSync(path.join(ROOT, 'img', dir, c.art + ext))) {
			if (ART_PENDING.includes(c.art)) { if (dir === 'sanguo') warn(`${tag} 卡图待补（img/sanguo/${c.art}.png）`); }
			else err(`${tag} 缺卡图 img/${dir}/${c.art}${ext}`);
		}
	});
});

// 每个定义过的领袖技能都要有领袖在用；每个势力至少 2 位领袖
Object.keys(A.LEADER_SKILL_DEFS).forEach(k => { if (!CARDS.some(c => c.kind === 'leader' && c.skill === k)) warn(`领袖技能 ${k} 没有领袖使用`); });
const report = [];
A.PLAYABLE_FACTIONS.forEach(f => {
	const leaders = CARDS.filter(c => c.kind === 'leader' && c.faction === f);
	if (leaders.length < 2) err(`势力 ${f} 的领袖少于 2 位`);
	const own = CARDS.filter(c => c.kind === 'unit' && c.faction === f);
	const ownCopies = own.reduce((s, c) => s + c.copies, 0);
	const specials = CARDS.filter(c => (c.kind === 'special' || c.kind === 'weather') && (!c.only || c.only.includes(f)));
	if (ownCopies < A.DECK_RULES.unitMin) err(`势力 ${f} 的本势力单位只有 ${ownCopies} 张，凑不出至少 ${A.DECK_RULES.unitMin} 张单位的牌组`);
	report.push(`${A.FACTION_DEFS[f].name}：领袖 ${leaders.map(l => l.name).join('、')}；单位 ${own.length} 种 / ${ownCopies} 张（猛将 ${own.filter(c => c.rarity === 'gold').length}）；可带特殊与天气牌 ${specials.length} 种`);
});
const neutral = CARDS.filter(c => c.kind === 'unit' && c.faction === 'neutral');
report.push(`中立：单位 ${neutral.length} 种 / ${neutral.reduce((s, c) => s + c.copies, 0)} 张（猛将 ${neutral.filter(c => c.rarity === 'gold').length}）`);

// 卡图目录里没被任何牌使用的图
const usedArt = new Set(CARDS.map(c => c.art));
const unused = fs.readdirSync(path.join(ROOT, 'img/sanguo')).map(f => f.replace(/\.png$/i, '')).filter(n => !usedArt.has(n));
if (unused.length) warn(`有图但没有牌使用：${unused.join('、')}`);

// 每张牌都要能生成卡面文字
CARDS.forEach(c => { try { const d = A.describeCard(c); if (!Array.isArray(d.lines)) throw new Error('bad'); } catch (e) { err(`[${c.id} ${c.name}] 无法生成卡面文字：${e.message}`); } });

console.log(`共 ${CARDS.length} 条卡牌记录`);
report.forEach(l => console.log('  ' + l));
warns.forEach(w => console.log('提醒  ' + w));
errors.forEach(e => console.log('错误  ' + e));
console.log(errors.length ? `校验失败：${errors.length} 个错误` : `校验通过（${warns.length} 条提醒）`);
process.exit(errors.length ? 1 : 0);
