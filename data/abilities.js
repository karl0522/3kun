// 三坤牌 技能与势力的定义表（重设计方案 v4）。
// 这里只定义"叫什么、说明文字怎么写、属于谁"，卡面文字全部由 describeCard() 从 data/cards.js 的机制字段生成。
// 技能的实际逻辑在规则引擎里按同一个代号（k / skill / passive）注册，两边代号必须一致，tools/validate.js 会检查。

var ROW_NAME = { close: '近战', ranged: '远程', siege: '攻城', agile: '灵活' };

// 单位关键词、招牌技、特殊牌、天气牌。text 可以是字符串，也可以是 (参数) => 字符串
var ABILITY_DEFS = {
	// —— 8 个通用关键词 ——
	hero:       { name: '猛将', text: '不受天气、战鼓、烧灼、火攻、招降、离间影响；不能被「归阵」复活' },
	bond:       { name: '同袍', text: '同一排每有 n 张同名的同袍牌，每张战力 ×n' },
	morale:     { name: '士气', text: '同排其他单位战力 +1' },
	medic:      { name: '归阵', text: '打出后，从己方弃牌堆选 1 张非猛将单位立即上场' },
	spy:        { name: '卧底', text: '放到对手对应的排（战力算对手的），你抽 2 张牌' },
	muster:     { name: '死士', text: '打出后，手牌和牌库里所有同名牌一并上场' },
	scorch_row: { name: '火攻', text: function(a){ return '打出时，若对手' + ROW_NAME[a.row] + '排总战力 ≥ 10，消灭该排战力最高的非猛将单位（并列则全部）'; } },
	// —— 招牌技（每个只属于一张牌）——
	scorch_all: { name: '火烧赤壁', text: '打出时，消灭双方全场战力并列最高的非猛将单位' },
	east_wind:  { name: '借东风', text: '打出时二选一：清除全部天气，或从牌库打出 1 张天气牌' },
	peerless:   { name: '无双', text: '在场时，对手近战排的所有非猛将单位战力 -1' },
	tyranny:    { name: '暴政', text: '打出时，己方同排其他非猛将单位战力 -1' },
	charm:      { name: '离间', text: function(a){ return '打出时，自选对手场上 1 张战力 ≤ ' + a.max + ' 的非猛将单位，让它转投你方（留在原排）'; } },
	mirror:     { name: '幻术', text: '打出时，变成对手场上战力最高的非猛将单位的复制品（只复制战力，不复制技能）' },
	// —— 特殊牌 ——
	horn:       { name: '战鼓', text: '选己方一排，本局该排非猛将单位战力 ×2（之后上场的也算）；已有战鼓的排不能再选' },
	decoy:      { name: '招降', text: '把己方场上 1 张非猛将单位收回手牌' },
	scorch:     { name: '烽火燎原', text: '消灭双方全场战力并列最高的非猛将单位' },
	mardroeme:  { name: '蛮巫祭礼', text: '选己方一排，本局该排「死士」单位战力 ×2（之后上场的也算）' },
	// —— 天气牌 ——
	frost:      { name: '寒潮', text: '双方近战排的非猛将单位战力变为 1，持续到本局结束或被放晴' },
	fog:        { name: '大雾', text: '双方远程排的非猛将单位战力变为 1，持续到本局结束或被放晴' },
	rain:       { name: '暴雨', text: '双方攻城排的非猛将单位战力变为 1，持续到本局结束或被放晴' },
	storm:      { name: '海上狂风', text: '双方远程排和攻城排的非猛将单位战力变为 1，持续到本局结束或被放晴' },
	clear:      { name: '放晴', text: '清除全部天气' }
};

// 领袖技能：整场比赛一次，使用后不消耗出牌机会
var LEADER_SKILL_DEFS = {
	rende:     { name: '仁德',     text: '从己方弃牌堆自选 1 张单位（可选猛将）放回手牌', need: '弃牌堆里要有单位牌' },
	xiangfu:   { name: '相父辅政', text: '从牌库自选 1 张「同袍」单位直接上场', need: '牌库里要有同袍单位' },
	xietianzi: { name: '挟天子',   text: '从牌库自选 1 张「卧底」牌打出（照常放到对手半场，你抽 2 张）', need: '牌库里要有卧底牌' },
	yinren:    { name: '隐忍',     text: '选己方一排，把该排全部非猛将单位收回手牌（第 3 局不可用）', need: '第 1、2 局，且该排有非猛将单位' },
	jiangdong: { name: '江东之虎', text: '从牌库自选 1 张天气牌立即打出', need: '牌库里要有天气牌' },
	zhiheng:   { name: '制衡',     text: '自选弃 1 张手牌，抽 2 张', need: '要有手牌，且牌库不空' },
	cangtian:  { name: '苍天已死', text: '本局己方非猛将单位战力 ×2；本局结束时这些单位移出游戏（不进弃牌堆，也不会被阵营被动保留）', need: '己方场上要有非猛将单位' },
	sadou:     { name: '撒豆成兵', text: '从牌库自选 1 张「死士」单位上场，并带出手牌和牌库里的全部同名牌', need: '牌库里要有死士单位' },
	huimeng:   { name: '会盟',     text: '己方场上每张非猛将单位战力 -1；每张抽 1 张牌，最多抽 3 张', need: '己方场上要有非猛将单位，且牌库不空' },
	xiliang:   { name: '西凉举义', text: '从己方弃牌堆自选一组同名「死士」单位全部上场', need: '弃牌堆里要有死士单位' },
	nanman:    { name: '南蛮再起', text: '从己方弃牌堆自选最多 2 张南蛮单位（名字含"南蛮"或"蛮部"，以及祝融）上场', need: '弃牌堆里要有南蛮单位' }
};

// 势力：赢法 + 阵营被动
var FACTION_DEFS = {
	shuhan:   { name: '蜀汉', style: '同袍联动：凑齐同名牌，战力成倍',           passive: 'shuhan_draw',     passiveName: '仁德得人心', passiveText: '每赢下一局，抽 1 张牌' },
	caowei:   { name: '曹魏', style: '卧底换牌：用战力换手牌数量',               passive: 'caowei_tie',      passiveName: '挟天子之名', passiveText: '平局时判你胜' },
	dongwu:   { name: '东吴', style: '灵活与天气：自己不怕天气，再用天气压对手', passive: 'dongwu_agile',    passiveName: '水军',       passiveText: '己方站位为「灵活」的单位不受天气影响' },
	huangjin: { name: '黄巾', style: '死士人海：一张带出一串',                   passive: 'huangjin_keep',   passiveName: '杀之不尽',   passiveText: '每局结束时，随机保留 1 张己方单位在场' },
	qunxiong: { name: '群雄', style: '弃牌堆再起：前两局的牌第三局还能用',       passive: 'qunxiong_recall', passiveName: '诸侯并起',   passiveText: '第 3 局开始时，从己方弃牌堆随机召回 2 张单位上场' },
	neutral:  { name: '中立', style: '名将与名士，任何牌组可带（最多 6 张）',     passive: null }
};
var PLAYABLE_FACTIONS = ['shuhan', 'caowei', 'dongwu', 'huangjin', 'qunxiong'];

// 牌组规则
var DECK_RULES = { unitMin: 22, specialMax: 10, neutralMax: 6, totalMax: 32, handSize: 10, mulligan: 2, drawPerRound: 2 };

function abilityText(a){
	var d = ABILITY_DEFS[a.k];
	if(!d) return '';
	return typeof d.text === 'function' ? d.text(a) : d.text;
}
// 生成一张牌的卡面文字：names = 技能名列表；lines = 每个技能一行"名字：说明"
function describeCard(card){
	var names = [], lines = [];
	if(card.kind === 'leader'){
		var s = LEADER_SKILL_DEFS[card.skill];
		return { names: [s.name], lines: ['「' + s.name + '」每场一次：' + s.text] };
	}
	(card.abilities || []).forEach(function(a){
		var d = ABILITY_DEFS[a.k]; if(!d) return;
		names.push(d.name); lines.push(d.name + '：' + abilityText(a));
	});
	if(card.row === 'agile'){ names.push('灵活'); lines.push('灵活：打出时自选近战排或远程排'); }
	return { names: names, lines: lines };
}

if (typeof module !== 'undefined') module.exports = {
	ROW_NAME: ROW_NAME, ABILITY_DEFS: ABILITY_DEFS, LEADER_SKILL_DEFS: LEADER_SKILL_DEFS, FACTION_DEFS: FACTION_DEFS,
	PLAYABLE_FACTIONS: PLAYABLE_FACTIONS, DECK_RULES: DECK_RULES, abilityText: abilityText, describeCard: describeCard
};
