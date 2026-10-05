// 规则引擎测试：node tests/run.js
// 不需要浏览器。有失败时退出码为 1。
const R = require('../js/rules.js');
const E = require('../js/effects.js');
const A = require('../data/abilities.js');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
	try { fn(); pass++; }
	catch (e) { fail++; failures.push(name + '\n      ' + (e && e.message)); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || '') + ' 期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a)); }
function ok(v, msg) { if (!v) throw new Error(msg || '断言失败'); }
function throws(fn, msg) { let t = false; try { fn(); } catch (e) { t = true; } if (!t) throw new Error(msg || '应当报错'); }

// ---------- 搭建局面的工具 ----------
const LEADER_OF = { shuhan: '刘备', caowei: '曹操', dongwu: '孙权', huangjin: '张角', qunxiong: '袁绍' };
function game(opt) {
	opt = opt || {};
	const mf = opt.me || 'shuhan', af = opt.ai || 'caowei';
	const s = R.newGame({ seed: opt.seed || 7, first: 'me',
		me: { faction: mf, leader: opt.meLeader || LEADER_OF[mf], deck: R.recommendedDeck(mf) },
		ai: { faction: af, leader: opt.aiLeader || LEADER_OF[af], deck: R.recommendedDeck(af) } });
	R.act(s, { type: 'keep', side: 'me' }); R.act(s, { type: 'keep', side: 'ai' });
	if (opt.empty !== false) ['me', 'ai'].forEach(x => { const P = s.players[x]; P.hand = []; P.deck = []; P.discard = []; });
	return s;
}
function P(name) { return card(name).power; }   // 卡牌表里的战力，调数值后测试不用改
function card(name) { const c = R.CARDS.find(x => x.name === name && x.kind !== 'leader'); if (!c) throw new Error('没有这张牌：' + name); return c; }
// zone: hand / deck / discard / close / ranged / siege
function put(s, side, zone, name) {
	const inst = R.makeInst(s, card(name).id), P = s.players[side];
	if (R.ROWS.includes(zone)) P.rows[zone].push(inst); else P[zone].push(inst);
	return inst;
}
function playName(s, side, name, row) {
	const inst = put(s, side, 'hand', name);
	s.turn = side;
	R.act(s, { type: 'play', uid: inst.uid, row });
	return inst;
}
function answer(s, sel) { R.act(s, { type: 'answer', sel: Array.isArray(sel) ? sel : [sel] }); }
function pw(s, side, inst) { return R.effPower(s, side, inst); }
function onField(s, side, name) { return R.fieldUnits(s.players[side]).filter(c => R.def(c).name === name); }
function inZone(s, side, zone, name) { return s.players[side][zone].filter(c => R.def(c).name === name).length; }

// ==================== 战力计算 ====================
test('基础战力与每排合计', () => {
	const s = game(); put(s, 'me', 'close', '蜀汉重步兵'); put(s, 'me', 'ranged', '蜀汉弓手');
	eq(R.total(s, 'me'), P('蜀汉重步兵') + P('蜀汉弓手'));
});
test('同袍：同排同名 2 张各 ×2', () => {
	const s = game(); const a = put(s, 'me', 'close', '白耳骑兵'); put(s, 'me', 'close', '白耳骑兵');
	eq(pw(s, 'me', a), P('白耳骑兵') * 2); eq(R.total(s, 'me'), P('白耳骑兵') * 4);
});
test('同袍：不同排不生效', () => {
	const s = game(); const a = put(s, 'me', 'ranged', '蜀汉弓手'); put(s, 'me', 'close', '白耳骑兵');
	eq(pw(s, 'me', a), P('蜀汉弓手'));
});
test('士气：同排其他单位 +1，自己不加，对猛将也生效', () => {
	const s = game(); const m = put(s, 'me', 'close', '蜀精锐步兵'); const u = put(s, 'me', 'close', '蜀汉重步兵'); const h = put(s, 'me', 'close', '魏延');
	eq(pw(s, 'me', m), P('蜀精锐步兵')); eq(pw(s, 'me', u), P('蜀汉重步兵') + 1); eq(pw(s, 'me', h), P('魏延') + 1);
});
test('天气：非猛将变 1，猛将不变', () => {
	const s = game(); const u = put(s, 'me', 'close', '蜀汉重步兵'); const h = put(s, 'me', 'close', '魏延');
	playName(s, 'ai', '寒潮');
	eq(pw(s, 'me', u), 1); eq(pw(s, 'me', h), P('魏延'));
});
test('战鼓：非猛将 ×2，之后上场的也算，猛将不翻倍', () => {
	const s = game(); const u = put(s, 'me', 'close', '蜀汉重步兵'); const h = put(s, 'me', 'close', '魏延');
	playName(s, 'me', '战鼓'); answer(s, 'close');
	eq(pw(s, 'me', u), P('蜀汉重步兵') * 2); eq(pw(s, 'me', h), P('魏延'));
	const u2 = put(s, 'me', 'close', '蜀汉盾兵'); eq(pw(s, 'me', u2), P('蜀汉盾兵') * 2);
});
test('战鼓：已有战鼓的排不能再选', () => {
	const s = game(); playName(s, 'me', '战鼓'); answer(s, 'close');
	put(s, 'me', 'hand', '战鼓'); s.turn = 'me';
	R.act(s, { type: 'play', uid: s.players.me.hand[0].uid });
	ok(!s.pending.cands.includes('close'));
});
test('计算顺序：天气置 1 → 同袍 ×2 → 士气 +1 → 战鼓 ×2', () => {
	const s = game(); const a = put(s, 'me', 'close', '白耳骑兵'); put(s, 'me', 'close', '白耳骑兵'); put(s, 'me', 'close', '蜀精锐步兵');
	playName(s, 'ai', '寒潮'); s.players.me.horn.close = true;
	eq(pw(s, 'me', a), ((1 * 2) + 1) * 2);
});
test('无双：吕布在场时对手近战排非猛将 -1，不影响猛将和其他排', () => {
	const s = game(); const u = put(s, 'ai', 'close', '曹魏重骑'); const h = put(s, 'ai', 'close', '典韦'); const r = put(s, 'ai', 'ranged', '曹魏弓兵');
	put(s, 'me', 'close', '吕布');
	eq(pw(s, 'ai', u), P('曹魏重骑') - 1); eq(pw(s, 'ai', h), P('典韦')); eq(pw(s, 'ai', r), P('曹魏弓兵'));
});

// ==================== 关键词 ====================
test('卧底：放到对手半场，自己抽 2 张', () => {
	const s = game(); put(s, 'ai', 'deck', '曹魏重骑'); put(s, 'ai', 'deck', '曹魏弓兵'); put(s, 'ai', 'deck', '典韦');
	playName(s, 'ai', '曹魏细作');
	eq(onField(s, 'me', '曹魏细作').length, 1); eq(onField(s, 'ai', '曹魏细作').length, 0); eq(s.players.ai.hand.length, 2);
});
test('死士：手牌和牌库里的同名牌一并上场', () => {
	const s = game({ me: 'huangjin' }); put(s, 'me', 'deck', '黄巾力士'); put(s, 'me', 'deck', '蜀汉重步兵');
	playName(s, 'me', '黄巾力士');
	eq(onField(s, 'me', '黄巾力士').length, 2); eq(s.players.me.deck.length, 1);
});
test('归阵：从弃牌堆选非猛将上场，猛将不在可选范围', () => {
	const s = game(); const d = put(s, 'me', 'discard', '蜀汉重步兵'); const h = put(s, 'me', 'discard', '魏延');
	playName(s, 'me', '蜀汉军医');
	ok(s.pending.cands.includes(d.uid)); ok(!s.pending.cands.includes(h.uid));
	answer(s, d.uid);
	eq(onField(s, 'me', '蜀汉重步兵').length, 1); eq(s.turn, 'ai', '选完后轮到对手');
});
test('归阵：弃牌堆没有可选单位时直接结束出牌', () => {
	const s = game(); playName(s, 'me', '蜀汉军医'); eq(s.pending, null); eq(s.turn, 'ai');
});
test('归阵：复活出来的单位不触发自己的技能', () => {
	const s = game(); const m = put(s, 'me', 'discard', '蜀汉军医'); put(s, 'me', 'discard', '蜀汉重步兵');
	playName(s, 'me', '蜀汉军医'); answer(s, m.uid);
	eq(s.pending, null, '被复活的军医不应再触发归阵');
});
test('灵活：打出时可选近战或远程', () => {
	const s = game(); const a = playName(s, 'me', '蜀汉轻骑', 'ranged');
	eq(R.rowOf(s.players.me, a), 'ranged');
});
test('火攻（关羽）：对手近战排 ≥10 时消灭其中最强的非猛将', () => {
	const s = game(); put(s, 'ai', 'close', '虎豹骑'); put(s, 'ai', 'close', '曹魏重骑'); put(s, 'ai', 'close', '典韦');
	playName(s, 'me', '关羽');
	eq(onField(s, 'ai', '虎豹骑').length, 0); eq(onField(s, 'ai', '曹魏重骑').length, 1); eq(onField(s, 'ai', '典韦').length, 1);
	eq(inZone(s, 'ai', 'discard', '虎豹骑'), 1);
});
test('火攻：对手那一排不足 10 时不触发', () => {
	const s = game(); put(s, 'ai', 'close', '曹魏重骑'); playName(s, 'me', '关羽');
	eq(onField(s, 'ai', '曹魏重骑').length, 1);
});
test('火攻（黄忠）打远程排，（黄盖）打攻城排', () => {
	const s = game(); put(s, 'ai', 'ranged', '曹魏细作统领'); put(s, 'ai', 'ranged', '夏侯渊'); put(s, 'ai', 'siege', '曹魏冲车'); put(s, 'ai', 'siege', '曹魏冲车');
	playName(s, 'me', '黄忠'); eq(onField(s, 'ai', '夏侯渊').length, 0);
	playName(s, 'me', '黄盖'); eq(onField(s, 'ai', '曹魏冲车').length, 0, '并列最高全部消灭');
});
test('火烧赤壁（周瑜）：消灭双方全场并列最高的非猛将', () => {
	const s = game({ me: 'dongwu' }); put(s, 'me', 'close', '东吴弩手'); put(s, 'ai', 'close', '曹魏弓兵'); put(s, 'ai', 'close', '曹魏弩卒');
	eq(P('东吴弩手'), P('曹魏弓兵'), '这条测试需要两张战力相同的牌'); ok(P('曹魏弩卒') < P('曹魏弓兵'));
	playName(s, 'me', '周瑜');
	eq(onField(s, 'me', '东吴弩手').length, 0); eq(onField(s, 'ai', '曹魏弓兵').length, 0); eq(onField(s, 'ai', '曹魏弩卒').length, 1);
});
test('借东风（诸葛亮）：可清除天气，也可从牌库打出天气牌', () => {
	let s = game(); playName(s, 'ai', '寒潮'); const w = put(s, 'me', 'deck', '大雾');
	playName(s, 'me', '诸葛亮'); answer(s, 'clear'); eq(s.weather.close, null);
	s = game(); const w2 = put(s, 'me', 'deck', '大雾'); playName(s, 'me', '诸葛亮'); answer(s, w2.uid);
	ok(s.weather.ranged && s.weather.ranged.uid === w2.uid);
});
test('借东风：牌库没有天气牌时直接清除天气', () => {
	const s = game(); playName(s, 'ai', '寒潮'); playName(s, 'me', '诸葛亮'); eq(s.pending, null); eq(s.weather.close, null);
});
test('暴政（董卓）：己方同排其他非猛将 -1', () => {
	const s = game(); const u = put(s, 'me', 'close', '蜀汉重步兵'); const h = put(s, 'me', 'close', '魏延');
	playName(s, 'me', '董卓'); eq(pw(s, 'me', u), P('蜀汉重步兵') - 1); eq(pw(s, 'me', h), P('魏延'));
});
test('离间（貂蝉）：只能选战力 ≤6 的非猛将，转投后留在原排', () => {
	const s = game(); const small = put(s, 'ai', 'close', '曹魏重骑'); const big = put(s, 'ai', 'siege', '曹魏冲车'); const h = put(s, 'ai', 'close', '典韦');
	playName(s, 'me', '貂蝉');
	ok(s.pending.cands.includes(small.uid)); ok(!s.pending.cands.includes(big.uid)); ok(!s.pending.cands.includes(h.uid));
	answer(s, small.uid);
	eq(R.rowOf(s.players.me, small), 'close'); eq(onField(s, 'ai', '曹魏重骑').length, 0);
});
test('幻术（左慈）：变成对手最强非猛将的战力', () => {
	const s = game(); put(s, 'ai', 'siege', '曹魏冲车'); put(s, 'ai', 'close', '典韦');
	const z = playName(s, 'me', '左慈'); eq(pw(s, 'me', z), P('曹魏冲车'));
});

// ==================== 特殊牌与天气 ====================
test('招降：收回己方非猛将，场上没有非猛将时不能打出', () => {
	const s = game(); const u = put(s, 'me', 'close', '蜀汉重步兵'); put(s, 'me', 'close', '魏延');
	playName(s, 'me', '招降'); ok(s.pending.cands.length === 1); answer(s, u.uid);
	eq(inZone(s, 'me', 'hand', '蜀汉重步兵'), 1);
	const s2 = game(); put(s2, 'me', 'close', '魏延'); const d = put(s2, 'me', 'hand', '招降'); s2.turn = 'me';
	throws(() => R.act(s2, { type: 'play', uid: d.uid }));
});
test('烽火燎原：全场并列最高的非猛将全部消灭，不分排、无门槛', () => {
	const s = game(); put(s, 'me', 'close', '蜀汉重步兵'); put(s, 'ai', 'close', '曹魏重骑'); put(s, 'ai', 'ranged', '曹魏弓兵');
	playName(s, 'me', '烽火燎原');
	eq(R.fieldUnits(s.players.me).length, 0); eq(onField(s, 'ai', '曹魏重骑').length, 0); eq(onField(s, 'ai', '曹魏弓兵').length, 1);
});
test('天气：三种可同时存在，同种覆盖时旧牌进弃牌堆，放晴全部清除', () => {
	const s = game(); playName(s, 'me', '寒潮'); playName(s, 'ai', '大雾'); playName(s, 'me', '暴雨');
	ok(s.weather.close && s.weather.ranged && s.weather.siege);
	playName(s, 'ai', '寒潮'); eq(inZone(s, 'me', 'discard', '寒潮'), 1);
	playName(s, 'me', '放晴'); eq(s.weather.close, null); eq(s.weather.ranged, null); eq(s.weather.siege, null);
});
test('海上狂风：同时压制远程排和攻城排', () => {
	const s = game({ me: 'dongwu' }); const a = put(s, 'ai', 'ranged', '曹魏弓兵'); const b = put(s, 'ai', 'siege', '曹魏冲车');
	playName(s, 'me', '海上狂风'); eq(pw(s, 'ai', a), 1); eq(pw(s, 'ai', b), 1);
});
test('蛮巫祭礼：该排死士 ×2，非死士不变', () => {
	const s = game({ me: 'huangjin' }); const m = put(s, 'me', 'close', '黄巾力士'); const u = put(s, 'me', 'close', '黄巾渠帅');
	playName(s, 'me', '蛮巫祭礼'); answer(s, 'close'); eq(pw(s, 'me', m), P('黄巾力士') * 2); eq(pw(s, 'me', u), P('黄巾渠帅'));
});

// ==================== 领袖技能 ====================
function useLeader(s, side) { s.turn = side; R.act(s, { type: 'leader' }); }
test('领袖：整场一次，使用后不消耗出牌机会', () => {
	const s = game(); put(s, 'me', 'discard', '蜀汉重步兵');
	useLeader(s, 'me'); answer(s, s.pending.cands[0]);
	eq(s.turn, 'me', '用完领袖技仍是我的回合'); ok(s.players.me.leaderUsed);
	throws(() => R.act(s, { type: 'leader' }));
});
test('领袖：没有目标时不可用', () => {
	const s = game(); s.turn = 'me'; ok(!R.leaderCan(s, 'me')); throws(() => R.act(s, { type: 'leader' }));
});
test('仁德（刘备）：弃牌堆选单位回手牌，可选猛将', () => {
	const s = game(); const h = put(s, 'me', 'discard', '魏延'); useLeader(s, 'me');
	ok(s.pending.cands.includes(h.uid)); answer(s, h.uid); eq(inZone(s, 'me', 'hand', '魏延'), 1);
});
test('相父辅政（刘禅）：牌库选同袍单位上场', () => {
	const s = game({ meLeader: '刘禅' }); const b = put(s, 'me', 'deck', '白耳骑兵'); put(s, 'me', 'deck', '蜀汉重步兵');
	useLeader(s, 'me'); eq(s.pending.cands.length, 1); answer(s, b.uid); eq(onField(s, 'me', '白耳骑兵').length, 1);
});
test('挟天子（曹操）：牌库选卧底打出，放到对手半场并抽 2 张', () => {
	const s = game({ me: 'caowei', ai: 'shuhan' }); const sp = put(s, 'me', 'deck', '曹魏细作'); put(s, 'me', 'deck', '曹魏重骑'); put(s, 'me', 'deck', '曹魏弓兵');
	useLeader(s, 'me'); answer(s, sp.uid);
	eq(onField(s, 'ai', '曹魏细作').length, 1); eq(s.players.me.hand.length, 2);
});
test('隐忍（司马懿）：收回一排的非猛将，第 3 局不可用', () => {
	const s = game({ me: 'caowei', ai: 'shuhan', meLeader: '司马懿' }); put(s, 'me', 'close', '曹魏重骑'); put(s, 'me', 'close', '典韦'); put(s, 'me', 'ranged', '曹魏弓兵');
	useLeader(s, 'me'); answer(s, 'close');
	eq(inZone(s, 'me', 'hand', '曹魏重骑'), 1); eq(onField(s, 'me', '典韦').length, 1); eq(onField(s, 'me', '曹魏弓兵').length, 1);
	const s3 = game({ me: 'caowei', ai: 'shuhan', meLeader: '司马懿' }); put(s3, 'me', 'close', '曹魏重骑'); s3.round = 3; s3.turn = 'me'; ok(!R.leaderCan(s3, 'me'));
});
test('江东之虎（孙坚）：从牌库打出天气牌', () => {
	const s = game({ me: 'dongwu', meLeader: '孙坚' }); const w = put(s, 'me', 'deck', '寒潮');
	useLeader(s, 'me'); answer(s, w.uid); ok(s.weather.close); eq(s.turn, 'me');
});
test('制衡（孙权）：弃 1 张抽 2 张', () => {
	const s = game({ me: 'dongwu' }); const h = put(s, 'me', 'hand', '江东新兵'); put(s, 'me', 'deck', '江东水军'); put(s, 'me', 'deck', '江东水军');
	useLeader(s, 'me'); answer(s, h.uid); eq(s.players.me.hand.length, 2); eq(inZone(s, 'me', 'discard', '江东新兵'), 1);
});
test('苍天已死（张角）：非猛将 ×2，局末移出游戏而不进弃牌堆', () => {
	const s = game({ me: 'huangjin' }); const u = put(s, 'me', 'close', '黄巾渠帅'); const h = put(s, 'me', 'close', '波才');
	useLeader(s, 'me'); eq(pw(s, 'me', u), (P('黄巾渠帅') + 1) * 2); eq(pw(s, 'me', h), P('波才'));
	R.act(s, { type: 'pass' }); R.act(s, { type: 'pass' });
	eq(inZone(s, 'me', 'removed', '黄巾渠帅'), 1); eq(inZone(s, 'me', 'discard', '黄巾渠帅'), 0);
});
test('撒豆成兵（张宝）：牌库选死士上场并带出同名牌', () => {
	const s = game({ me: 'huangjin', meLeader: '张宝' }); const a = put(s, 'me', 'deck', '黄巾力士'); put(s, 'me', 'deck', '黄巾力士'); put(s, 'me', 'hand', '黄巾力士');
	useLeader(s, 'me'); answer(s, a.uid); eq(onField(s, 'me', '黄巾力士').length, 3);
});
test('会盟（袁绍）：每张非猛将 -1，抽牌最多 3 张', () => {
	const s = game({ me: 'qunxiong' }); const us = ['南蛮蛮兵', '南蛮蛮兵', '羌弓手', '羌弓手'].map(n => put(s, 'me', 'close', n)); put(s, 'me', 'close', '颜良');
	for (let i = 0; i < 6; i++) put(s, 'me', 'deck', '南蛮部族兵');
	useLeader(s, 'me'); eq(pw(s, 'me', us[0]), P('南蛮蛮兵') - 1); eq(s.players.me.hand.length, 3);
});
test('西凉举义（马腾）：弃牌堆里同名死士一组全部上场', () => {
	const s = game({ me: 'qunxiong', meLeader: '马腾' }); const a = put(s, 'me', 'discard', '南蛮死士'); put(s, 'me', 'discard', '南蛮死士'); put(s, 'me', 'discard', '南蛮狂战士');
	useLeader(s, 'me'); eq(s.pending.cands.length, 2, '每个名字一个选项'); answer(s, a.uid);
	eq(onField(s, 'me', '南蛮死士').length, 2); eq(inZone(s, 'me', 'discard', '南蛮狂战士'), 1);
});
test('南蛮再起（孟获）：弃牌堆选最多 2 张南蛮单位上场，含祝融', () => {
	const s = game({ me: 'qunxiong', meLeader: '孟获' }); const a = put(s, 'me', 'discard', '南蛮勇士'); const z = put(s, 'me', 'discard', '祝融'); const x = put(s, 'me', 'discard', '颜良');
	useLeader(s, 'me'); ok(!s.pending.cands.includes(x.uid)); answer(s, [a.uid, z.uid]);
	eq(R.fieldUnits(s.players.me).length, 2);
});

// ==================== 阵营被动与对局流程 ====================
function bothPass(s) { R.act(s, { type: 'pass' }); R.act(s, { type: 'pass' }); }
test('清场：每局结束单位进弃牌堆，战鼓和天气清除', () => {
	const s = game(); put(s, 'me', 'close', '蜀汉重步兵'); playName(s, 'me', '战鼓'); answer(s, 'close'); playName(s, 'ai', '寒潮');
	s.turn = 'me'; bothPass(s);
	eq(R.fieldUnits(s.players.me).length, 0); eq(inZone(s, 'me', 'discard', '蜀汉重步兵'), 1); eq(s.players.me.horn.close, false); eq(s.weather.close, null); eq(s.round, 2);
});
test('每局开始双方各抽 2 张', () => {
	const s = game(); for (let i = 0; i < 4; i++) { put(s, 'me', 'deck', '蜀汉重步兵'); put(s, 'ai', 'deck', '曹魏重骑'); }
	put(s, 'ai', 'close', '曹魏重骑'); s.turn = 'me'; bothPass(s);
	eq(s.players.ai.hand.length, 2); eq(s.players.me.hand.length, 2);
});
test('蜀汉被动：赢一局额外抽 1 张', () => {
	const s = game(); for (let i = 0; i < 4; i++) put(s, 'me', 'deck', '蜀汉重步兵');
	put(s, 'me', 'close', '魏延'); s.turn = 'me'; bothPass(s); eq(s.players.me.hand.length, 3);
});
test('曹魏被动：平局判胜', () => {
	const s = game(); s.turn = 'me'; bothPass(s); eq(s.players.me.gems, 1); eq(s.players.ai.gems, 2);
});
test('普通平局：双方各掉一颗宝石', () => {
	const s = game({ me: 'shuhan', ai: 'dongwu' }); s.turn = 'me'; bothPass(s); eq(s.players.me.gems, 1); eq(s.players.ai.gems, 1);
});
test('东吴被动：灵活单位不受天气影响，其他单位照常受影响', () => {
	const s = game({ me: 'dongwu' }); const ag = put(s, 'me', 'close', '江东新兵'); const u = put(s, 'me', 'close', '江东水军');
	playName(s, 'ai', '寒潮'); eq(pw(s, 'me', ag), P('江东新兵')); eq(pw(s, 'me', u), 1);
});
test('黄巾被动：每局结束保留 1 张单位在场', () => {
	const s = game({ me: 'huangjin' }); put(s, 'me', 'close', '黄巾渠帅'); put(s, 'me', 'close', '黄巾渠帅'); s.turn = 'me'; bothPass(s);
	eq(R.fieldUnits(s.players.me).length, 1); eq(inZone(s, 'me', 'discard', '黄巾渠帅'), 1);
});
test('群雄被动：第 3 局开始从弃牌堆召回 2 张单位', () => {
	const s = game({ me: 'qunxiong', ai: 'shuhan' });
	put(s, 'me', 'close', '南蛮蛮兵'); put(s, 'me', 'close', '南蛮蛮兵'); put(s, 'me', 'close', '颜良');
	s.turn = 'me'; bothPass(s);            // 第 1 局我赢
	put(s, 'ai', 'close', '魏延'); bothPass(s); // 第 2 局对手赢
	eq(s.round, 3); eq(R.fieldUnits(s.players.me).length, 2);
});
test('过牌后对手可连续出牌，双方都过牌才结算', () => {
	const s = game(); const a = put(s, 'ai', 'hand', '曹魏重骑'); const b = put(s, 'ai', 'hand', '曹魏弓兵');
	s.turn = 'me'; R.act(s, { type: 'pass' }); eq(s.turn, 'ai');
	R.act(s, { type: 'play', uid: a.uid }); eq(s.turn, 'ai', '我已过牌，仍是对手回合');
	R.act(s, { type: 'play', uid: b.uid }); eq(s.round, 1);
	R.act(s, { type: 'pass' }); eq(s.round, 2);
});
test('三局两胜：输两局即结束', () => {
	const s = game({ me: 'shuhan', ai: 'dongwu' }); put(s, 'ai', 'close', '太史慈'); s.turn = 'me'; bothPass(s);
	put(s, 'ai', 'close', '甘宁'); bothPass(s);
	eq(s.phase, 'over'); eq(s.winner, 'ai');
});
test('开局换牌：最多 2 张，换完仍是 10 张', () => {
	const s = R.newGame({ seed: 3, first: 'me', me: { faction: 'shuhan', leader: '刘备', deck: R.recommendedDeck('shuhan') }, ai: { faction: 'caowei', leader: '曹操', deck: R.recommendedDeck('caowei') } });
	eq(s.players.me.hand.length, 10); const total = s.players.me.hand.length + s.players.me.deck.length;
	R.act(s, { type: 'mulligan', side: 'me', uid: s.players.me.hand[0].uid });
	R.act(s, { type: 'mulligan', side: 'me', uid: s.players.me.hand[0].uid });
	eq(s.players.me.hand.length, 10); eq(s.players.me.hand.length + s.players.me.deck.length, total); ok(s.players.me.kept);
	throws(() => R.act(s, { type: 'mulligan', side: 'me', uid: s.players.me.hand[0].uid }));
	eq(s.phase, 'mulligan'); R.act(s, { type: 'keep', side: 'ai' }); eq(s.phase, 'play');
});

// ==================== 牌组 ====================
test('推荐牌组对每个势力都合法', () => {
	A.PLAYABLE_FACTIONS.forEach(f => { const v = R.validateDeck(f, LEADER_OF[f], R.recommendedDeck(f)); ok(v.ok, f + ' ' + v.errors.join('；')); });
});
test('牌组校验：单位不足、超张数、带了别家专属牌、中立过多都会报错', () => {
	const rec = R.recommendedDeck('shuhan');
	ok(!R.validateDeck('shuhan', '刘备', rec.slice(5)).ok, '单位不足');
	ok(!R.validateDeck('shuhan', '刘备', rec.concat([card('关羽').id])).ok, '关羽只能 1 张');
	ok(!R.validateDeck('shuhan', '刘备', rec.concat([card('海上狂风').id])).ok, '海上狂风是东吴专属');
	ok(!R.validateDeck('shuhan', '曹操', rec).ok, '领袖不属于该势力');
	const neu = ['吕布', '董卓', '李儒', '于吉', '说书人', '貂蝉', '左慈'].map(n => card(n).id);
	ok(!R.validateDeck('shuhan', '刘备', rec.concat(neu)).ok, '中立超过 6 张');
});

// ==================== 随机对局：卡牌守恒 ====================
function countAll(s) {
	let n = 0; const seen = new Set(); let dup = false;
	const add = c => { if (c.copy) return; if (seen.has(c.uid)) dup = true; seen.add(c.uid); n++; };
	['me', 'ai'].forEach(x => { const P = s.players[x]; P.hand.forEach(add); P.deck.forEach(add); P.discard.forEach(add); P.removed.forEach(add); R.ROWS.forEach(r => P.rows[r].forEach(add)); });
	const w = new Set(); R.ROWS.forEach(r => { const c = s.weather[r]; if (c && !w.has(c.uid)) { w.add(c.uid); add(c); } });
	return { n, dup };
}
test('随机对局 400 局：不丢牌、不多牌、不卡死、战力不为负', () => {
	const leaders = {}; R.CARDS.filter(c => c.kind === 'leader').forEach(c => (leaders[c.faction] = leaders[c.faction] || []).push(c.name));
	let seedRng = 12345; const rr = () => { seedRng = (seedRng * 1103515245 + 12345) & 0x7fffffff; return seedRng / 0x7fffffff; };
	const pick = arr => arr[Math.floor(rr() * arr.length)];
	let games = 0, leaderUses = 0;
	for (let g = 0; g < 400; g++) {
		const mf = pick(A.PLAYABLE_FACTIONS), af = pick(A.PLAYABLE_FACTIONS);
		const s = R.newGame({ seed: 1000 + g, me: { faction: mf, leader: pick(leaders[mf]), deck: R.recommendedDeck(mf) }, ai: { faction: af, leader: pick(leaders[af]), deck: R.recommendedDeck(af) } });
		const start = countAll(s).n; let steps = 0;
		while (s.phase !== 'over') {
			if (++steps > 600) throw new Error('对局卡死 seed=' + (1000 + g) + ' ' + mf + ' vs ' + af);
			let side = s.pending ? s.pending.side : s.phase === 'mulligan' ? (s.players.me.kept ? 'ai' : 'me') : s.turn;
			const acts = R.legalActions(s, side);
			if (!acts.length) throw new Error('没有合法操作 seed=' + (1000 + g) + ' phase=' + s.phase);
			// 随机策略：过牌的概率压低一些，让对局能打出更多牌
			let a = pick(acts); if (a.type === 'pass' && acts.length > 1 && rr() < 0.8) a = pick(acts.filter(x => x.type !== 'pass'));
			if (a.type === 'leader') leaderUses++;
			if (a.type === 'mulligan' || a.type === 'keep') a.side = side;
			R.act(s, a);
			const c = countAll(s);
			if (c.dup) throw new Error('同一张牌出现在两个地方 seed=' + (1000 + g));
			if (c.n !== start) throw new Error('牌数变化 ' + start + ' -> ' + c.n + ' seed=' + (1000 + g) + ' 操作=' + JSON.stringify(a));
			const tm = R.total(s, 'me'), ta = R.total(s, 'ai');
			if (!(tm >= 0 && ta >= 0) || !isFinite(tm + ta)) throw new Error('战力异常 seed=' + (1000 + g));
		}
		games++;
	}
	ok(games === 400); ok(leaderUses > 200, '领袖技能使用次数过少：' + leaderUses);
});
test('同一个种子重放，结果完全一致', () => {
	const run = () => { const s = R.newGame({ seed: 99, me: { faction: 'shuhan', leader: '刘备', deck: R.recommendedDeck('shuhan') }, ai: { faction: 'huangjin', leader: '张角', deck: R.recommendedDeck('huangjin') } });
		let i = 0; while (s.phase !== 'over' && i++ < 600) { const side = s.pending ? s.pending.side : s.phase === 'mulligan' ? (s.players.me.kept ? 'ai' : 'me') : s.turn; const acts = R.legalActions(s, side); const a = acts[(i * 7) % acts.length]; if (a.type === 'mulligan' || a.type === 'keep') a.side = side; R.act(s, a); }
		return JSON.stringify(s.roundScores) + s.winner; };
	eq(run(), run());
});
test('状态可以复制，复制品与原状态互不影响', () => {
	const s = game(); put(s, 'me', 'close', '蜀汉重步兵'); const c = R.clone(s);
	put(c, 'me', 'close', '魏延'); eq(R.total(s, 'me'), P('蜀汉重步兵')); eq(R.total(c, 'me'), P('蜀汉重步兵') + P('魏延'));
});

console.log(`通过 ${pass} 项，失败 ${fail} 项`);
failures.forEach(f => console.log('  失败：' + f));
process.exit(fail ? 1 : 0);
