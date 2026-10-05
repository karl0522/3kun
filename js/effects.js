// 三坤牌 技能效果（重设计方案 v4）。按 data/abilities.js 里的代号注册：
//   ON_PLAY  单位牌打出时的技能      SPECIAL  特殊牌与天气牌
//   LEADER   领袖技能（can/use）      CONT     "选完之后怎么继续"的处理函数
//   onRoundWin / onRoundStart / pickKeep  阵营被动
// 统一规定：被技能复活、召唤、复制出来的单位，不触发它自己的打出技能（张宝「撒豆成兵」的死士连锁除外，那是技能本身的内容）。
(function (root) {
'use strict';
var isNode = typeof module !== 'undefined' && module.exports;
var R = root.Rules;
var DEFS = isNode ? require('../data/abilities.js') : root;
var FACTION_DEFS = DEFS.FACTION_DEFS, ABILITY_DEFS = DEFS.ABILITY_DEFS;
var ROWS = R.ROWS, def = R.def, has = R.has, other = R.other, who = R.who;

function nm(inst) { return def(inst).name; }
function names(list) { return list.map(nm).join('、'); }
function nonHeroOnField(state, side) { return R.fieldUnits(state.players[side]).filter(function (c) { return !R.isHero(c); }); }
function uids(list) { return list.map(function (c) { return c.uid; }); }
function byUid(list, uid) { for (var i = 0; i < list.length; i++) if (list[i].uid === uid) return list[i]; return null; }
function passive(state, side) { return FACTION_DEFS[state.players[side].faction].passive; }

// 消灭一组（side, inst），返回被消灭的牌
function killAll(state, targets) { targets.forEach(function (t) { R.destroy(state, t.side, t.inst); }); return targets.map(function (t) { return t.inst; }); }
// 某一方某一排里战力最高的非猛将（并列全取）
function strongestInRow(state, side, row) {
	var list = state.players[side].rows[row].filter(function (c) { return !R.isHero(c); });
	if (!list.length) return [];
	var mx = Math.max.apply(null, list.map(function (c) { return R.power(state, side, c, row); }));
	return list.filter(function (c) { return R.power(state, side, c, row) === mx; }).map(function (c) { return { side: side, inst: c }; });
}
// 双方全场战力并列最高的非猛将
function strongestOnBoard(state) {
	var all = [];
	['me', 'ai'].forEach(function (s) { ROWS.forEach(function (r) { state.players[s].rows[r].forEach(function (c) { if (!R.isHero(c)) all.push({ side: s, inst: c, p: R.power(state, s, c, r) }); }); }); });
	if (!all.length) return [];
	var mx = Math.max.apply(null, all.map(function (x) { return x.p; }));
	if (mx <= 0) return [];
	return all.filter(function (x) { return x.p === mx; });
}
function setWeather(state, side, inst, rows) {
	inst.owner = side;
	rows.forEach(function (r) {
		var old = state.weather[r];
		state.weather[r] = inst;
		if (old && old !== inst && ROWS.every(function (x) { return state.weather[x] !== old; })) R.toDiscard(state, old.owner, old);
	});
}
// 死士：把手牌和牌库里的同名牌一并放上场
function musterPull(state, side, inst, row) {
	var P = state.players[side], name = nm(inst), pulled = [];
	[P.hand, P.deck].forEach(function (zone) {
		for (var i = zone.length - 1; i >= 0; i--) if (def(zone[i]).name === name && has(def(zone[i]), 'muster')) pulled.push(zone.splice(i, 1)[0]);
	});
	pulled.forEach(function (c) { R.enterField(state, side, c, row); });
	if (pulled.length) R.log(state, side, '死士：' + name + ' 带出 ' + pulled.length + ' 张同名牌');
	return pulled;
}

// ==================== 单位牌：打出时 ====================
var ON_PLAY = {
	muster: function (state, side, inst, fieldSide, row) { musterPull(state, side, inst, row); },
	tyranny: function (state, side, inst, fieldSide, row) {
		state.players[fieldSide].rows[row].forEach(function (c) { if (c !== inst && !R.isHero(c)) c.mod -= 1; });
		R.log(state, side, '暴政：同排其他非猛将单位战力 -1');
	},
	scorch_row: function (state, side, inst, fieldSide, row, a) {
		var o = other(side);
		if (R.rowTotal(state, o, a.row) < 10) return;
		var dead = killAll(state, strongestInRow(state, o, a.row));
		if (dead.length) R.log(state, side, '火攻：消灭 ' + names(dead));
	},
	scorch_all: function (state, side) {
		var dead = killAll(state, strongestOnBoard(state));
		if (dead.length) R.log(state, side, '火烧赤壁：消灭 ' + names(dead));
	},
	mirror: function (state, side, inst) {
		var o = other(side), best = 0;
		nonHeroOnField(state, o).forEach(function (c) { best = Math.max(best, R.effPower(state, o, c)); });
		if (best > 0) { inst.base = best; R.log(state, side, '幻术：左慈变为战力 ' + best); }
	},
	east_wind: function (state, side) {
		var ws = state.players[side].deck.filter(function (c) { return def(c).kind === 'weather'; });
		if (!ws.length) { R.clearWeather(state); R.log(state, side, '借东风：清除全部天气'); return; }
		R.ask(state, side, { type: 'pick', zone: 'deck', cands: ['clear'].concat(uids(ws)), cont: 'east_wind', endsTurn: true, prompt: '借东风：清除全部天气，或从牌库打出一张天气牌' });
	},
	medic: function (state, side) {
		var cs = state.players[side].discard.filter(function (c) { return R.isUnit(c) && !R.isHero(c); });
		if (!cs.length) return;
		R.ask(state, side, { type: 'card', zone: 'discard', cands: uids(cs), cont: 'medic', endsTurn: true, prompt: '归阵：从弃牌堆选一张非猛将单位上场' });
	},
	charm: function (state, side, inst, fieldSide, row, a) {
		var o = other(side);
		var cs = nonHeroOnField(state, o).filter(function (c) { return R.effPower(state, o, c) <= a.max; });
		if (!cs.length) return;
		R.ask(state, side, { type: 'card', zone: 'oppField', cands: uids(cs), cont: 'charm', endsTurn: true, prompt: '离间：选对手一张战力不超过 ' + a.max + ' 的非猛将单位' });
	}
};
var ON_PLAY_ORDER = ['muster', 'tyranny', 'scorch_row', 'scorch_all', 'mirror', 'east_wind', 'medic', 'charm'];

// ==================== 特殊牌与天气牌 ====================
var SPECIAL = {
	horn: {
		can: function (state, side) { var P = state.players[side]; return ROWS.some(function (r) { return !P.horn[r]; }); },
		play: function (state, side, inst) {
			var P = state.players[side];
			R.toDiscard(state, side, inst);
			R.ask(state, side, { type: 'row', cands: ROWS.filter(function (r) { return !P.horn[r]; }), cont: 'horn', endsTurn: true, prompt: '战鼓：选择己方一排' });
		}
	},
	mardroeme: {
		can: function (state, side) { var P = state.players[side]; return ROWS.some(function (r) { return !P.mard[r]; }); },
		play: function (state, side, inst) {
			var P = state.players[side];
			R.toDiscard(state, side, inst);
			R.ask(state, side, { type: 'row', cands: ROWS.filter(function (r) { return !P.mard[r]; }), cont: 'mardroeme', endsTurn: true, prompt: '蛮巫祭礼：选择己方一排' });
		}
	},
	decoy: {
		can: function (state, side) { return nonHeroOnField(state, side).length > 0; },
		play: function (state, side, inst) {
			R.toDiscard(state, side, inst);
			R.ask(state, side, { type: 'card', zone: 'field', cands: uids(nonHeroOnField(state, side)), cont: 'decoy', endsTurn: true, prompt: '招降：选己方场上一张非猛将单位收回手牌' });
		}
	},
	scorch: {
		play: function (state, side, inst) {
			R.toDiscard(state, side, inst);
			var dead = killAll(state, strongestOnBoard(state));
			R.log(state, side, dead.length ? '烽火燎原：消灭 ' + names(dead) : '烽火燎原：没有可消灭的目标');
		}
	},
	frost: { play: function (state, side, inst) { setWeather(state, side, inst, ['close']); R.log(state, side, '寒潮：近战排非猛将战力变为 1'); } },
	fog:   { play: function (state, side, inst) { setWeather(state, side, inst, ['ranged']); R.log(state, side, '大雾：远程排非猛将战力变为 1'); } },
	rain:  { play: function (state, side, inst) { setWeather(state, side, inst, ['siege']); R.log(state, side, '暴雨：攻城排非猛将战力变为 1'); } },
	storm: { play: function (state, side, inst) { setWeather(state, side, inst, ['ranged', 'siege']); R.log(state, side, '海上狂风：远程排和攻城排非猛将战力变为 1'); } },
	clear: { play: function (state, side, inst) { R.clearWeather(state); R.toDiscard(state, side, inst); R.log(state, side, '放晴：清除全部天气'); } }
};

// 从手牌打出一张牌（由 Rules.act 调用，牌已从手牌取出）
function play(state, side, inst, row) {
	var d = def(inst);
	if (d.kind === 'unit') {
		var r = d.row === 'agile' ? (row === 'ranged' ? 'ranged' : 'close') : d.row;
		var fieldSide = has(d, 'spy') ? other(side) : side;
		state.players[fieldSide].rows[r].push(inst);
		R.log(state, side, who(side) + '打出 ' + d.name + (has(d, 'spy') ? '（卧底，放到对方半场）' : ''));
		if (has(d, 'spy')) R.draw(state, side, 2);
		for (var i = 0; i < ON_PLAY_ORDER.length; i++) {
			var a = R.ability(d, ON_PLAY_ORDER[i]);
			if (a) ON_PLAY[a.k](state, side, inst, fieldSide, r, a);
		}
		return;
	}
	var k = d.abilities[0].k;
	if (d.kind === 'special') R.log(state, side, who(side) + '打出 ' + d.name);
	else R.log(state, side, who(side) + '打出天气牌 ' + d.name);
	SPECIAL[k].play(state, side, inst);
}

// ==================== 领袖技能 ====================
function deckCards(state, side, pred) { return state.players[side].deck.filter(pred); }
function isNanman(c) { var n = nm(c); return R.isUnit(c) && (/南蛮|蛮部/.test(n) || n === '祝融'); }
var LEADER = {
	rende: {
		can: function (state, side) { return state.players[side].discard.some(R.isUnit); },
		use: function (state, side) { R.ask(state, side, { type: 'card', zone: 'discard', cands: uids(state.players[side].discard.filter(R.isUnit)), cont: 'toHandFromDiscard', prompt: '仁德：从弃牌堆选一张单位放回手牌' }); }
	},
	xiangfu: {
		can: function (state, side) { return deckCards(state, side, function (c) { return has(def(c), 'bond'); }).length > 0; },
		use: function (state, side) { R.ask(state, side, { type: 'card', zone: 'deck', cands: uids(deckCards(state, side, function (c) { return has(def(c), 'bond'); })), cont: 'deckToField', prompt: '相父辅政：从牌库选一张同袍单位上场' }); }
	},
	xietianzi: {
		can: function (state, side) { return deckCards(state, side, function (c) { return has(def(c), 'spy'); }).length > 0; },
		use: function (state, side) { R.ask(state, side, { type: 'card', zone: 'deck', cands: uids(deckCards(state, side, function (c) { return has(def(c), 'spy'); })), cont: 'deckSpy', prompt: '挟天子：从牌库选一张卧底牌打出' }); }
	},
	yinren: {
		rows: function (state, side) { var P = state.players[side]; return ROWS.filter(function (r) { return P.rows[r].some(function (c) { return !R.isHero(c); }); }); },
		can: function (state, side) { return state.round < 3 && LEADER.yinren.rows(state, side).length > 0; },
		use: function (state, side) { R.ask(state, side, { type: 'row', cands: LEADER.yinren.rows(state, side), cont: 'yinren', prompt: '隐忍：选己方一排，收回该排全部非猛将单位' }); }
	},
	jiangdong: {
		can: function (state, side) { return deckCards(state, side, function (c) { return def(c).kind === 'weather'; }).length > 0; },
		use: function (state, side) { R.ask(state, side, { type: 'card', zone: 'deck', cands: uids(deckCards(state, side, function (c) { return def(c).kind === 'weather'; })), cont: 'deckWeather', prompt: '江东之虎：从牌库选一张天气牌打出' }); }
	},
	zhiheng: {
		can: function (state, side) { var P = state.players[side]; return P.hand.length > 0 && P.deck.length > 0; },
		use: function (state, side) { R.ask(state, side, { type: 'card', zone: 'hand', cands: uids(state.players[side].hand), cont: 'zhiheng', prompt: '制衡：选一张手牌弃置，然后抽 2 张' }); }
	},
	cangtian: {
		can: function (state, side) { return nonHeroOnField(state, side).length > 0; },
		use: function (state, side) { state.players[side].doubled = true; R.log(state, side, '苍天已死：本局非猛将单位战力 ×2，局末移出游戏'); }
	},
	sadou: {
		can: function (state, side) { return deckCards(state, side, function (c) { return has(def(c), 'muster'); }).length > 0; },
		use: function (state, side) { R.ask(state, side, { type: 'card', zone: 'deck', cands: uids(deckCards(state, side, function (c) { return has(def(c), 'muster'); })), cont: 'sadou', prompt: '撒豆成兵：从牌库选一张死士单位上场' }); }
	},
	huimeng: {
		can: function (state, side) { return nonHeroOnField(state, side).length > 0 && state.players[side].deck.length > 0; },
		use: function (state, side) {
			var us = nonHeroOnField(state, side);
			us.forEach(function (c) { c.mod -= 1; });
			var n = R.draw(state, side, Math.min(3, us.length));
			R.log(state, side, '会盟：' + us.length + ' 张单位战力 -1，抽 ' + n + ' 张牌');
		}
	},
	xiliang: {
		can: function (state, side) { return state.players[side].discard.some(function (c) { return has(def(c), 'muster'); }); },
		use: function (state, side) {
			var seen = {}, cs = [];
			state.players[side].discard.forEach(function (c) { if (has(def(c), 'muster') && !seen[nm(c)]) { seen[nm(c)] = 1; cs.push(c); } });   // 每个名字出一个代表
			R.ask(state, side, { type: 'card', zone: 'discard', cands: uids(cs), cont: 'xiliang', prompt: '西凉举义：选一组同名死士单位全部上场' });
		}
	},
	nanman: {
		can: function (state, side) { return state.players[side].discard.some(isNanman); },
		use: function (state, side) { R.ask(state, side, { type: 'card', zone: 'discard', cands: uids(state.players[side].discard.filter(isNanman)), min: 1, max: 2, cont: 'nanman', prompt: '南蛮再起：从弃牌堆选最多 2 张南蛮单位上场' }); }
	}
};

// ==================== 选完之后的处理 ====================
var CONT = {
	horn: function (state, pend, sel) { state.players[pend.side].horn[sel[0]] = true; R.log(state, pend.side, '战鼓：' + DEFS.ROW_NAME[sel[0]] + '排非猛将战力 ×2'); },
	mardroeme: function (state, pend, sel) { state.players[pend.side].mard[sel[0]] = true; R.log(state, pend.side, '蛮巫祭礼：' + DEFS.ROW_NAME[sel[0]] + '排死士单位战力 ×2'); },
	decoy: function (state, pend, sel) {
		var f = R.findOnField(state, sel[0]), P = state.players[pend.side];
		P.rows[f.row].splice(P.rows[f.row].indexOf(f.inst), 1);
		f.inst.mod = 0; delete f.inst.base;
		if (!f.inst.copy) P.hand.push(f.inst);
		R.log(state, pend.side, '招降：收回 ' + nm(f.inst));
	},
	medic: function (state, pend, sel) {
		var P = state.players[pend.side], c = R.takeByUid(P.discard, sel[0]);
		R.enterField(state, pend.side, c);
		R.log(state, pend.side, '归阵：' + nm(c) + ' 重返战场');
	},
	charm: function (state, pend, sel) {
		var f = R.findOnField(state, sel[0]), O = state.players[f.side];
		O.rows[f.row].splice(O.rows[f.row].indexOf(f.inst), 1);
		state.players[pend.side].rows[f.row].push(f.inst);
		R.log(state, pend.side, '离间：' + nm(f.inst) + ' 转投' + who(pend.side) + '方');
	},
	east_wind: function (state, pend, sel) {
		if (sel[0] === 'clear') { R.clearWeather(state); R.log(state, pend.side, '借东风：清除全部天气'); return; }
		var c = R.takeByUid(state.players[pend.side].deck, sel[0]);
		R.log(state, pend.side, '借东风：打出 ' + nm(c));
		SPECIAL[def(c).abilities[0].k].play(state, pend.side, c);
	},
	toHandFromDiscard: function (state, pend, sel) {
		var P = state.players[pend.side], c = R.takeByUid(P.discard, sel[0]);
		P.hand.push(c); R.log(state, pend.side, nm(c) + ' 从弃牌堆回到手牌');
	},
	deckToField: function (state, pend, sel) {
		var c = R.takeByUid(state.players[pend.side].deck, sel[0]);
		R.enterField(state, pend.side, c); R.log(state, pend.side, nm(c) + ' 从牌库上场');
	},
	deckSpy: function (state, pend, sel) {
		var c = R.takeByUid(state.players[pend.side].deck, sel[0]);
		R.enterField(state, other(pend.side), c);
		var n = R.draw(state, pend.side, 2);
		R.log(state, pend.side, nm(c) + ' 潜入对方半场，' + who(pend.side) + '抽 ' + n + ' 张牌');
	},
	deckWeather: function (state, pend, sel) {
		var c = R.takeByUid(state.players[pend.side].deck, sel[0]);
		SPECIAL[def(c).abilities[0].k].play(state, pend.side, c);
	},
	yinren: function (state, pend, sel) {
		var P = state.players[pend.side], back = P.rows[sel[0]].filter(function (c) { return !R.isHero(c); });
		P.rows[sel[0]] = P.rows[sel[0]].filter(R.isHero);
		back.forEach(function (c) { c.mod = 0; delete c.base; if (!c.copy) P.hand.push(c); });
		var n = R.draw(state, pend.side, 1);
		R.log(state, pend.side, '隐忍：收回 ' + back.length + ' 张单位，抽 ' + n + ' 张牌');
	},
	zhiheng: function (state, pend, sel) {
		var P = state.players[pend.side], c = R.takeByUid(P.hand, sel[0]);
		R.toDiscard(state, pend.side, c);
		var n = R.draw(state, pend.side, 2);
		R.log(state, pend.side, '制衡：弃 1 张，抽 ' + n + ' 张');
	},
	sadou: function (state, pend, sel) {
		var c = R.takeByUid(state.players[pend.side].deck, sel[0]);
		var r = R.enterField(state, pend.side, c);
		R.log(state, pend.side, '撒豆成兵：' + nm(c) + ' 上场');
		musterPull(state, pend.side, c, r);
		var n = R.draw(state, pend.side, 1);
		if (n) R.log(state, pend.side, '撒豆成兵：抽 ' + n + ' 张牌');
	},
	xiliang: function (state, pend, sel) {
		var P = state.players[pend.side], rep = byUid(P.discard, sel[0]), name = nm(rep);
		var group = P.discard.filter(function (c) { return nm(c) === name && has(def(c), 'muster'); });
		group.forEach(function (c) { R.takeByUid(P.discard, c.uid); R.enterField(state, pend.side, c); });
		R.log(state, pend.side, '西凉举义：' + group.length + ' 张「' + name + '」上场');
	},
	nanman: function (state, pend, sel) {
		var P = state.players[pend.side], got = [];
		sel.forEach(function (uid) { var c = R.takeByUid(P.discard, uid); R.enterField(state, pend.side, c); got.push(c); });
		R.log(state, pend.side, '南蛮再起：' + names(got) + ' 上场');
	}
};

// ==================== 阵营被动 ====================
function onRoundWin(state, side) {
	if (passive(state, side) === 'shuhan_draw') { if (R.draw(state, side, 1)) R.log(state, side, '仁德得人心：赢下一局，抽 1 张牌'); }
}
// 黄巾：每局结束随机保留 1 张己方单位（苍天已死期间只可能留下猛将）
function pickKeep(state, side) {
	if (passive(state, side) !== 'huangjin_keep') return null;
	var P = state.players[side];
	var cs = R.fieldUnits(P).filter(function (c) { return !c.copy && !(P.doubled && !R.isHero(c)); });
	if (!cs.length) return null;
	var k = R.pickRandom(state, cs);
	R.log(state, side, '杀之不尽：' + nm(k) + ' 留在场上');
	return k;
}
// 群雄：第 3 局开始，从弃牌堆随机召回 2 张单位
function onRoundStart(state) {
	if (state.round !== 3) return;
	['me', 'ai'].forEach(function (s) {
		if (passive(state, s) !== 'qunxiong_recall') return;
		var P = state.players[s], got = [];
		for (var i = 0; i < 2; i++) {
			var cs = P.discard.filter(R.isUnit);
			if (!cs.length) break;
			var c = R.pickRandom(state, cs);
			R.takeByUid(P.discard, c.uid); R.enterField(state, s, c); got.push(c);
		}
		if (got.length) R.log(state, s, '诸侯并起：' + names(got) + ' 从弃牌堆回到战场');
	});
}

var Effects = { ON_PLAY: ON_PLAY, SPECIAL: SPECIAL, LEADER: LEADER, CONT: CONT, play: play, onRoundWin: onRoundWin, onRoundStart: onRoundStart, pickKeep: pickKeep, strongestOnBoard: strongestOnBoard };
root.Effects = Effects;
if (isNode) module.exports = Effects;
})(typeof window !== 'undefined' ? window : globalThis);
