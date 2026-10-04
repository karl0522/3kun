// 三坤牌 AI（重设计方案 v4）。
// 做法：把当前局面复制一份，逐个"试打"每个合法操作，按打完后的局面打分，选最好的。
// 新增的牌和技能不需要单独教 AI——只要引擎能执行，AI 就能试出它值不值。
// 对外入口：AI.choose(state, side, level)  level = easy | normal | hard
(function (root) {
'use strict';
var isNode = typeof module !== 'undefined' && module.exports;
var R = isNode ? require('./rules.js') : root.Rules;

var CARD_VALUE = 4.5;   // 一张手牌大约值多少点战力（用来衡量"值不值得花这张牌"）

// 局面评分：战力差 + 手牌差的折算
function score(state, side) {
	var o = R.other(side), P = state.players[side], O = state.players[o];
	return (R.total(state, side) - R.total(state, o)) + CARD_VALUE * (P.hand.length - O.hand.length);
}
// 试打一个操作；如果它引出"请选择"，就继续替这一方挑最好的选项，直到没有待选
function simulate(state, side, action) {
	var s = R.clone(state);
	R.act(s, action);
	var guard = 0;
	while (s.pending && s.pending.side === side && guard++ < 6) {
		var best = bestAnswer(s, side);
		R.act(s, best);
	}
	return s;
}
function bestAnswer(state, side) {
	var acts = R.legalActions(state, side), best = acts[0], bs = -Infinity;
	if (acts.length > 40) acts = acts.slice(0, 40);
	for (var i = 0; i < acts.length; i++) {
		var s = R.clone(state);
		R.act(s, acts[i]);
		var g = 0; while (s.pending && s.pending.side === side && g++ < 4) R.act(s, R.legalActions(s, side)[0]);
		var v = score(s, side);
		if (v > bs) { bs = v; best = acts[i]; }
	}
	return best;
}
// 手牌里单位牌的战力总和（粗略估计"全打出去能加多少"）
function handPotential(state, side) {
	var sum = 0;
	state.players[side].hand.forEach(function (c) { var d = R.def(c); if (d.kind === 'unit' && !R.has(d, 'spy')) sum += d.power; });
	return sum;
}
function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function choose(state, side, level) {
	level = level || 'normal';
	var P = state.players[side], o = R.other(side), O = state.players[o];
	var acts = R.legalActions(state, side);
	if (!acts.length) return null;

	// 开局换牌：把战力很低、又没有技能的牌换掉
	if (state.phase === 'mulligan') {
		if (level !== 'easy' && P.mulligans > 0) {
			var weak = P.hand.filter(function (c) { var d = R.def(c); return d.kind === 'unit' && d.power <= 2 && d.abilities.length === 0; });
			if (weak.length) return { type: 'mulligan', side: side, uid: weak[0].uid };
		}
		return { type: 'keep', side: side };
	}
	if (state.pending) return level === 'easy' ? rand(acts) : bestAnswer(state, side);

	var plays = acts.filter(function (a) { return a.type === 'play'; });
	var canLeader = acts.some(function (a) { return a.type === 'leader'; });
	var diff = R.total(state, side) - R.total(state, o);

	if (level === 'easy') {
		if (!plays.length) return { type: 'pass' };
		if (O.passed && diff > 0) return { type: 'pass' };
		if (diff > 15 && Math.random() < 0.4) return { type: 'pass' };
		return rand(plays);
	}

	var base = score(state, side);
	// 领袖技能：不花出牌机会，只要明显有赚就用
	if (canLeader) {
		var ls = simulate(state, side, { type: 'leader' });
		var gain = score(ls, side) - base;
		var need = level === 'hard' ? 3 : 5;
		if (gain >= need || (state.round === 3 && gain > 0)) return { type: 'leader' };
	}
	if (!plays.length) return { type: 'pass' };

	// 给每个出牌方案打分
	var options = plays.map(function (a) {
		var s = simulate(state, side, a);
		return { a: a, gain: score(s, side) - base, diffAfter: R.total(s, side) - R.total(s, o) };
	});
	options.sort(function (x, y) { return y.gain - x.gain; });
	var best = options[0];
	var mustWin = P.gems === 1;                 // 再输就出局
	var lastRound = state.round === 3 || mustWin && O.gems === 1;

	// 对手已过牌：领先就过牌；落后就用最省的方式反超，实在追不上就保留手牌
	if (O.passed) {
		if (diff > 0) return { type: 'pass' };
		var winners = options.filter(function (x) { return x.diffAfter > 0; });
		if (winners.length) { winners.sort(function (x, y) { return y.gain - x.gain; }); return winners[0].a; }
		if (!lastRound && diff + handPotential(state, side) <= 0) return { type: 'pass' };
		return best.a;
	}
	// 最后一局或不能再输：有牌就打
	if (lastRound) return best.a;
	// 进阶：领先很多、手牌不占优时收手，把牌留给后面
	if (level === 'hard') {
		var lead = 10 + 4 * (state.round - 1);
		if (diff >= lead && P.hand.length <= O.hand.length + 1) return { type: 'pass' };
		if (best.gain < -CARD_VALUE && diff > 0) return { type: 'pass' };   // 再出牌只亏不赚
	} else {
		if (diff >= 25) return { type: 'pass' };
	}
	return best.a;
}

var AI = { choose: choose, score: score, simulate: simulate };
root.AI = AI;
if (isNode) module.exports = AI;
})(typeof window !== 'undefined' ? window : globalThis);
