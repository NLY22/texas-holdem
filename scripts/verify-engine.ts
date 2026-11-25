import { evaluate7Cards } from '../src/engine/evaluator.js';
import { calculatePots, resolveWinners } from '../src/engine/pots.js';
import {
  addBotToSeat,
  addPlayerToSeat,
  createInitialState,
  dissolveRoomRollback,
  handlePlayerAction,
  leaveSeat,
  rebuyOrTopUpPlayer,
  removeOrToggleBot,
  resetTableForNewRound,
  revealEarlyWinCards,
  revealRabbitHunt,
  startNewHand,
  togglePlayerSitOut,
} from '../src/engine/state-machine.js';
import { Card, HandRank, LedgerEntry, Player } from '../src/types/poker.js';

function assertLedgerZeroSum(ledger: Record<string, LedgerEntry> | undefined, totalPot: number, label: string) {
  const entries = Object.values(ledger || {});
  const totalBuyIn = entries.reduce((s, e) => s + e.totalBuyIn, 0);
  const totalChips = entries.reduce((s, e) => s + e.currentChips, 0);
  if (totalBuyIn !== totalChips + totalPot) {
    throw new Error(`[${label}] 账本不守恒: buyIn=${totalBuyIn}, chips=${totalChips}, pot=${totalPot}`);
  }
}

console.log('=== 1. 核心牌型、边池与随机余数测试 ===\n');

const royalFlushHole: Card[] = [{ suit: 'spades', rank: 14 }, { suit: 'spades', rank: 13 }];
const communityRoyal: Card[] = [
  { suit: 'spades', rank: 12 },
  { suit: 'spades', rank: 11 },
  { suit: 'spades', rank: 10 },
  { suit: 'hearts', rank: 2 },
  { suit: 'diamonds', rank: 3 },
];
if (evaluate7Cards(royalFlushHole, communityRoyal).rank !== HandRank.ROYAL_FLUSH) {
  throw new Error('皇家同花顺判断失败');
}
console.log('✓ 皇家同花顺判定正确');

const mockPlayers: Player[] = [
  { id: 'p1', name: 'A', avatar: '', chips: 0, currentBet: 100, totalRoundBet: 100, holeCards: [], folded: false, isAllIn: true, isBot: false, seatIndex: 0 },
  { id: 'p2', name: 'B', avatar: '', chips: 0, currentBet: 300, totalRoundBet: 300, holeCards: [], folded: false, isAllIn: true, isBot: false, seatIndex: 1 },
  { id: 'p3', name: 'C', avatar: '', chips: 200, currentBet: 500, totalRoundBet: 500, holeCards: [], folded: false, isAllIn: false, isBot: false, seatIndex: 2 },
];
const pots = calculatePots(mockPlayers);
if (pots[0].amount !== 300 || pots[1].amount !== 400 || pots[2].amount !== 200) {
  throw new Error('边池金额计算错误');
}
console.log('✓ 三人不等额 All-In 主/边池拆分正确: $300 / $400 / $200');

// 随机余数分配总和守恒校验
const tiedPlayers: Player[] = [
  { id: 't1', name: 'T1', avatar: '', chips: 0, currentBet: 0, totalRoundBet: 5, holeCards: [{ suit: 'spades', rank: 14 }, { suit: 'hearts', rank: 2 }], folded: false, isAllIn: true, isBot: false, seatIndex: 0 },
  { id: 't2', name: 'T2', avatar: '', chips: 0, currentBet: 0, totalRoundBet: 5, holeCards: [{ suit: 'clubs', rank: 14 }, { suit: 'diamonds', rank: 3 }], folded: false, isAllIn: true, isBot: false, seatIndex: 1 },
  { id: 't3', name: 'T3', avatar: '', chips: 0, currentBet: 0, totalRoundBet: 5, holeCards: [{ suit: 'hearts', rank: 14 }, { suit: 'spades', rank: 4 }], folded: false, isAllIn: true, isBot: false, seatIndex: 2 },
];
const sharedBoard: Card[] = [
  { suit: 'spades', rank: 13 },
  { suit: 'hearts', rank: 12 },
  { suit: 'clubs', rank: 11 },
  { suit: 'diamonds', rank: 10 },
  { suit: 'clubs', rank: 9 },
]; // 公共牌 K-Q-J-10-9? Wait: everyone with A makes A-K-Q-J-10 broadway tie, pot = 17
const oddWinners = resolveWinners([{ amount: 17, eligiblePlayerIds: ['t1', 't2', 't3'] }], tiedPlayers, sharedBoard);
const oddSum = oddWinners.reduce((s, w) => s + w.amount, 0);
if (oddSum !== 17) throw new Error(`平分余数丢失: ${oddSum}`);
console.log('✓ 平分奇数码池 ($17 / 3人) 随机余数分配总额守恒:', oddWinners.map(w => `${w.name}=$${w.amount}`).join(', '));

console.log('\n=== 2. 完整生命周期：加减AI、短全下规则、中途离桌与账本守恒 ===\n');

let sim = createInitialState('TX-9999', 'host-A', { actionTimeoutSec: 30, ante: 5 });
sim = addPlayerToSeat(sim, { id: 'host-A', name: '房主A' }).state;
sim = addPlayerToSeat(sim, { id: 'client-B', name: '玩家B' }).state;
sim = addPlayerToSeat(sim, { id: 'client-C', name: '玩家C' }).state;
sim = addBotToSeat(sim, 3, 'LAG');
assertLedgerZeroSum(sim.ledger, sim.totalPot, '入座+加AI');

let res = startNewHand(sim);
sim = res.state;
let deck = res.deck;
if (sim.stage !== 'PREFLOP') throw new Error('开局应处于 PREFLOP');
assertLedgerZeroSum(sim.ledger, sim.totalPot, '开局收盲与Ante');

// 模拟手牌进行中把 AI 标记为下局移除
sim = removeOrToggleBot(sim, 3);
if (!sim.players[3]?.removeAfterHand) throw new Error('手牌进行中应标记 removeAfterHand');

// 模拟玩家B中途退出自动弃牌并移交/保留账本
const leaveRes = leaveSeat(sim, 'client-B', deck);
sim = leaveRes.state;
deck = leaveRes.deck;
if (sim.players[1] !== null || sim.ledger?.['client-B']?.status !== 'LEFT') {
  throw new Error('玩家中途退出未正确释放座位或保留 LEFT 账本');
}

// 剩余 players 继续过牌/跟注直到 SHOWDOWN
let safety = 0;
while (sim.stage !== 'SHOWDOWN' && safety++ < 40) {
  const actPlayer = sim.players[sim.activePlayerIndex]!;
  const actType = sim.currentBet > actPlayer.currentBet ? 'CALL' : 'CHECK';
  const step = handlePlayerAction(sim, { type: actType, playerId: actPlayer.id }, deck);
  sim = step.state;
  deck = step.deck;
}
if (sim.stage !== 'SHOWDOWN') throw new Error('未能走完牌局到 SHOWDOWN');
assertLedgerZeroSum(sim.ledger, sim.totalPot, '有人中途退出的单手结算');
console.log('✓ 玩家中途退出 + AI 预约移除 + Ante + 账本零和守恒验证通过');

// 开启第2手，验证标记 removeAfterHand 的 AI 自动清理
const res2 = startNewHand(sim);
sim = res2.state;
deck = res2.deck;
if (sim.players[3] !== null) throw new Error('AI 未在第2手自动移除');
console.log('✓ 手牌进行中标记移除的 AI 在下一手自动清理');

// 测试强行中途解散退回投入
sim = dissolveRoomRollback(sim);
if (sim.stage !== 'WAITING' || sim.totalPot !== 0) throw new Error('强行解散退还筹码失败');
assertLedgerZeroSum(sim.ledger, sim.totalPot, '中途强制解散退还底池');
console.log('✓ 手牌中途强制解散筹码回滚与账本守恒通过');

// 测试房主离桌自动移交权力
const hostLeave = leaveSeat(sim, 'host-A', deck);
sim = hostLeave.state;
if (sim.hostId !== 'client-C') throw new Error(`房主未移交给 client-C，当前=${sim.hostId}`);
console.log('✓ 房主离桌自动顺延移交房主权给 client-C');

// 测试短筹码 All-In 不重开已行动者加注权
let shortSim = createInitialState('TX-7777', 'p1');
shortSim = addPlayerToSeat(shortSim, { id: 'p1', name: 'P1' }).state;
shortSim = addPlayerToSeat(shortSim, { id: 'p2', name: 'P2' }).state;
shortSim = addPlayerToSeat(shortSim, { id: 'p3', name: 'P3' }).state;
// 让 p3 仅剩 35 筹码（大盲 20，若前面有人加注至 50 (+30)，p3 All-In 到 35 不足，改设 p1/p2/p3 下到 FLOP 再测短全下）
let sr = startNewHand(shortSim);
shortSim = sr.state;
let sdeck = sr.deck;
// 全员跟注到 FLOP
for (let i = 0; i < 3; i++) {
  const ap = shortSim.players[shortSim.activePlayerIndex]!;
  sr = handlePlayerAction(shortSim, { type: shortSim.currentBet > ap.currentBet ? 'CALL' : 'CHECK', playerId: ap.id }, sdeck);
  shortSim = sr.state; sdeck = sr.deck;
}
if (shortSim.stage !== 'FLOP') throw new Error('短全下测试未能进 FLOP');
// 在 FLOP 调整 3 号位玩家筹码只剩 110，前两位各至少 900
const firstIdx = shortSim.activePlayerIndex;
const secondIdx = (firstIdx + 1) % 3;
const thirdIdx = (firstIdx + 2) % 3;
shortSim.players[thirdIdx] = { ...shortSim.players[thirdIdx]!, chips: 110 };
// 1号位 BET 100 (minRaise=100), 2号位 CALL 100, 3号位 ALL_IN 110 (短加注 +10 < 100)
sr = handlePlayerAction(shortSim, { type: 'BET', amount: 100, playerId: shortSim.players[firstIdx]!.id }, sdeck);
shortSim = sr.state; sdeck = sr.deck;
sr = handlePlayerAction(shortSim, { type: 'CALL', playerId: shortSim.players[secondIdx]!.id }, sdeck);
shortSim = sr.state; sdeck = sr.deck;
sr = handlePlayerAction(shortSim, { type: 'ALL_IN', playerId: shortSim.players[thirdIdx]!.id }, sdeck);
shortSim = sr.state; sdeck = sr.deck;
if (!(shortSim.cannotRaiseIds || []).includes(shortSim.players[firstIdx]!.id)) {
  throw new Error('短筹码 All-in 后已行动者应被限制不得再加注 (cannotRaiseIds)');
}
console.log('✓ 短筹码 All-In 遵守 Full Bet Rule（禁止已行动者重开加注权）验证通过');

// 测试 Top-up / ToggleSitOut / RabbitHunt / ShowCards / ResetTable
let extra = createInitialState('TX-5555', 'u1');
extra = addPlayerToSeat(extra, { id: 'u1', name: 'U1' }).state;
extra = addPlayerToSeat(extra, { id: 'u2', name: 'U2' }).state;
extra = togglePlayerSitOut(extra, 'u2');
if (extra.players[1]?.status !== 'SITTING_OUT') throw new Error('暂离切换失败');
extra = togglePlayerSitOut(extra, 'u2');
let er = startNewHand(extra);
extra = er.state;
let edeck = er.deck;
// u1 立即弃牌 -> u2 提前获胜，验证 ShowCards 与 RabbitHunt
const u1Act = extra.players[extra.activePlayerIndex]!;
er = handlePlayerAction(extra, { type: 'FOLD', playerId: u1Act.id }, edeck);
extra = er.state; edeck = er.deck;
if (!extra.earlyWinCanShow) throw new Error('全弃牌提前胜出应允许秀牌');
const winnerId = extra.winners[0].playerId;
extra = revealEarlyWinCards(extra, winnerId);
if (!extra.players.find(p => p?.id === winnerId)?.showCards) throw new Error('秀牌失败');
extra = revealRabbitHunt(extra, edeck);
if ((extra.rabbitCards || []).length !== 5) throw new Error('Rabbit Hunt 应补齐 5 张未发牌');
extra = rebuyOrTopUpPlayer(extra, u1Act.id, 'topup');
assertLedgerZeroSum(extra.ledger, extra.totalPot, 'Top-up 补满初始筹码');
extra = resetTableForNewRound(extra);
if (extra.roundNumber !== 2 || extra.handNumber !== 0) throw new Error('重置再战一轮失败');
assertLedgerZeroSum(extra.ledger, extra.totalPot, '重置新轮');
console.log('✓ 暂离、Top-up、秀牌、Rabbit Hunt、重置新轮全链路通过');

console.log('\n🎉 所有增强引擎规则与完整生命周期测试全部通过！');
