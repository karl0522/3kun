// 三坤牌 规则引擎（重设计方案 v4）。
// 只操作纯数据的"对局状态"，不依赖页面，浏览器和 node 都能直接运行。技能的具体效果在 js/effects.js 里按代号注册。
// 对外入口：Rules.newGame / legalActions / act / total / power / clone / validateDeck / recommendedDeck
(function (root) {
'use strict';
var isNode = typeof module !== 'undefined' && module.exports;
var DATA = isNode ? require('../data/cards.js') : root;
var DEFS = isNode ? require('../data/abilities.js') : root;
var CARDS = DATA.CARDS, DECK_RULES = DEFS.DECK_RULES, FACTION_DEFS = DEFS.FACTION_DEFS;

var ROWS = ['close', 'ranged', 'siege'];
var BY_ID = {}, BY_NAME = {};
CARDS.forEach(function (c) { BY_ID[c.id] = c; if (c.kind !== 'leader' || !BY_NAME[c.name]) BY_NAME[c.name] = c; });

function def(inst) { return BY_ID[inst.cid]; }
function ability(d, k) { if (!d.abilities) return null; for (var i = 0; i < d.abilities.length; i++) if (d.abilities[i].k === k) return d.abilities[i]; return null; }
function has(d, k) { return !!ability(d, k); }
function isHero(inst) { return has(def(inst), 'hero'); }
function isUnit(inst) { var k = def(inst).kind; return k === 'unit' || k === 'token'; }
function other(side) { return side === 'me' ? 'ai' : 'me'; }
function clone(state) { return JSON.parse(JSON.stringify(state)); }

// ---------- 随机数（带种子，可重现） ----------
function rnd(state) {
	var t = (state.seed = (state.seed + 0x6D2B79F5) | 0);
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function shuffle(state, arr) {
	for (var i = arr.length - 1; i > 0; i--) { var j = Math.floor(rnd(state) * (i + 1)); var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
	return arr;
}
function pickRandom(state, arr) { return arr[Math.floor(rnd(state) * arr.length)]; }

// ---------- 基础操作 ----------
function makeInst(state, cid, extra) {
	var inst = { uid: ++state.uid, cid: cid, mod: 0 };
	if (extra) for (var k in extra) inst[k] = extra[k];
	return inst;
}
function log(state, side, text) { state.log.push({ round: state.round, side: side, text: text }); }
function who(side) { return side === 'me' ? '你' : '对手'; }
function fieldUnits(P) { return P.rows.close.concat(P.rows.ranged, P.rows.siege); }
function rowOf(P, inst) { for (var i = 0; i < 3; i++) if (P.rows[ROWS[i]].indexOf(inst) >= 0) return ROWS[i]; return null; }
function findOnField(state, uid) {
	var sides = ['me', 'ai'];
	for (var s = 0; s < 2; s++) { var P = state.players[sides[s]];
		for (var i = 0; i < 3; i++) { var list = P.rows[ROWS[i]];
			for (var j = 0; j < list.length; j++) if (list[j].uid === uid) return { side: sides[s], row: ROWS[i], inst: list[j] }; } }
	return null;
}
function takeByUid(list, uid) { for (var i = 0; i < list.length; i++) if (list[i].uid === uid) return list.splice(i, 1)[0]; return null; }
function draw(state, side, n) {
	var P = state.players[side], got = 0;
	while (got < n && P.deck.length) { P.hand.push(P.deck.shift()); got++; }
	return got;
}
function toDiscard(state, side, inst) {
	inst.mod = 0; delete inst.base;
	if (inst.copy) return;              // 复制品直接消失
	state.players[side].discard.push(inst);
}
// 把场上一张单位移出战场并放进所在一方的弃牌堆
function destroy(state, side, inst) {
	var P = state.players[side], r = rowOf(P, inst);
	if (!r) return false;
	P.rows[r].splice(P.rows[r].indexOf(inst), 1);
	toDiscard(state, side, inst);
	return true;
}
// 被技能放上场的单位：不触发它自己的打出技能；「灵活」单位默认进近战排
function enterField(state, side, inst, row) {
	var d = def(inst);
	var r = row || (d.row === 'agile' ? 'close' : d.row);
	state.players[side].rows[r].push(inst);
	return r;
}

// ---------- 战力计算 ----------
// 顺序：基础战力+个体修正 → 天气置1(猛将免疫) → 同袍×同名张数 → 士气+1 → 光环(吕布无双) → 倍率(战鼓/苍天已死/蛮巫祭礼，猛将免疫)
function weatherImmune(P, d) { return FACTION_DEFS[P.faction].passive === 'dongwu_agile' && d.row === 'agile'; }
function power(state, side, inst, row) {
	var P = state.players[side], O = state.players[other(side)], d = def(inst);
	if (d.kind !== 'unit' && d.kind !== 'token') return 0;
	var hero = has(d, 'hero');
	var p = Math.max(0, (inst.base != null ? inst.base : d.power) + (inst.mod || 0));
	if (!hero && state.weather[row] && !weatherImmune(P, d)) p = Math.min(p, 1);
	var list = P.rows[row], i;
	if (has(d, 'bond')) {
		var n = 0;
		for (i = 0; i < list.length; i++) { var dd = def(list[i]); if (dd.name === d.name && has(dd, 'bond')) n++; }
		if (n > 1) p *= n;
	}
	for (i = 0; i < list.length; i++) if (list[i] !== inst && has(def(list[i]), 'morale')) p += 1;
	if (!hero && row === 'close') {
		var oc = fieldUnits(O);
		for (i = 0; i < oc.length; i++) if (has(def(oc[i]), 'peerless')) { p = Math.max(0, p - 1); break; }
	}
	if (!hero) {
		if (P.horn[row]) p *= 2;
		if (P.doubled) p *= 2;
		if (P.mard[row] && has(d, 'muster')) p *= 2;
	}
	return p;
}
function effPower(state, side, inst) { var r = rowOf(state.players[side], inst); return r ? power(state, side, inst, r) : 0; }
function rowTotal(state, side, row) {
	var list = state.players[side].rows[row], s = 0;
	for (var i = 0; i < list.length; i++) s += power(state, side, list[i], row);
	return s;
}
function total(state, side) { return rowTotal(state, side, 'close') + rowTotal(state, side, 'ranged') + rowTotal(state, side, 'siege'); }

// ---------- 开局 ----------
// cfg = { seed, me:{faction, leader:'刘备', deck:[卡牌id...]}, ai:{...}, first:'me'|'ai'(可省略，随机) }
function newPlayer(state, side, c) {
	var leader = CARDS.filter(function (x) { return x.kind === 'leader' && x.name === c.leader; })[0];
	if (!leader) throw new Error('未知领袖 ' + c.leader);
	var P = {
		side: side, faction: c.faction, leaderCid: leader.id, leaderUsed: false, gems: 2,
		hand: [], deck: [], discard: [], removed: [],
		rows: { close: [], ranged: [], siege: [] },
		horn: { close: false, ranged: false, siege: false },
		mard: { close: false, ranged: false, siege: false },
		doubled: false, passed: false, mulligans: DECK_RULES.mulligan, kept: false
	};
	c.deck.forEach(function (cid) { if (!BY_ID[cid]) throw new Error('未知卡牌 id ' + cid); P.deck.push(makeInst(state, cid)); });
	shuffle(state, P.deck);
	return P;
}
function newGame(cfg) {
	var state = { seed: (cfg.seed | 0) || 1, uid: 0, round: 1, turn: 'me', phase: 'mulligan', players: {}, weather: { close: null, ranged: null, siege: null }, pending: null, log: [], roundScores: [], winner: null, firstOfRound: 'me' };
	state.players.me = newPlayer(state, 'me', cfg.me);
	state.players.ai = newPlayer(state, 'ai', cfg.ai);
	draw(state, 'me', DECK_RULES.handSize); draw(state, 'ai', DECK_RULES.handSize);
	state.turn = state.firstOfRound = cfg.first || (rnd(state) < 0.5 ? 'me' : 'ai');
	return state;
}

// ---------- 合法操作 ----------
function combos(cands, min, max) {
	var out = [];
	if (min === 0) out.push([]);
	cands.forEach(function (c) { out.push([c]); });
	if (max >= 2) for (var i = 0; i < cands.length; i++) for (var j = i + 1; j < cands.length; j++) out.push([cands[i], cands[j]]);
	return out.filter(function (s) { return s.length >= min && s.length <= max; });
}
function canPlay(state, side, inst) {
	var P = state.players[side], d = def(inst), E = root.Effects || Effects;
	if (d.kind === 'unit') return true;
	var a = d.abilities[0], sp = E.SPECIAL[a.k];
	return sp.can ? sp.can(state, side) : true;
}
function legalActions(state, side) {
	var P = state.players[side], out = [];
	if (state.phase === 'over') return out;
	if (state.phase === 'mulligan') {
		if (P.kept) return out;
		if (P.mulligans > 0 && P.deck.length) P.hand.forEach(function (c) { out.push({ type: 'mulligan', uid: c.uid }); });
		out.push({ type: 'keep' });
		return out;
	}
	if (state.pending) {
		if (state.pending.side !== side) return out;
		return combos(state.pending.cands, state.pending.min, state.pending.max).map(function (s) { return { type: 'answer', sel: s }; });
	}
	if (state.turn !== side || P.passed) return out;
	P.hand.forEach(function (c) {
		var d = def(c);
		if (!canPlay(state, side, c)) return;
		if (d.kind === 'unit' && d.row === 'agile') { out.push({ type: 'play', uid: c.uid, row: 'close' }); out.push({ type: 'play', uid: c.uid, row: 'ranged' }); }
		else out.push({ type: 'play', uid: c.uid });
	});
	if (leaderCan(state, side)) out.push({ type: 'leader' });
	out.push({ type: 'pass' });
	return out;
}
function leaderCan(state, side) {
	var P = state.players[side], E = root.Effects || Effects;
	if (P.leaderUsed || state.phase !== 'play' || state.pending || state.turn !== side || P.passed) return false;
	return E.LEADER[BY_ID[P.leaderCid].skill].can(state, side);
}

// ---------- 执行操作 ----------
// 向某一方发出"请选择"的请求。cont = 选完之后由哪个处理函数继续；endsTurn = 选完后是否结束本次出牌
function ask(state, side, req) {
	req.side = side; req.min = req.min == null ? 1 : req.min; req.max = req.max == null ? 1 : req.max;
	state.pending = req;
}
function act(state, action) {
	var E = root.Effects || Effects, side, P;
	if (state.phase === 'over') throw new Error('对局已结束');
	if (action.type === 'mulligan' || action.type === 'keep') {
		side = action.side; P = state.players[side];
		if (state.phase !== 'mulligan' || P.kept) throw new Error('现在不能换牌');
		if (action.type === 'mulligan') {
			if (P.mulligans <= 0) throw new Error('换牌次数已用完');
			var out = takeByUid(P.hand, action.uid); if (!out) throw new Error('手牌里没有这张牌');
			P.mulligans--;
			draw(state, side, 1);                          // 先抽，再把换掉的牌洗回牌库，保证不会抽回同一张
			P.deck.push(out); shuffle(state, P.deck);
			if (P.mulligans === 0) P.kept = true;
		} else P.kept = true;
		if (state.players.me.kept && state.players.ai.kept) { state.phase = 'play'; log(state, state.turn, '第 1 局开始，' + who(state.turn) + '先手'); }
		return state;
	}
	if (action.type === 'answer') {
		var pend = state.pending; if (!pend) throw new Error('当前没有需要选择的事项');
		var sel = action.sel || [];
		if (sel.length < pend.min || sel.length > pend.max) throw new Error('选择数量不对');
		sel.forEach(function (v) { if (pend.cands.indexOf(v) < 0) throw new Error('选择了无效的目标'); });
		state.pending = null;
		E.CONT[pend.cont](state, pend, sel);
		if (!state.pending && pend.endsTurn) advance(state);
		return state;
	}
	if (state.pending) throw new Error('请先完成当前的选择');
	side = state.turn; P = state.players[side];
	if (action.side && action.side !== side) throw new Error('还没轮到这一方');
	if (P.passed) throw new Error('已经过牌');
	if (action.type === 'pass') {
		P.passed = true; log(state, side, who(side) + '过牌');
		advance(state); return state;
	}
	if (action.type === 'leader') {
		if (!leaderCan(state, side)) throw new Error('领袖技能当前不可用');
		var L = BY_ID[P.leaderCid];
		P.leaderUsed = true;
		log(state, side, who(side) + '使用领袖技「' + DEFS.LEADER_SKILL_DEFS[L.skill].name + '」');
		E.LEADER[L.skill].use(state, side);
		return state;                                   // 领袖技能不消耗出牌机会
	}
	if (action.type === 'play') {
		var inst = null;
		for (var i = 0; i < P.hand.length; i++) if (P.hand[i].uid === action.uid) inst = P.hand[i];
		if (!inst) throw new Error('手牌里没有这张牌');
		if (!canPlay(state, side, inst)) throw new Error('这张牌现在不能打出');
		takeByUid(P.hand, inst.uid);
		E.play(state, side, inst, action.row);
		if (!state.pending) advance(state);
		return state;
	}
	throw new Error('未知操作 ' + action.type);
}

// ---------- 轮转与结算 ----------
function advance(state) {
	var a = state.players.me, b = state.players.ai;
	if (a.passed && b.passed) return endRound(state);
	var next = other(state.turn);
	if (state.players[next].passed) next = state.turn;
	state.turn = next;
}
function endRound(state) {
	var E = root.Effects || Effects;
	var me = state.players.me, ai = state.players.ai;
	var sm = total(state, 'me'), sa = total(state, 'ai');
	var winner = sm > sa ? 'me' : sa > sm ? 'ai' : null;
	if (!winner) {                                     // 平局：曹魏「挟天子之名」判胜（双方都是曹魏则仍为平局）
		var tm = FACTION_DEFS[me.faction].passive === 'caowei_tie', ta = FACTION_DEFS[ai.faction].passive === 'caowei_tie';
		if (tm !== ta) winner = tm ? 'me' : 'ai';
	}
	state.roundScores.push({ me: sm, ai: sa, winner: winner });
	if (winner) { state.players[other(winner)].gems--; log(state, winner, '第 ' + state.round + ' 局：' + who(winner) + '获胜（' + sm + ' : ' + sa + '）'); }
	else { me.gems--; ai.gems--; log(state, null, '第 ' + state.round + ' 局：平局（' + sm + ' : ' + sa + '）'); }
	if (winner) E.onRoundWin(state, winner);

	// 清场
	['me', 'ai'].forEach(function (s) {
		var P = state.players[s];
		var keep = E.pickKeep(state, s);
		ROWS.forEach(function (r) {
			var stay = [];
			P.rows[r].forEach(function (inst) {
				if (inst === keep) { inst.mod = 0; stay.push(inst); return; }
				if (P.doubled && !isHero(inst)) { inst.mod = 0; if (!inst.copy) P.removed.push(inst); return; }   // 苍天已死：移出游戏
				toDiscard(state, s, inst);
			});
			P.rows[r] = stay;
		});
		P.horn = { close: false, ranged: false, siege: false };
		P.mard = { close: false, ranged: false, siege: false };
		P.doubled = false; P.passed = false;
	});
	clearWeather(state);

	var over = me.gems <= 0 || ai.gems <= 0 || state.round >= 3;
	if (over) {
		state.phase = 'over';
		state.winner = me.gems > ai.gems ? 'me' : ai.gems > me.gems ? 'ai' : 'draw';
		log(state, state.winner === 'draw' ? null : state.winner, state.winner === 'draw' ? '对局结束：平局' : '对局结束：' + who(state.winner) + '获胜');
		return;
	}
	state.round++;
	state.turn = state.firstOfRound = winner || state.firstOfRound;
	draw(state, 'me', DECK_RULES.drawPerRound); draw(state, 'ai', DECK_RULES.drawPerRound);
	E.onRoundStart(state);
	log(state, state.turn, '第 ' + state.round + ' 局开始，' + who(state.turn) + '先手');
}
function clearWeather(state) {
	var seen = {};
	ROWS.forEach(function (r) {
		var w = state.weather[r];
		if (w && !seen[w.uid]) { seen[w.uid] = 1; toDiscard(state, w.owner, w); }
		state.weather[r] = null;
	});
}

// ---------- 牌组 ----------
// 某势力可以带的牌：本势力 + 中立（含特殊牌、天气牌），去掉专属于别的势力的
function deckPool(faction) {
	return CARDS.filter(function (c) {
		if (c.kind === 'leader' || c.kind === 'token') return false;
		if (c.faction !== faction && c.faction !== 'neutral') return false;
		return !c.only || c.only.indexOf(faction) >= 0;
	});
}
function validateDeck(faction, leaderName, ids) {
	var errs = [], count = {}, units = 0, specials = 0, neutral = 0, pool = {};
	deckPool(faction).forEach(function (c) { pool[c.id] = c; });
	if (!CARDS.some(function (c) { return c.kind === 'leader' && c.faction === faction && c.name === leaderName; })) errs.push('领袖不属于这个势力');
	ids.forEach(function (id) {
		var c = pool[id];
		if (!c) { errs.push('不能带这张牌：' + (BY_ID[id] ? BY_ID[id].name : id)); return; }
		count[id] = (count[id] || 0) + 1;
		if (c.kind === 'unit') { units++; if (c.faction === 'neutral') neutral++; } else specials++;
	});
	Object.keys(count).forEach(function (id) { if (count[id] > BY_ID[id].copies) errs.push('「' + BY_ID[id].name + '」最多带 ' + BY_ID[id].copies + ' 张'); });
	if (units < DECK_RULES.unitMin) errs.push('单位牌至少 ' + DECK_RULES.unitMin + ' 张（现在 ' + units + ' 张）');
	if (specials > DECK_RULES.specialMax) errs.push('特殊牌和天气牌最多 ' + DECK_RULES.specialMax + ' 张（现在 ' + specials + ' 张）');
	if (neutral > DECK_RULES.neutralMax) errs.push('中立单位最多 ' + DECK_RULES.neutralMax + ' 张（现在 ' + neutral + ' 张）');
	if (ids.length > DECK_RULES.totalMax) errs.push('牌组最多 ' + DECK_RULES.totalMax + ' 张（现在 ' + ids.length + ' 张）');
	return { ok: !errs.length, errors: errs, units: units, specials: specials, neutral: neutral, total: ids.length };
}
// 推荐牌组：本势力全部猛将 + 战力最高的单位凑够 22 张，再配一组常用的特殊牌和天气牌
function recommendedDeck(faction) {
	var pool = deckPool(faction), ids = [];
	var own = pool.filter(function (c) { return c.kind === 'unit' && c.faction === faction; });
	own.sort(function (a, b) { return (has(b, 'hero') - has(a, 'hero')) || (b.power - a.power) || (a.id - b.id); });
	own.forEach(function (c) { for (var i = 0; i < c.copies && ids.length < DECK_RULES.unitMin; i++) ids.push(c.id); });
	var want = { horn: 2, decoy: 1, scorch: 1, frost: 1, fog: 1, clear: 1, storm: 1, mardroeme: 1 }, got = {};
	pool.filter(function (c) { return c.kind !== 'unit'; }).forEach(function (c) {
		var k = c.abilities[0].k, need = want[k] || 0; got[k] = got[k] || 0;
		for (var i = 0; i < c.copies && got[k] < need; i++) { ids.push(c.id); got[k]++; }
	});
	return ids;
}

var Rules = {
	ROWS: ROWS, BY_ID: BY_ID, BY_NAME: BY_NAME, CARDS: CARDS,
	def: def, has: has, ability: ability, isHero: isHero, isUnit: isUnit, other: other, clone: clone, who: who,
	rnd: rnd, shuffle: shuffle, pickRandom: pickRandom,
	makeInst: makeInst, log: log, fieldUnits: fieldUnits, rowOf: rowOf, findOnField: findOnField, takeByUid: takeByUid,
	draw: draw, toDiscard: toDiscard, destroy: destroy, enterField: enterField, clearWeather: clearWeather,
	power: power, effPower: effPower, rowTotal: rowTotal, total: total,
	newGame: newGame, legalActions: legalActions, leaderCan: leaderCan, canPlay: canPlay, ask: ask, act: act, advance: advance,
	deckPool: deckPool, validateDeck: validateDeck, recommendedDeck: recommendedDeck
};
root.Rules = Rules;
var Effects = isNode ? require('./effects.js') : root.Effects;
if (isNode) module.exports = Rules;
})(typeof window !== 'undefined' ? window : globalThis);
