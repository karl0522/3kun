// 平衡模拟：让 AI 自己对打，统计各势力、各领袖的胜率。
// 用法：node tools/sim.js [每组局数=100] [难度=hard]
const R = require('../js/rules.js');
const AI = require('../js/ai.js');
const A = require('../data/abilities.js');

const N = parseInt(process.argv[2] || '100', 10), LEVEL = process.argv[3] || 'hard';
const F = A.PLAYABLE_FACTIONS;
const leaders = {}; R.CARDS.filter(c => c.kind === 'leader').forEach(c => (leaders[c.faction] = leaders[c.faction] || []).push(c.name));

function playOne(seed, mf, ml, af, al) {
	const s = R.newGame({ seed, me: { faction: mf, leader: ml, deck: R.recommendedDeck(mf) }, ai: { faction: af, leader: al, deck: R.recommendedDeck(af) } });
	let steps = 0;
	while (s.phase !== 'over') {
		if (++steps > 800) throw new Error(`卡死 seed=${seed} ${mf}/${ml} vs ${af}/${al}`);
		const side = s.pending ? s.pending.side : s.phase === 'mulligan' ? (s.players.me.kept ? 'ai' : 'me') : s.turn;
		R.act(s, AI.choose(s, side, LEVEL));
	}
	return s;
}

const fw = {}, fg = {}, lw = {}, lg = {}, lu = {};
const matrix = {};
let seed = 1, games = 0, draws = 0, rounds3 = 0;
const t0 = Date.now();
F.forEach(a => F.forEach(b => {
	if (a === b) return;
	let w = 0;
	for (let i = 0; i < N; i++) {
		const la = leaders[a][i % leaders[a].length], lb = leaders[b][Math.floor(i / leaders[a].length) % leaders[b].length];
		const s = playOne(seed++, a, la, b, lb);
		games++; if (s.roundScores.length === 3) rounds3++;
		fg[a] = (fg[a] || 0) + 1; fg[b] = (fg[b] || 0) + 1; lg[la] = (lg[la] || 0) + 1; lg[lb] = (lg[lb] || 0) + 1;
		if (s.players.me.leaderUsed) lu[la] = (lu[la] || 0) + 1;
		if (s.players.ai.leaderUsed) lu[lb] = (lu[lb] || 0) + 1;
		if (s.winner === 'me') { w++; fw[a] = (fw[a] || 0) + 1; lw[la] = (lw[la] || 0) + 1; }
		else if (s.winner === 'ai') { fw[b] = (fw[b] || 0) + 1; lw[lb] = (lw[lb] || 0) + 1; }
		else draws++;
	}
	matrix[a + '>' + b] = w / N;
}));
const pct = x => (100 * x).toFixed(1).padStart(5) + '%';
const nm = f => A.FACTION_DEFS[f].name;
console.log(`共 ${games} 局（每组 ${N} 局，难度 ${LEVEL}），用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒；平局 ${draws} 局；打满三局的占 ${pct(rounds3 / games)}`);
console.log('\n势力总胜率：');
F.forEach(f => console.log('  ' + nm(f) + ' ' + pct((fw[f] || 0) / fg[f])));
console.log('\n对战表（行=甲方，列=乙方，数字=甲方胜率）：');
console.log('        ' + F.map(f => nm(f).padStart(6)).join(''));
F.forEach(a => console.log('  ' + nm(a) + '  ' + F.map(b => a === b ? '    — ' : pct(matrix[a + '>' + b])).join('')));
console.log('\n领袖胜率与技能使用率：');
Object.keys(lg).sort((x, y) => (lw[y] || 0) / lg[y] - (lw[x] || 0) / lg[x]).forEach(l => console.log('  ' + l.padEnd(4, '　') + ' 胜率 ' + pct((lw[l] || 0) / lg[l]) + '   使用率 ' + pct((lu[l] || 0) / lg[l])));
