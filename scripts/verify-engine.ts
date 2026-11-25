import { evaluate7Cards } from '../src/engine/evaluator.js';
import { calculatePots } from '../src/engine/pots.js';
import { createInitialState, startNewHand, handlePlayerAction } from '../src/engine/state-machine.js';
import { Card, HandRank, Player } from '../src/types/poker.js';

console.log('=== 1. 核心牌型与边池自检 ===\n');

const royalFlushHole: Card[] = [{ suit: 'spades', rank: 14 }, { suit: 'spades', rank: 13 }];
const communityRoyal: Card[] = [
  { suit: 'spades', rank: 12 },
  { suit: 'spades', rank: 11 },
  { suit: 'spades', rank: 10 },
  { suit: 'hearts', rank: 2 },
  { suit: 'diamonds', rank: 3 }
];
const evalRoyal = evaluate7Cards(royalFlushHole, communityRoyal);
if (evalRoyal.rank !== HandRank.ROYAL_FLUSH) throw new Error('皇家同花顺判断失败');
console.log('✓ 皇家同花顺判定正确:', evalRoyal.name);

const fullHouseHole: Card[] = [{ suit: 'hearts', rank: 10 }, { suit: 'diamonds', rank: 10 }];
const communityMixed: Card[] = [
  { suit: 'clubs', rank: 10 },
  { suit: 'spades', rank: 4 },
  { suit: 'hearts', rank: 4 },
  { suit: 'clubs', rank: 2 },
  { suit: 'diamonds', rank: 9 }
];
const evalFullHouse = evaluate7Cards(fullHouseHole, communityMixed);
if (evalFullHouse.rank !== HandRank.FULL_HOUSE) throw new Error('葫芦判断失败');
console.log('✓ 葫芦判定正确:', evalFullHouse.name);

const mockPlayers: Player[] = [
  { id: 'p1', name: 'A', avatar: '', chips: 0, currentBet: 100, totalRoundBet: 100, holeCards: [], folded: false, isAllIn: true, isBot: false, seatIndex: 0 },
  { id: 'p2', name: 'B', avatar: '', chips: 0, currentBet: 300, totalRoundBet: 300, holeCards: [], folded: false, isAllIn: true, isBot: false, seatIndex: 1 },
  { id: 'p3', name: 'C', avatar: '', chips: 200, currentBet: 500, totalRoundBet: 500, holeCards: [], folded: false, isAllIn: false, isBot: false, seatIndex: 2 }
];
const pots = calculatePots(mockPlayers);
if (pots[0].amount !== 300 || pots[1].amount !== 400 || pots[2].amount !== 200) {
  throw new Error('边池金额计算错误');
}
console.log('✓ 三人不等额 All-In 主/边池拆分正确: $300 / $400 / $200');

console.log('\n=== 2. 多人(3人)同时交互全四街轮次与连续两局流转自检 ===\n');

const pA: Player = { id: 'host-A', name: '房主A', avatar: '', chips: 1000, currentBet: 0, totalRoundBet: 0, holeCards: [], folded: false, isAllIn: false, isBot: false, seatIndex: 0 };
const pB: Player = { id: 'client-B', name: '玩家B', avatar: '', chips: 1000, currentBet: 0, totalRoundBet: 0, holeCards: [], folded: false, isAllIn: false, isBot: false, seatIndex: 1 };
const pC: Player = { id: 'client-C', name: '玩家C', avatar: '', chips: 1000, currentBet: 0, totalRoundBet: 0, holeCards: [], folded: false, isAllIn: false, isBot: false, seatIndex: 2 };

let sim = createInitialState('TX-9999', 'host-A');
sim.players = [pA, pB, pC, null, null, null];

// 第 1 局开局 (初始 dealerIndex=0 -> nextDealer=1 (pB), SB=2 (pC), BB=0 (pA), UTG=1 (pB))
let res = startNewHand(sim);
sim = res.state;
let deck = res.deck;

if (sim.stage !== 'PREFLOP') throw new Error('开局应处于 PREFLOP');
if (sim.activePlayerIndex !== 1) throw new Error(`翻牌前首位行动应为 1 号位 (pB), 实际为 ${sim.activePlayerIndex}`);

// pB 跟注 20
res = handlePlayerAction(sim, { type: 'CALL', playerId: 'client-B' }, deck);
sim = res.state; deck = res.deck;
if (sim.activePlayerIndex !== 2) throw new Error('轮次未正确交给 SB (pC)');

// pC 补齐盲注 (CALL)
res = handlePlayerAction(sim, { type: 'CALL', playerId: 'client-C' }, deck);
sim = res.state; deck = res.deck;
// 关键验证：大盲位 (pA) 必须保有看牌/加注权！不能直接跳过进 FLOP
if (sim.stage !== 'PREFLOP' || sim.activePlayerIndex !== 0) {
  throw new Error('大盲位 Option 丢失！');
}
console.log('✓ 翻牌前大盲位 Option 权利验证通过');

// pA 看牌 (CHECK) -> 应进入 FLOP
res = handlePlayerAction(sim, { type: 'CHECK', playerId: 'host-A' }, deck);
sim = res.state; deck = res.deck;
if (sim.stage !== 'FLOP' || sim.communityCards.length !== 3) throw new Error('未能正确进入 FLOP');
console.log('✓ 顺利进入 FLOP (3张公共牌)');

// FLOP: pC 下注 40 -> pA 加注至 80 -> 验证 pB 和 pC 都需要重新表态！
res = handlePlayerAction(sim, { type: 'BET', amount: 40, playerId: sim.players[sim.activePlayerIndex]!.id }, deck);
sim = res.state; deck = res.deck;
res = handlePlayerAction(sim, { type: 'RAISE', amount: 80, playerId: sim.players[sim.activePlayerIndex]!.id }, deck);
sim = res.state; deck = res.deck;
if (sim.pendingPlayerIds.length !== 2) {
  throw new Error(`加注后其余 2 位玩家应均需重新表态，实际 pending=${sim.pendingPlayerIds.length}`);
}
console.log('✓ FLOP 加注触发全员重刷待行动队列验证通过');

// 其余两人跟注 80 -> 进入 TURN
res = handlePlayerAction(sim, { type: 'CALL', playerId: sim.players[sim.activePlayerIndex]!.id }, deck);
sim = res.state; deck = res.deck;
res = handlePlayerAction(sim, { type: 'CALL', playerId: sim.players[sim.activePlayerIndex]!.id }, deck);
sim = res.state; deck = res.deck;
if (sim.stage !== 'TURN' || sim.communityCards.length !== 4) throw new Error('未能正确进入 TURN');

// TURN 全员 CHECK -> RIVER
for (let i = 0; i < 3; i++) {
  res = handlePlayerAction(sim, { type: 'CHECK', playerId: sim.players[sim.activePlayerIndex]!.id }, deck);
  sim = res.state; deck = res.deck;
}
if (sim.stage !== 'RIVER' || sim.communityCards.length !== 5) throw new Error('未能正确进入 RIVER');

// RIVER 全员 CHECK -> SHOWDOWN
for (let i = 0; i < 3; i++) {
  res = handlePlayerAction(sim, { type: 'CHECK', playerId: sim.players[sim.activePlayerIndex]!.id }, deck);
  sim = res.state; deck = res.deck;
}
if (sim.stage !== 'SHOWDOWN' || sim.winners.length === 0) throw new Error('未能进入 SHOWDOWN 决胜');

const totalChipsAfterHand1 = sim.players.filter(Boolean).reduce((s, p) => s + p!.chips, 0);
if (totalChipsAfterHand1 !== 3000) throw new Error(`筹码不守恒: ${totalChipsAfterHand1}`);
console.log(`✓ 第 1 局完美走完四街至摊牌 (${sim.winners.map(w => w.name + ' +' + w.amount).join(', ')})，总筹码守恒: $${totalChipsAfterHand1}`);

// 开启第 2 局，检查发新牌与庄家轮转
const hand1CardsB = sim.players[1]!.holeCards;
const res2 = startNewHand(sim);
const sim2 = res2.state;
if (sim2.handNumber !== 2 || sim2.dealerIndex === sim.dealerIndex) {
  throw new Error('第 2 局庄家未正常轮转');
}
if (sim2.players[1]!.holeCards[0] === hand1CardsB[0] && sim2.players[1]!.holeCards[1] === hand1CardsB[1]) {
  throw new Error('第 2 局底牌未刷新');
}
console.log('✓ 第 2 局庄家轮转及客户端新底牌发放验证通过');

console.log('\n🎉 所有多人交互状态机与引擎测试全部通过！');
