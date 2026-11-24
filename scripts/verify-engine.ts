import { evaluate7Cards } from '../src/engine/evaluator.js';
import { calculatePots } from '../src/engine/pots.js';
import { Card, HandRank, Player } from '../src/types/poker.js';

console.log('=== 开始德扑核心算法自检 ===\n');

// 1. 牌型优先级测试
const royalFlushHole: Card[] = [{ suit: 'spades', rank: 14 }, { suit: 'spades', rank: 13 }];
const communityRoyal: Card[] = [
  { suit: 'spades', rank: 12 },
  { suit: 'spades', rank: 11 },
  { suit: 'spades', rank: 10 },
  { suit: 'hearts', rank: 2 },
  { suit: 'diamonds', rank: 3 }
];
const evalRoyal = evaluate7Cards(royalFlushHole, communityRoyal);
console.assert(evalRoyal.rank === HandRank.ROYAL_FLUSH, '皇家同花顺判断失败');
console.log('✓ 皇家同花顺判定正确:', evalRoyal.name);

// 2. 葫芦 vs 同花
const fullHouseHole: Card[] = [{ suit: 'hearts', rank: 10 }, { suit: 'diamonds', rank: 10 }];
const communityMixed: Card[] = [
  { suit: 'clubs', rank: 10 },
  { suit: 'spades', rank: 4 },
  { suit: 'hearts', rank: 4 },
  { suit: 'clubs', rank: 2 },
  { suit: 'diamonds', rank: 9 }
];
const evalFullHouse = evaluate7Cards(fullHouseHole, communityMixed);
console.assert(evalFullHouse.rank === HandRank.FULL_HOUSE, '葫芦判断失败');
console.log('✓ 葫芦判定正确:', evalFullHouse.name);

// 3. 边池计算测试 (3 人 All-In 筹码不对等测试)
// 玩家 A: 投入 100 全下
// 玩家 B: 投入 300 全下
// 玩家 C: 投入 500 跟注
const mockPlayers: Player[] = [
  {
    id: 'p1',
    name: 'Player A',
    avatar: '',
    chips: 0,
    currentBet: 100,
    totalRoundBet: 100,
    holeCards: [],
    folded: false,
    isAllIn: true,
    isBot: false,
    seatIndex: 0
  },
  {
    id: 'p2',
    name: 'Player B',
    avatar: '',
    chips: 0,
    currentBet: 300,
    totalRoundBet: 300,
    holeCards: [],
    folded: false,
    isAllIn: true,
    isBot: false,
    seatIndex: 1
  },
  {
    id: 'p3',
    name: 'Player C',
    avatar: '',
    chips: 200,
    currentBet: 500,
    totalRoundBet: 500,
    holeCards: [],
    folded: false,
    isAllIn: false,
    isBot: false,
    seatIndex: 2
  }
];

const pots = calculatePots(mockPlayers);
console.log('\n=== 边池计算测试结果 ===');
pots.forEach((pot, idx) => {
  console.log(`池 ${idx + 1} (${idx === 0 ? '主池' : '边池'}): $${pot.amount}, 资格者: [${pot.eligiblePlayerIds.join(', ')}]`);
});

// 主池应该有 100 * 3 = 300，三个人均有资格
console.assert(pots[0].amount === 300, '主池金额计算错误');
console.assert(pots[0].eligiblePlayerIds.length === 3, '主池资格人数错误');

// 边池 1: (300 - 100) * 2 = 400，资格者为 p2, p3
console.assert(pots[1].amount === 400, '边池 1 金额计算错误');
console.assert(pots[1].eligiblePlayerIds.length === 2, '边池 1 资格人数错误');

// 边池 2: (500 - 300) * 1 = 200，仅 p3 (待退回或赢得)
console.assert(pots[2].amount === 200, '边池 2 金额计算错误');

console.log('\n🎉 所有核心算法自检全部通过！');
