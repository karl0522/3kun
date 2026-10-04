// 三坤牌 界面（重设计方案 v4）。只负责显示和触控，规则全部交给 Rules/Effects，AI 交给 AI。
(function () {
'use strict';
var R = Rules;
var G = null;                 // 当前对局状态
var level = 'normal';         // AI 难度
var selUid = null;            // 手牌面板里选中的牌
var logSeen = 0, aiTimer = null, listSel = [];
function $(id) { return document.getElementById(id); }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }

// ==================== 卡面 ====================
var ICON_ROW = { close: 'card_row_close', ranged: 'card_row_ranged', siege: 'card_row_siege', agile: 'card_row_agile' };
var ICON_AB = { spy: 'card_ability_spy', medic: 'card_ability_medic', horn: 'card_ability_horn', scorch: 'card_ability_scorch', scorch_row: 'card_ability_scorch', scorch_all: 'card_ability_scorch', bond: 'card_ability_bond', morale: 'card_ability_morale', muster: 'card_ability_muster', decoy: 'card_ability_decoy', mardroeme: 'card_ability_mardroeme', frost: 'card_ability_frost', fog: 'card_ability_fog', rain: 'card_ability_rain', clear: 'card_ability_clear', storm: 'card_ability_storm' };
var FACTION_BG = { shuhan: ['#1f4a2c', '#0d2214'], caowei: ['#1d3a63', '#0b182b'], dongwu: ['#6b2420', '#2a0e0c'], huangjin: ['#7a6314', '#2e2606'], qunxiong: ['#3d3a36', '#17150f'], neutral: ['#4d2a63', '#1e0f28'] };
var NO_ART = {};              // 缺图的牌在这里登记名字，会显示阵营色占位卡面
function artStyle(d, size) {
	var bg = FACTION_BG[d.faction] || FACTION_BG.neutral, grad = 'linear-gradient(160deg,' + bg[0] + ',' + bg[1] + ')';
	if (NO_ART[d.art]) return 'background-image:' + grad;
	return "background-image:url('img/sanguo-" + (size === 'md' ? 'md' : 'sm') + '/' + d.art + ".webp')," + grad;
}
function artName(d) { return NO_ART[d.art] ? '<div class="noart"><i>' + d.name.charAt(0) + '</i><span>' + d.name + '</span></div>' : ''; }
function isHeroDef(d) { return R.has(d, 'hero'); }
function rarityCls(d) {
	if (d.kind === 'weather') return 'rarity-weather weather';
	if (d.kind === 'special') return 'rarity-special special';
	if (d.rarity === 'gold') return 'rarity-gold hero';
	return d.rarity === 'bronze' ? 'rarity-bronze' : 'rarity-silver';
}
function iconsHTML(d) {
	if (d.kind === 'weather') return '<div class="row-icon"><img src="img/icons/' + ICON_AB[d.abilities[0].k] + '.png" alt=""></div>';
	var h = '';
	if (d.kind !== 'special' && ICON_ROW[d.row]) h += '<div class="row-icon"><img src="img/icons/' + ICON_ROW[d.row] + '.png" alt=""></div>';
	var ab = (d.abilities || []).filter(function (a) { return ICON_AB[a.k]; });
	if (ab.length) h += '<div class="ability-icon">' + ab.map(function (a) { return '<div class="ai"><img src="img/icons/' + ICON_AB[a.k] + '.png" alt=""></div>'; }).join('') + '</div>';
	return h;
}
function pwHTML(d, value) {
	if (d.kind !== 'unit' && d.kind !== 'token') return '';
	var v = value == null ? d.power : value, cls = value == null || v === d.power ? '' : (v > d.power ? ' up' : ' down');
	return '<div class="pw' + cls + '">' + v + '</div>';
}
function cardHTML(d, o) {
	o = o || {};
	return '<div class="card ' + rarityCls(d) + (o.cls ? ' ' + o.cls : '') + '"' + (o.attr || '') + ' style="' + (o.style || '') + artStyle(d, 'sm') + '">'
		+ artName(d) + pwHTML(d, o.power) + iconsHTML(d) + '</div>';
}
function capHTML(d) {
	var n = describeCard(d).names;
	return '<div class="cap"><div class="cn' + (d.name.length > 5 ? ' long' : '') + '">' + d.name + '</div><div class="ca">' + n.join('·') + '</div></div>';
}
function metaText(d) {
	if (d.kind === 'leader') return '领袖 · ' + FACTION_DEFS[d.faction].name;
	if (d.kind === 'special') return '特殊牌';
	if (d.kind === 'weather') return '天气牌';
	return '战力 ' + d.power + ' · ' + ROW_NAME[d.row] + ' · ' + FACTION_DEFS[d.faction].name;
}
function descText(d) { var l = describeCard(d).lines; return l.length ? l.join('；') : '没有技能'; }

// ==================== 提示、弹窗 ====================
var toastTimer, toastQueue = [], toastBusy = false;
function toast(msg) { toastQueue.push(msg); if (toastQueue.length > 4) toastQueue.splice(0, toastQueue.length - 4); if (!toastBusy) nextToast(); }
function nextToast() {
	var t = $('toast');
	if (!toastQueue.length) { toastBusy = false; t.classList.remove('show'); return; }
	toastBusy = true; t.textContent = toastQueue.shift(); t.classList.add('show');
	clearTimeout(toastTimer); toastTimer = setTimeout(nextToast, toastQueue.length ? 900 : 1500);
}
function banner(l1, l2) {
	var b = $('roundBanner');
	b.innerHTML = '<div class="rb"><div class="rb1">' + l1 + '</div><div class="rb2">' + l2 + '</div></div>';
	b.classList.add('show'); setTimeout(function () { b.classList.remove('show'); }, 1900);
}
function showPrompt(text) { var el = $('actionPrompt'); el.textContent = text; el.classList.add('show'); }
function hidePrompt() { $('actionPrompt').classList.remove('show'); }
function openModal(d) {
	var mc = $('modalCard'); mc.setAttribute('style', artStyle(d, 'md')); mc.innerHTML = artName(d);
	$('modalName').textContent = d.name;
	$('modalMeta').innerHTML = '<span>' + metaText(d) + '</span>' + (d.copies > 1 ? '<span>可带 ' + d.copies + ' 张</span>' : '');
	$('modalDesc').innerHTML = (describeCard(d).lines.join('<br>') || '没有技能') + (d.flavor ? '<br><span style="color:var(--ink-dim)">' + d.flavor + '</span>' : '');
	$('cardModal').classList.add('show');
}
$('modalClose').addEventListener('click', function () { $('cardModal').classList.remove('show'); });
$('cardModal').addEventListener('click', function (e) { if (e.target === this) this.classList.remove('show'); });

// ==================== 对局渲染 ====================
function myPending() { return G && G.pending && G.pending.side === 'me' ? G.pending : null; }
function isCand(v) { var p = myPending(); return !!p && p.cands.indexOf(v) >= 0; }
function leaderDef(side) { return R.BY_ID[G.players[side].leaderCid]; }
function renderOpBar() {
	var P = G.players.ai, L = leaderDef('ai'), gems = '';
	for (var i = 0; i < 2; i++) gems += '<div class="gem' + (i < P.gems ? ' on' : '') + '"></div>';
	$('opbar').innerHTML = '<div class="ava" id="opAva" style="' + artStyle(L, 'sm') + (P.leaderUsed ? ';filter:grayscale(1) brightness(.6)' : '') + '"></div>'
		+ '<div class="opname">' + L.name + '<small>' + FACTION_DEFS[P.faction].name + '</small></div>'
		+ '<div class="hud"><div class="it score"><b>' + R.total(G, 'ai') + '</b>总战力</div>'
		+ '<div class="it"><b>' + P.hand.length + '</b>手牌</div><div class="it"><b>第' + G.round + '局</b></div><div class="gems">' + gems + '</div></div>';
}
function renderField(id, side) {
	var P = G.players[side], isMe = side === 'me', p = myPending();
	var rows = isMe ? ['close', 'ranged', 'siege'] : ['siege', 'ranged', 'close'], html = '';
	rows.forEach(function (r) {
		var rowPick = isMe && p && p.type === 'row' && p.cands.indexOf(r) >= 0;
		var flags = (P.horn[r] ? '战鼓 ' : '') + (P.mard[r] ? '祭礼 ' : '') + (G.weather[r] ? '天气' : '');
		html += '<div class="crow' + (rowPick ? ' pickable' : '') + '" data-row="' + r + '"><div class="lab">' + ROW_NAME[r] + '</div><div class="cards">';
		P.rows[r].forEach(function (c) {
			var d = R.def(c), cardPick = p && p.type === 'card' && (p.zone === (isMe ? 'field' : 'oppField')) && isCand(c.uid);
			html += cardHTML(d, { power: R.power(G, side, c, r), cls: (cardPick ? 'pickable ' : '') + (c.isNew ? 'just-played' : ''), attr: ' data-uid="' + c.uid + '"' });
			delete c.isNew;
		});
		html += '</div>' + (flags ? '<div class="flags">' + flags + '</div>' : '') + '<div class="rsc">' + R.rowTotal(G, side, r) + '</div></div>';
	});
	$(id).innerHTML = html;
}
function renderWeather() {
	var seen = {}, h = '';
	R.ROWS.forEach(function (r) { var w = G.weather[r]; if (w && !seen[w.uid]) { seen[w.uid] = 1; h += '<div class="wcard" data-cid="' + w.cid + '" style="' + artStyle(R.def(w), 'sm') + '"></div>'; } });
	$('weather').innerHTML = h;
}
function renderMeBar() {
	var P = G.players.me, L = leaderDef('me'), lead = $('leader');
	lead.setAttribute('style', artStyle(L, 'sm'));
	lead.className = P.leaderUsed ? 'used' : (G.phase === 'play' && !G.pending && G.turn === 'me' && R.leaderCan(G, 'me') ? 'ready' : '');
	$('mestats').innerHTML = L.name + ' · ' + FACTION_DEFS[P.faction].name + '<br>牌库 <b>' + P.deck.length + '</b> &nbsp; 手牌 <b>' + P.hand.length + '</b>';
	$('tot').innerHTML = '<b>' + R.total(G, 'me') + '</b><span>总战力</span>';
	var gems = ''; for (var i = 0; i < 2; i++) gems += '<i class="gem' + (i < P.gems ? ' on' : '') + '" style="display:inline-block;margin-left:2px"></i>';
	$('mestats').innerHTML += ' &nbsp;' + gems;
	var pass = $('pass'); pass.textContent = P.passed ? '已过' : '过牌'; pass.className = P.passed ? 'passed' : '';
	var tag = $('turnTag');
	if (G.pending && G.pending.side === 'ai' || G.turn === 'ai') { tag.textContent = '对手回合'; tag.style.background = '#555'; }
	else { tag.textContent = P.passed ? '等待对手…' : '你的回合'; tag.style.background = 'var(--gold)'; }
}
function renderHandFan() {
	var c = $('handStack'), hand = G.players.me.hand, n = hand.length;
	if (!n) { c.innerHTML = '<div class="none">暂无手牌</div>'; return; }
	var W = c.clientWidth || 280, cw = 56, step = n > 1 ? Math.min(cw + 4, (W - cw) / (n - 1)) : 0;
	c.innerHTML = hand.map(function (inst, i) { return cardHTML(R.def(inst), { attr: ' data-uid="' + inst.uid + '"', style: 'left:' + Math.round(i * step) + 'px;' }); }).join('');
}
function renderDiscardPile() {
	var el = $('discardPile'), ds = G.players.me.discard, n = ds.length;
	if (!n) { el.className = ''; el.removeAttribute('style'); el.innerHTML = '<span class="dp-label">弃牌堆</span><span class="dp-count">0</span>'; return; }
	var top = R.def(ds[n - 1]);
	el.className = 'has'; el.setAttribute('style', artStyle(top, 'sm'));
	el.innerHTML = artName(top) + '<div class="dp-shade"></div><span class="dp-label">弃牌堆</span><span class="dp-count">' + n + '</span>';
}
function handPickMode() { var p = myPending(); return !!p && p.type === 'card' && p.zone === 'hand'; }
function renderHandPanel() {
	var hand = G.players.me.hand;
	$('handCount').textContent = hand.length + ' 张';
	$('handCards').innerHTML = hand.map(function (inst) {
		return '<div class="hc' + (selUid === inst.uid ? ' selected' : '') + '" data-uid="' + inst.uid + '">' + cardHTML(R.def(inst)) + capHTML(R.def(inst)) + '</div>';
	}).join('');
	renderDetailBar();
}
function renderDetailBar() {
	var bar = $('detailBar'), inst = null;
	G.players.me.hand.forEach(function (c) { if (c.uid === selUid) inst = c; });
	if (handPickMode()) { bar.className = 'empty'; bar.textContent = myPending().prompt; return; }
	if (!inst) { bar.className = 'empty'; bar.textContent = '点击手牌查看详情'; return; }
	var d = R.def(inst), rk = d.kind === 'weather' ? 'weather' : d.kind === 'special' ? 'special' : d.rarity;
	bar.className = '';
	var can = canIPlay(inst), agile = d.kind === 'unit' && d.row === 'agile';
	bar.innerHTML = '<div class="thumb ' + rk + '" style="' + artStyle(d, 'sm') + '">' + artName(d) + (d.kind === 'unit' ? '<div class="tpw">' + d.power + '</div>' : '') + '<div class="tname">' + d.name + '</div></div>'
		+ '<div class="info"><div class="n">' + d.name + '</div><div class="meta">' + metaText(d) + '</div><div class="desc">' + descText(d) + '</div></div>'
		+ (agile ? '<div style="display:flex;flex-direction:column;gap:6px"><button class="playBtn" data-row="close" style="min-height:0;padding:8px 14px;font-size:14px"' + (can ? '' : ' disabled') + '>放近战</button><button class="playBtn" data-row="ranged" style="min-height:0;padding:8px 14px;font-size:14px"' + (can ? '' : ' disabled') + '>放远程</button></div>'
			: '<button class="playBtn"' + (can ? '' : ' disabled style="opacity:.4"') + '>出牌</button>');
}
function canIPlay(inst) { return G.phase === 'play' && !G.pending && G.turn === 'me' && !G.players.me.passed && R.canPlay(G, 'me', inst); }
function render() {
	renderOpBar(); renderField('fop', 'ai'); renderField('fme', 'me'); renderWeather(); renderMeBar(); renderHandFan(); renderDiscardPile();
	if ($('handPanel').classList.contains('open')) renderHandPanel();
}

// ==================== 操作与流程 ====================
function markNew(before) {
	['me', 'ai'].forEach(function (s) { R.fieldUnits(G.players[s]).forEach(function (c) { if (!before[c.uid]) c.isNew = true; }); });
}
function fieldUids() { var m = {}; ['me', 'ai'].forEach(function (s) { R.fieldUnits(G.players[s]).forEach(function (c) { m[c.uid] = 1; }); }); return m; }
function doAct(action) {
	var before = fieldUids(), rounds = G.roundScores.length;
	try { R.act(G, action); } catch (e) { toast(e.message); return false; }
	markNew(before);
	afterChange(rounds);
	return true;
}
function afterChange(roundsBefore) {
	// 把引擎的记录变成提示
	for (; logSeen < G.log.length; logSeen++) { var e = G.log[logSeen]; if (!/^第 \d 局/.test(e.text) && e.text.indexOf('对局结束') < 0) toast(e.text); }
	var delay = 900;
	if (G.roundScores.length > roundsBefore) {
		var rs = G.roundScores[G.roundScores.length - 1];
		banner('第 ' + G.roundScores.length + ' 局 ' + (rs.winner === 'me' ? '你赢了' : rs.winner === 'ai' ? '你输了' : '平局'), '你 ' + rs.me + ' : ' + rs.ai + ' 对手');
		toastQueue = []; closePanel(); closeList(); delay = 2300;   // 局结算时清掉排队中的提示，避免盖在横幅上
	}
	syncPendingUI();
	render();
	if (G.phase === 'over') { setTimeout(showEnd, 2000); return; }
	scheduleAI(delay);
}
function scheduleAI(delay) {
	clearTimeout(aiTimer);
	if (G.phase !== 'play') return;
	var aiTurn = G.pending ? G.pending.side === 'ai' : G.turn === 'ai';
	if (!aiTurn) return;
	aiTimer = setTimeout(function () {
		var a = AI.choose(G, 'ai', level);
		if (a) doAct(a);
	}, delay || 900);
}
// 根据"请选择"的类型，打开对应的界面
function syncPendingUI() {
	var p = myPending();
	if (!p) { hidePrompt(); if (listMode === 'pick') closeList(); return; }
	if (p.type === 'row' || (p.type === 'card' && (p.zone === 'field' || p.zone === 'oppField'))) { closePanel(); showPrompt(p.prompt + (p.type === 'row' ? '（点我方战场的那一排）' : '')); return; }
	hidePrompt();
	if (p.type === 'card' && p.zone === 'hand') { openPanel(); return; }
	openPickList(p);
}
function showEnd() {
	var r = $('endResult'), w = G.winner;
	r.textContent = w === 'me' ? '胜利' : w === 'ai' ? '失败' : '平局';
	r.className = 'result ' + (w === 'me' ? 'win' : w === 'ai' ? 'lose' : 'draw');
	var mw = G.roundScores.filter(function (x) { return x.winner === 'me'; }).length, aw = G.roundScores.filter(function (x) { return x.winner === 'ai'; }).length;
	$('endRounds').textContent = '比分 ' + mw + ' : ' + aw + '　（' + G.roundScores.map(function (x) { return x.me + ':' + x.ai; }).join('　') + '）';
	$('endScreen').classList.add('show');
}

// ----- 手牌面板 -----
var panel = $('handPanel'), mask = $('mask');
function openPanel(uid) {
	panel.classList.add('open'); mask.classList.add('show');
	selUid = uid || null; renderHandPanel();
	var s = document.querySelector('#handCards .hc.selected'); if (s) $('handCards').scrollLeft = Math.max(0, s.offsetLeft - 24);
}
function closePanel() { panel.classList.remove('open'); if (!$('discardPanel').classList.contains('open')) mask.classList.remove('show'); selUid = null; }
$('handStack').addEventListener('click', function (e) {
	if (myPending() && !handPickMode()) { toast('请先完成当前的选择'); return; }
	var el = e.target.closest('.card'); openPanel(el ? parseInt(el.dataset.uid) : null);
});
$('handClose').addEventListener('click', closePanel);
mask.addEventListener('click', function () { if (myPending() && (listMode === 'pick' || handPickMode())) return; closeList(); closePanel(); });
$('handCards').addEventListener('click', function (e) {
	var item = e.target.closest('.hc'); if (!item) return;
	var uid = parseInt(item.dataset.uid);
	if (handPickMode()) { if (isCand(uid)) { closePanel(); doAct({ type: 'answer', sel: [uid] }); } return; }
	selUid = uid;
	document.querySelectorAll('#handCards .hc').forEach(function (el) { el.classList.toggle('selected', parseInt(el.dataset.uid) === uid); });
	renderDetailBar();
});
$('detailBar').addEventListener('click', function (e) {
	var b = e.target.closest('.playBtn'); if (!b || b.disabled || selUid == null) return;
	var uid = selUid; closePanel();
	doAct({ type: 'play', uid: uid, row: b.dataset.row });
});

// ----- 战场点击：选目标，或看卡牌详情 -----
function fieldClick(e) {
	var onMe = e.currentTarget.id === 'fme', cardEl = e.target.closest('.card'), rowEl = e.target.closest('.crow'), p = myPending();
	if (p) {
		if (p.type === 'row' && onMe && rowEl) { if (isCand(rowEl.dataset.row)) doAct({ type: 'answer', sel: [rowEl.dataset.row] }); else toast('这一排不能选'); return; }
		if (p.type === 'card' && cardEl && ((p.zone === 'field' && onMe) || (p.zone === 'oppField' && !onMe))) {
			var uid = parseInt(cardEl.dataset.uid);
			if (isCand(uid)) doAct({ type: 'answer', sel: [uid] }); else toast('这张牌不能选');
			return;
		}
	}
	if (cardEl) { var f = R.findOnField(G, parseInt(cardEl.dataset.uid)); if (f) openModal(R.def(f.inst)); }
}
$('fop').addEventListener('click', fieldClick); $('fme').addEventListener('click', fieldClick);
$('weather').addEventListener('click', function (e) { var w = e.target.closest('.wcard'); if (w) openModal(R.BY_ID[parseInt(w.dataset.cid)]); });
$('pass').addEventListener('click', function () {
	if (!G || G.phase !== 'play') return;
	if (myPending()) { toast('请先完成当前的选择'); return; }
	if (G.turn !== 'me' || G.players.me.passed) return;
	closePanel(); doAct({ type: 'pass' });
});

// ----- 列表面板：弃牌堆查看 / 从弃牌堆或牌库里选牌 -----
var listMode = null, listItems = [];
function openList(title, items, mode) {
	listMode = mode; listItems = items; listSel = [];
	$('discardTitle').textContent = title;
	renderList();
	$('discardPanel').classList.add('open'); mask.classList.add('show');
}
function renderList() {
	var p = myPending(), multi = listMode === 'pick' && p && p.max > 1;
	$('discardClose').style.display = listMode === 'pick' ? 'none' : '';
	$('discardOk').style.display = multi ? '' : 'none';
	$('discardOk').textContent = '确定（' + listSel.length + '）';
	$('discardCards').innerHTML = listItems.length ? listItems.map(function (it, i) {
		if (it.opt) return '<div class="opt" data-i="' + i + '">' + it.label + '</div>';
		return '<div class="dc' + (listSel.indexOf(it.value) >= 0 ? ' sel' : '') + '" data-i="' + i + '">' + cardHTML(it.def) + capHTML(it.def) + '</div>';
	}).join('') : '<div class="dempty">这里是空的</div>';
}
function closeList() { $('discardPanel').classList.remove('open'); if (!panel.classList.contains('open')) mask.classList.remove('show'); listMode = null; }
function openPickList(p) {
	var P = G.players.me, zone = p.zone === 'deck' ? P.deck : P.discard;
	var items = p.cands.map(function (v) {
		if (v === 'clear') return { opt: true, value: v, label: '清除<br>全部天气' };
		var inst = null; zone.forEach(function (c) { if (c.uid === v) inst = c; });
		return { value: v, def: R.def(inst) };
	});
	openList(p.prompt, items, 'pick');
}
$('discardCards').addEventListener('click', function (e) {
	var el = e.target.closest('[data-i]'); if (!el) return;
	var it = listItems[parseInt(el.dataset.i)], p = myPending();
	if (listMode !== 'pick' || !p) { if (it.def) openModal(it.def); return; }
	if (p.max > 1) {
		var k = listSel.indexOf(it.value);
		if (k >= 0) listSel.splice(k, 1); else if (listSel.length < p.max) listSel.push(it.value); else toast('最多选 ' + p.max + ' 张');
		renderList(); return;
	}
	closeList(); doAct({ type: 'answer', sel: [it.value] });
});
$('discardOk').addEventListener('click', function () {
	var p = myPending(); if (!p) return;
	if (listSel.length < p.min) { toast('至少选 ' + p.min + ' 张'); return; }
	var sel = listSel.slice(); closeList(); doAct({ type: 'answer', sel: sel });
});
$('discardClose').addEventListener('click', closeList);
$('discardPile').addEventListener('click', function () {
	if (!G) return; if (myPending()) { toast('请先完成当前的选择'); return; }
	var items = G.players.me.discard.slice().reverse().map(function (c) { return { value: c.uid, def: R.def(c) }; });
	openList('我的弃牌堆（' + items.length + '）', items, 'view');
});

// ----- 领袖 -----
var leaderSide = 'me';
function leaderBlock() {
	var P = G.players.me, sk = LEADER_SKILL_DEFS[leaderDef('me').skill];
	if (P.leaderUsed) return '本场已经使用过了';
	if (G.phase !== 'play' || G.pending || G.turn !== 'me' || P.passed) return '现在不是你的出牌回合';
	if (!R.leaderCan(G, 'me')) return '暂时不能用：' + sk.need;
	return '';
}
function openLeader(side) {
	leaderSide = side;
	var L = leaderDef(side), sk = LEADER_SKILL_DEFS[L.skill], F = FACTION_DEFS[L.faction], port = $('leaderPort');
	port.setAttribute('style', artStyle(L, 'md')); port.innerHTML = artName(L);
	$('leaderName').textContent = L.name;
	$('leaderFac').textContent = (side === 'me' ? '你的领袖' : '对手的领袖') + ' · ' + F.name;
	$('leaderSkill').textContent = '「' + sk.name + '」每场一次';
	$('leaderDesc').innerHTML = sk.text + '。使用后不消耗出牌机会。<br><span style="color:var(--ink-dim)">阵营被动「' + F.passiveName + '」：' + F.passiveText + '</span>';
	var why = side === 'me' ? leaderBlock() : (G.players.ai.leaderUsed ? '对手已经用过了' : '对手还没有使用');
	$('leaderNote').textContent = why;
	$('leaderUse').style.display = side === 'me' ? '' : 'none';
	$('leaderUse').disabled = !!why;
	$('leaderCancel').textContent = side === 'me' ? '取消' : '关闭';
	$('leaderModal').classList.add('show');
}
function closeLeader() { $('leaderModal').classList.remove('show'); }
$('leader').addEventListener('click', function () { if (G) openLeader('me'); });
$('opbar').addEventListener('click', function (e) { if (G && e.target.closest('#opAva')) openLeader('ai'); });
$('leaderCancel').addEventListener('click', closeLeader);
$('leaderModal').addEventListener('click', function (e) { if (e.target === this) closeLeader(); });
$('leaderUse').addEventListener('click', function () { if (leaderSide !== 'me' || leaderBlock()) return; closeLeader(); doAct({ type: 'leader' }); });

// ==================== 选择牌组 ====================
var D = { faction: 'shuhan', leader: '刘备', counts: {}, filter: 'all', oppFaction: 'random', oppLeader: 'random' };
function leadersOf(f) { return R.CARDS.filter(function (c) { return c.kind === 'leader' && c.faction === f; }); }
function deckIds() { var ids = []; Object.keys(D.counts).forEach(function (id) { for (var i = 0; i < D.counts[id]; i++) ids.push(parseInt(id)); }); return ids; }
function countsFrom(ids) { var m = {}; ids.forEach(function (id) { m[id] = (m[id] || 0) + 1; }); return m; }
function loadDeck(f) {
	var raw = store('3kun2_deck_' + f);
	if (raw) { try { var ids = JSON.parse(raw); if (R.validateDeck(f, leadersOf(f)[0].name, ids).ok) return countsFrom(ids); } catch (e) {} }
	return countsFrom(R.recommendedDeck(f));
}
function loadLeader(f) { var n = store('3kun2_leader_' + f), ls = leadersOf(f).map(function (c) { return c.name; }); return ls.indexOf(n) >= 0 ? n : ls[0]; }
function sortedPool() {
	return R.deckPool(D.faction).slice().sort(function (a, b) {
		var ka = a.kind === 'unit' ? (a.faction === 'neutral' ? 1 : 0) : 2, kb = b.kind === 'unit' ? (b.faction === 'neutral' ? 1 : 0) : 2;
		return ka - kb || (isHeroDef(b) - isHeroDef(a)) || ((b.power || 0) - (a.power || 0)) || a.id - b.id;
	});
}
function renderDeck() {
	$('dkFactions').innerHTML = PLAYABLE_FACTIONS.map(function (f) { return '<div class="fchip' + (D.faction === f ? ' on' : '') + '" data-f="' + f + '">' + FACTION_DEFS[f].name + '</div>'; }).join('');
	$('dkLeaders').style.display = '';
	$('dkLeaders').innerHTML = leadersOf(D.faction).map(function (c) { return '<div class="lchip' + (D.leader === c.name ? ' on' : '') + '" data-l="' + c.name + '">' + c.name + '<small>' + LEADER_SKILL_DEFS[c.skill].name + '</small></div>'; }).join('');
	var L = leadersOf(D.faction).filter(function (c) { return c.name === D.leader; })[0], sk = LEADER_SKILL_DEFS[L.skill], F = FACTION_DEFS[D.faction];
	$('dkLeader').innerHTML = '<div class="lav" style="' + artStyle(L, 'sm') + '"></div><div class="linfo"><div class="ln">' + L.name + ' · 「' + sk.name + '」每场一次</div><div class="ls">' + sk.text + '</div>'
		+ '<div class="lp">' + F.name + '的打法：' + F.style + '<br>阵营被动「' + F.passiveName + '」：' + F.passiveText + '</div></div>';
	// 对手
	var oh = '<span class="olab">对手</span><div class="ochip' + (D.oppFaction === 'random' ? ' on' : '') + '" data-of="random">随机</div>'
		+ PLAYABLE_FACTIONS.map(function (f) { return '<div class="ochip' + (D.oppFaction === f ? ' on' : '') + '" data-of="' + f + '">' + FACTION_DEFS[f].name + '</div>'; }).join('');
	if (D.oppFaction !== 'random') oh += '<span class="osep"></span><div class="ochip' + (D.oppLeader === 'random' ? ' on' : '') + '" data-ol="random">随机领袖</div>'
		+ leadersOf(D.oppFaction).map(function (c) { return '<div class="ochip' + (D.oppLeader === c.name ? ' on' : '') + '" data-ol="' + c.name + '">' + c.name + '</div>'; }).join('');
	$('dkOpp').innerHTML = oh;
	// 统计
	var v = R.validateDeck(D.faction, D.leader, deckIds()), r = DECK_RULES;
	$('dkStat').innerHTML = '<span>已选 <b>' + v.total + '</b>/' + r.totalMax + '</span><span class="' + (v.units < r.unitMin ? 'bad' : '') + '">单位 ' + v.units + '（至少' + r.unitMin + '）</span>'
		+ '<span class="' + (v.specials > r.specialMax ? 'bad' : '') + '">特殊天气 ' + v.specials + '/' + r.specialMax + '</span><span class="' + (v.neutral > r.neutralMax ? 'bad' : '') + '">中立 ' + v.neutral + '/' + r.neutralMax + '</span>';
	$('dkStart').disabled = !v.ok;
	var fs = [['all', '全部'], ['close', '近战'], ['ranged', '远程'], ['siege', '攻城'], ['neutral', '中立'], ['special', '特殊/天气']];
	$('dkFilters').innerHTML = fs.map(function (f) { return '<div class="ft' + (D.filter === f[0] ? ' on' : '') + '" data-ft="' + f[0] + '">' + f[1] + '</div>'; }).join('');
	var list = sortedPool().filter(function (c) {
		var f = D.filter, sp = c.kind !== 'unit';
		if (f === 'all') return true; if (f === 'special') return sp; if (sp) return false;
		if (f === 'neutral') return c.faction === 'neutral';
		return c.row === f || (c.row === 'agile' && (f === 'close' || f === 'ranged'));
	});
	$('dkGrid').innerHTML = list.map(function (c) {
		var n = D.counts[c.id] || 0, names = describeCard(c).names;
		return '<div class="dk-cell' + (n ? ' sel' : '') + (isHeroDef(c) ? ' hero' : '') + (c.kind !== 'unit' ? ' sp' : '') + '" data-id="' + c.id + '">'
			+ '<div class="dk-art" style="' + artStyle(c, 'sm') + '">' + artName(c) + (c.kind === 'unit' ? '<div class="dpw">' + c.power + '</div>' : '') + iconsHTML(c)
			+ '<div class="dchk">✓</div>' + (c.copies > 1 ? '<div class="dcnt">' + n + '/' + c.copies + '</div>' : '') + '</div>'
			+ '<div class="dn">' + c.name + '</div><div class="da">' + (c.faction === 'neutral' && c.kind === 'unit' ? '<span class="neu">中立</span> ' : '') + names.join('·') + '</div></div>';
	}).join('');
}
function openDeckScreen() {
	var f = store('3kun2_faction'); if (f && FACTION_DEFS[f] && f !== 'neutral') D.faction = f;
	D.leader = loadLeader(D.faction); D.counts = loadDeck(D.faction);
	renderDeck(); $('deckScreen').classList.remove('hide');
}
$('dkFactions').addEventListener('click', function (e) {
	var el = e.target.closest('.fchip'); if (!el || el.dataset.f === D.faction) return;
	D.faction = el.dataset.f; D.leader = loadLeader(D.faction); D.counts = loadDeck(D.faction); D.filter = 'all';
	renderDeck(); $('dkGrid').scrollTop = 0;
});
$('dkLeaders').addEventListener('click', function (e) { var el = e.target.closest('.lchip'); if (el) { D.leader = el.dataset.l; renderDeck(); } });
$('dkOpp').addEventListener('click', function (e) {
	var el = e.target.closest('.ochip'); if (!el) return;
	if (el.dataset.of) { D.oppFaction = el.dataset.of; D.oppLeader = 'random'; } else D.oppLeader = el.dataset.ol;
	renderDeck();
});
$('dkFilters').addEventListener('click', function (e) { var el = e.target.closest('.ft'); if (el) { D.filter = el.dataset.ft; renderDeck(); $('dkGrid').scrollTop = 0; } });
var press = { timer: null, fired: false, x: 0, y: 0 }, grid = $('dkGrid');
grid.addEventListener('pointerdown', function (e) {
	var el = e.target.closest('.dk-cell'); if (!el) return;
	press.fired = false; press.x = e.clientX; press.y = e.clientY; clearTimeout(press.timer);
	press.timer = setTimeout(function () { press.fired = true; openModal(R.BY_ID[parseInt(el.dataset.id)]); }, 480);
});
['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { grid.addEventListener(t, function () { clearTimeout(press.timer); }); });
grid.addEventListener('pointermove', function (e) { if (Math.abs(e.clientX - press.x) > 8 || Math.abs(e.clientY - press.y) > 8) clearTimeout(press.timer); });
grid.addEventListener('contextmenu', function (e) { e.preventDefault(); });
grid.addEventListener('click', function (e) {
	if (press.fired) { press.fired = false; return; }
	var el = e.target.closest('.dk-cell'); if (!el) return;
	var id = parseInt(el.dataset.id), c = R.BY_ID[id], n = D.counts[id] || 0;
	if (n >= c.copies) delete D.counts[id];           // 已带满，再点一次清零
	else {
		var v = R.validateDeck(D.faction, D.leader, deckIds()), r = DECK_RULES;
		if (v.total >= r.totalMax) { toast('牌组最多 ' + r.totalMax + ' 张'); return; }
		if (c.kind !== 'unit' && v.specials >= r.specialMax) { toast('特殊牌和天气牌最多 ' + r.specialMax + ' 张'); return; }
		if (c.kind === 'unit' && c.faction === 'neutral' && v.neutral >= r.neutralMax) { toast('中立单位最多 ' + r.neutralMax + ' 张'); return; }
		D.counts[id] = n + 1;
	}
	var top = grid.scrollTop; renderDeck(); grid.scrollTop = top;
});
$('dkAuto').addEventListener('click', function () { D.counts = countsFrom(R.recommendedDeck(D.faction)); renderDeck(); toast('已套用推荐牌组'); });
$('dkClear').addEventListener('click', function () { D.counts = {}; renderDeck(); });
$('dkBack').addEventListener('click', function () { $('deckScreen').classList.add('hide'); $('startScreen').classList.remove('hide'); });
$('dkStart').addEventListener('click', function () {
	var ids = deckIds(), v = R.validateDeck(D.faction, D.leader, ids);
	if (!v.ok) { toast(v.errors[0]); return; }
	store('3kun2_deck_' + D.faction, JSON.stringify(ids)); store('3kun2_leader_' + D.faction, D.leader); store('3kun2_faction', D.faction);
	var of = D.oppFaction === 'random' ? pick(PLAYABLE_FACTIONS.filter(function (f) { return f !== D.faction; })) : D.oppFaction;
	var ols = leadersOf(of).map(function (c) { return c.name; }), ol = ols.indexOf(D.oppLeader) >= 0 ? D.oppLeader : pick(ols);
	$('deckScreen').classList.add('hide');
	startGame({ faction: D.faction, leader: D.leader, deck: ids }, { faction: of, leader: ol, deck: R.recommendedDeck(of) });
});

// ==================== 开局与换牌 ====================
function startGame(me, ai) {
	clearTimeout(aiTimer); toastQueue = [];
	G = R.newGame({ seed: (Date.now() & 0x7fffffff) || 1, me: me, ai: ai });
	logSeen = 0; selUid = null;
	closePanel(); closeList(); hidePrompt(); $('endScreen').classList.remove('show');
	var guard = 0; while (!G.players.ai.kept && guard++ < 5) R.act(G, AI.choose(G, 'ai', level));   // 对手先换好牌
	render(); renderMulligan();
	$('mulligan').classList.remove('hide');
}
function renderMulligan() {
	var P = G.players.me;
	$('mulSub').innerHTML = '这是你的起手 10 张牌。<b>点一张不想要的牌</b>，把它换成牌库里的另一张。<br>还可以换 <b>' + P.mulligans + '</b> 张；不想换就直接开始。' + '<br>对手：' + leaderDef('ai').name + '（' + FACTION_DEFS[G.players.ai.faction].name + '）';
	$('mulGrid').innerHTML = P.hand.map(function (inst) {
		var c = R.def(inst), names = describeCard(c).names;
		return '<div class="dk-cell' + (isHeroDef(c) ? ' hero' : '') + (c.kind !== 'unit' ? ' sp' : '') + '" data-uid="' + inst.uid + '"><div class="dk-art" style="' + artStyle(c, 'sm') + '">' + artName(c)
			+ (c.kind === 'unit' ? '<div class="dpw">' + c.power + '</div>' : '') + iconsHTML(c) + '</div><div class="dn">' + c.name + '</div><div class="da">' + names.join('·') + '</div></div>';
	}).join('');
}
function beginPlay() {
	if (!G.players.me.kept) R.act(G, { type: 'keep', side: 'me' });
	$('mulligan').classList.add('hide');
	logSeen = G.log.length;
	render();
	toast(G.turn === 'me' ? '第 1 局开始，你先手' : '第 1 局开始，对手先手');
	if (!maybeTutorial()) scheduleAI(1400);
}
$('mulGrid').addEventListener('click', function (e) {
	var el = e.target.closest('.dk-cell'); if (!el || !G || G.phase !== 'mulligan') return;
	if (G.players.me.mulligans <= 0) { toast('换牌次数已用完'); return; }
	R.act(G, { type: 'mulligan', side: 'me', uid: parseInt(el.dataset.uid) });
	renderMulligan();
	if (G.players.me.kept) setTimeout(beginPlay, 700);
});
$('mulGo').addEventListener('click', function () { if (G && G.phase === 'mulligan') beginPlay(); });

// ==================== 开始界面 ====================
document.querySelectorAll('.diffBtn').forEach(function (btn) {
	btn.addEventListener('click', function () { document.querySelectorAll('.diffBtn').forEach(function (b) { b.classList.remove('on'); }); btn.classList.add('on'); level = btn.dataset.diff; });
});
$('startBtn').addEventListener('click', function () { $('startScreen').classList.add('hide'); openDeckScreen(); });
$('restartBtn').addEventListener('click', function () { $('endScreen').classList.remove('show'); $('startScreen').classList.remove('hide'); });

// ==================== 帮助 ====================
function helpIcon(k) { return ICON_AB[k] ? '<img src="img/icons/' + ICON_AB[k] + '.png" alt="">' : '<span style="color:var(--gold);font-size:18px">✦</span>'; }
function helpRules() {
	var r = DECK_RULES;
	return '<h3>怎么赢</h3><p>你和对手轮流出牌。你场上所有牌的战力加起来就是你的<b>总战力</b>。双方都「过牌」后，总战力更高的一方赢下这一局。</p>'
	+ '<p><b>三局两胜</b>：每输一局掉一颗红宝石，掉光就输了。每局结束后<b>场面清空</b>，打过的牌进弃牌堆。</p>'
	+ '<h3>一局怎么打</h3>'
	+ '<div class="step"><div class="n">1</div><div class="t">点底部的手牌，展开手牌面板，点一张牌看详情。</div></div>'
	+ '<div class="step"><div class="n">2</div><div class="t">点「出牌」。单位牌会放进自己对应的一排；需要选目标的牌会提示你点哪里。</div></div>'
	+ '<div class="step"><div class="n">3</div><div class="t">轮到对手时他会自动出牌，等顶部提示变回「你的回合」。</div></div>'
	+ '<div class="step"><div class="n">4</div><div class="t">不想再出牌就点「过牌」。你过牌后本局不能再出牌，对手可以继续出，直到他也过牌，然后比总战力。</div></div>'
	+ '<h3>手牌从哪来</h3><p>开局抽 <b>' + r.handSize + '</b> 张，可以换掉其中最多 <b>' + r.mulligan + '</b> 张。第 2、3 局开始时各再抽 <b>' + r.drawPerRound + '</b> 张。整场就这些牌，所以<b>别在一局里把好牌打光</b>。</p>'
	+ '<h3>三排战场</h3><div class="row3"><div>近战<small>步兵 / 骑兵</small></div><div>远程<small>弓弩 / 谋士</small></div><div>攻城<small>器械 / 战船</small></div></div>'
	+ '<p>每张单位牌只能放在自己对应的那一排；带「灵活」的牌可以选近战或远程。每排右边的数字是这一排的战力。</p>'
	+ '<h3>看懂一张牌</h3><p>左上角的数字是<b>战力</b>（绿色表示被加强，红色表示被削弱）；金色边框是<b>猛将</b>；数字下面的小图标是<b>兵种排</b>和<b>技能</b>。点场上的牌可以看大图和说明。</p>'
	+ '<h3>牌组</h3><p>开打前从本势力的牌里挑一副牌组：单位牌至少 <b>' + r.unitMin + '</b> 张，特殊牌和天气牌最多 <b>' + r.specialMax + '</b> 张，中立单位最多 <b>' + r.neutralMax + '</b> 张，总数最多 <b>' + r.totalMax + '</b> 张。不想挑就点「推荐牌组」。</p>';
}
function helpSkills() {
	var groups = [['单位技能', ['hero', 'bond', 'morale', 'medic', 'spy', 'muster', 'scorch_row']], ['名将招牌技', ['scorch_all', 'east_wind', 'peerless', 'tyranny', 'charm', 'mirror']], ['特殊牌', ['horn', 'decoy', 'scorch', 'mardroeme']], ['天气牌', ['frost', 'fog', 'rain', 'storm', 'clear']]];
	var owner = {}; R.CARDS.forEach(function (c) { (c.abilities || []).forEach(function (a) { (owner[a.k] = owner[a.k] || []).push(c.name); }); });
	return groups.map(function (g) {
		return '<h3>' + g[0] + '</h3>' + g[1].map(function (k) {
			var d = ABILITY_DEFS[k], txt = typeof d.text === 'function' ? d.text(k === 'charm' ? { max: 6 } : { row: 'close' }).replace('近战排', '指定的那一排') : d.text;
			var tg = g[0] === '名将招牌技' ? '<span class="tg">' + owner[k][0] + '</span>' : '';
			return '<div class="item"><div class="ic">' + helpIcon(k) + '</div><div><div class="nm">' + d.name + tg + '</div><div class="ds">' + txt + '</div></div></div>';
		}).join('') + (g[0] === '单位技能' ? '<div class="item"><div class="ic"><img src="img/icons/card_row_agile.png" alt=""></div><div><div class="nm">灵活</div><div class="ds">打出时自选近战排或远程排</div></div></div>' : '');
	}).join('');
}
function helpFactions() {
	return '<p style="color:var(--ink-dim)">每个势力有自己的打法、一个阵营被动和几位领袖。领袖技能每场只能用一次，使用后不消耗出牌机会。</p>'
	+ PLAYABLE_FACTIONS.map(function (f) {
		var F = FACTION_DEFS[f];
		return '<h3>' + F.name + '</h3><p>' + F.style + '。<br>阵营被动「<b>' + F.passiveName + '</b>」：' + F.passiveText + '</p>'
			+ leadersOf(f).map(function (c) { var sk = LEADER_SKILL_DEFS[c.skill]; return '<div class="item"><div class="lav" style="' + artStyle(c, 'sm') + '"></div><div><div class="nm">' + c.name + ' · 「' + sk.name + '」</div><div class="ds">' + sk.text + '</div></div></div>'; }).join('');
	}).join('') + '<h3>中立</h3><p>' + FACTION_DEFS.neutral.style + '。吕布、董卓、貂蝉、左慈、华佗等都在这里。</p>';
}
function helpTips() {
	return '<h3>新手小贴士</h3>'
	+ '<p>• <b>别把好牌一次打光</b>。三局两胜，第一局可以少出牌试探，甚至主动放弃，把强牌留到后面。</p>'
	+ '<p>• <b>过牌的时机很重要</b>。你已经领先、对手要花很多牌才能追上时，果断过牌。</p>'
	+ '<p>• <b>天气对双方都有效</b>，猛将不受影响。先看看谁的那一排更强再打。</p>'
	+ '<p>• <b>同袍</b>要把同名牌放在同一排：2 张各翻倍，3 张各三倍。</p>'
	+ '<p>• <b>战鼓</b>放在牌最多的那一排最划算。</p>'
	+ '<p>• <b>烧灼和火攻</b>只打非猛将里战力最高的。打之前看清楚最高的是不是对手的牌。</p>'
	+ '<p>• <b>卧底</b>会给对手加战力，但你能多抽 2 张牌。在准备放弃的那一局打最划算。</p>'
	+ '<p>• <b>归阵</b>等弃牌堆里有好牌再用，所以适合第 2、3 局。</p>'
	+ '<p>• 点对手的头像可以看他的领袖技能；点自己的领袖可以看技能和能不能用。</p>';
}
var helpTab = 'rules';
function renderHelp() {
	document.querySelectorAll('#helpTabs .ht').forEach(function (t) { t.classList.toggle('on', t.dataset.t === helpTab); });
	var b = $('helpBody');
	b.innerHTML = helpTab === 'rules' ? helpRules() : helpTab === 'skills' ? helpSkills() : helpTab === 'leaders' ? helpFactions() : helpTips();
	b.scrollTop = 0;
}
function openHelp(tab) { helpTab = tab || helpTab; renderHelp(); $('helpPanel').classList.add('show'); }
$('helpTabs').addEventListener('click', function (e) { var t = e.target.closest('.ht'); if (t) { helpTab = t.dataset.t; renderHelp(); } });
$('helpClose').addEventListener('click', function () { $('helpPanel').classList.remove('show'); });
$('helpBtn').addEventListener('click', function () { openHelp(); });
$('helpStartBtn').addEventListener('click', function () { openHelp('rules'); });
$('helpReplay').addEventListener('click', function () {
	if (!G || G.phase !== 'play') { toast('进入对局后会自动播放新手引导'); return; }
	$('helpPanel').classList.remove('show'); startCoach();
});
(function () { var t = document.querySelector('#helpTabs .ht[data-t="leaders"]'); if (t) t.textContent = '势力领袖'; })();

// ==================== 新手引导 ====================
var COACH = [
	{ sel: null, title: '欢迎来到三坤牌', text: '这是三国版昆特牌：你和对手轮流出牌，比谁的「总战力」更高。<b>三局两胜</b>。花 1 分钟看看怎么玩吧。' },
	{ sel: '#opbar', title: '对手信息', text: '这里是对手：头像（点一下能看他的领袖技能）、<b>总战力</b>、手牌数、第几局。右边两颗红宝石是他剩的「命」，每输一局掉一颗。' },
	{ sel: '#fme', title: '你的战场', text: '战场分<b>近战、远程、攻城</b>三排，每张牌只能放进自己对应的那一排，右边的数字是这一排的战力。上面三排是对手的。' },
	{ sel: '#handStack', title: '你的手牌', text: '底部是你的手牌。<b>点任意一张</b>展开，卡牌下方有名称和技能，选中后点「出牌」。' },
	{ sel: '#tot', title: '总战力 = 比分', text: '这是你的<b>总战力</b>。和对手顶部的总战力对比，本局谁更高，谁就赢下这一局。' },
	{ sel: '#pass', title: '过牌', text: '不想再出牌时点「过牌」。之后你本局不能再出牌，对手可以继续出，直到他也过牌。<b>别把好牌一次打光</b>，整场只有十几张牌。' },
	{ sel: '#leader', title: '领袖', text: '这是你的领袖，<b>每场可以用一次技能</b>，使用后不消耗出牌机会。头像发光表示现在可以用。点开先看效果，确认后才会使用。' },
	{ sel: '#discardPile', title: '弃牌堆', text: '打过的牌都会进弃牌堆，点开可以查看。有些技能（归阵、仁德）能把里面的单位救回来。' },
	{ sel: '#helpBtn', title: '随时求助', text: '右边这个「?」随时可以打开：<b>玩法说明、全部技能、各势力和领袖</b>。祝你旗开得胜！' }
];
var coachI = 0;
function startCoach() { coachI = 0; $('coach').classList.add('show'); coachRender(); }
function endCoach() { $('coach').classList.remove('show'); store('3kun_tutorial_done', '1'); if (G && G.phase === 'play') scheduleAI(900); }
function coachRender() {
	var st = COACH[coachI], last = coachI === COACH.length - 1, root = $('coach'), spot = $('coachSpot'), tip = $('coachTip');
	$('coachStep').textContent = '新手引导  ' + (coachI + 1) + ' / ' + COACH.length;
	$('coachTitle').textContent = st.title; $('coachText').innerHTML = st.text;
	$('coachPrev').style.display = coachI === 0 ? 'none' : ''; $('coachSkip').style.display = last ? 'none' : '';
	$('coachNext').textContent = last ? '开始游戏' : '下一步';
	var vh = window.innerHeight, t = st.sel ? document.querySelector(st.sel) : null;
	tip.style.top = 'auto'; tip.style.bottom = 'auto';
	if (!t) { root.style.background = 'rgba(0,0,0,.78)'; spot.style.display = 'none'; tip.style.top = Math.max(20, vh / 2 - tip.offsetHeight / 2) + 'px'; return; }
	root.style.background = 'transparent';
	var r = t.getBoundingClientRect(), pad = 5;
	spot.style.display = 'block'; spot.style.left = (r.left - pad) + 'px'; spot.style.top = (r.top - pad) + 'px'; spot.style.width = (r.width + pad * 2) + 'px'; spot.style.height = (r.height + pad * 2) + 'px';
	var th = tip.offsetHeight;
	if (r.bottom + 14 + th <= vh - 10) tip.style.top = (r.bottom + 14) + 'px'; else if (r.top - 14 - th >= 10) tip.style.bottom = (vh - r.top + 14) + 'px'; else tip.style.bottom = '10px';
}
$('coachNext').addEventListener('click', function () { if (coachI >= COACH.length - 1) { endCoach(); return; } coachI++; coachRender(); });
$('coachPrev').addEventListener('click', function () { if (coachI > 0) { coachI--; coachRender(); } });
$('coachSkip').addEventListener('click', endCoach);
function maybeTutorial() { if (store('3kun_tutorial_done') === '1') return false; setTimeout(startCoach, 600); return true; }

// 供测试脚本使用
window.__game = function () { return G; };
window.__ui = { doAct: doAct, startGame: startGame, openDeckScreen: openDeckScreen, D: D };
})();
