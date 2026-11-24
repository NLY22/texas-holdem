import { Card, HandEvaluation, HandRank } from '../types/poker';

/**
 * 递归获取从 n 张牌中选 k 张的所有可能组合 (C(n, k))
 */
function getCombinations<T>(array: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (array.length === 0) return [];
  const head = array[0];
  const tail = array.slice(1);
  const withHead = getCombinations(tail, k - 1).map(comb => [head, ...comb]);
  const withoutHead = getCombinations(tail, k);
  return [...withHead, ...withoutHead];
}

/**
 * 评估精准的 5 张牌牌型
 */
export function evaluate5Cards(cards: Card[]): HandEvaluation {
  if (cards.length !== 5) {
    throw new Error('evaluate5Cards 必须刚好传入 5 张牌');
  }

  // 按点数从大到小排序
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const isFlush = sorted.every(c => c.suit === sorted[0].suit);

  // 统计每个点数出现的次数
  const rankCounts: Record<number, number> = {};
  for (const c of sorted) {
    rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
  }

  // 按出现次数降序，次数相同时按点数降序
  const countsGroup = Object.entries(rankCounts)
    .map(([rankStr, count]) => ({ rank: Number(rankStr), count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.rank - a.rank;
    });

  // 顺子检测 (包含 A-2-3-4-5 轮转顺子)
  let isStraight = false;
  let straightHighRank = 0;

  const uniqueRanks = Array.from(new Set(sorted.map(c => c.rank))).sort((a, b) => b - a);
  if (uniqueRanks.length === 5) {
    if (uniqueRanks[0] - uniqueRanks[4] === 4) {
      isStraight = true;
      straightHighRank = uniqueRanks[0];
    } else if (
      uniqueRanks[0] === 14 &&
      uniqueRanks[1] === 5 &&
      uniqueRanks[2] === 4 &&
      uniqueRanks[3] === 3 &&
      uniqueRanks[4] === 2
    ) {
      // 特殊情况：A-2-3-4-5 顺子，5 为最大牌
      isStraight = true;
      straightHighRank = 5;
    }
  }

  // 评分加权基数：等级权重 10^10，后续5个数字各占 10^8, 10^6, 10^4, 10^2, 10^0
  const buildScore = (rankLevel: HandRank, order: number[]): number => {
    let score = rankLevel * 1e10;
    for (let i = 0; i < order.length; i++) {
      score += order[i] * Math.pow(10, (4 - i) * 2);
    }
    return score;
  };

  // 1. 皇家同花顺 / 同花顺
  if (isFlush && isStraight) {
    if (straightHighRank === 14) {
      return {
        rank: HandRank.ROYAL_FLUSH,
        name: '皇家同花顺 (Royal Flush)',
        score: buildScore(HandRank.ROYAL_FLUSH, [14, 13, 12, 11, 10]),
        bestFive: sorted
      };
    }
    return {
      rank: HandRank.STRAIGHT_FLUSH,
      name: `同花顺 (${straightHighRank} High Straight Flush)`,
      score: buildScore(HandRank.STRAIGHT_FLUSH, [straightHighRank]),
      bestFive: sorted
    };
  }

  // 2. 四条 (Four of a Kind)
  if (countsGroup[0].count === 4) {
    const quadRank = countsGroup[0].rank;
    const kicker = countsGroup[1].rank;
    return {
      rank: HandRank.FOUR_OF_A_KIND,
      name: `四条 (${quadRank})`,
      score: buildScore(HandRank.FOUR_OF_A_KIND, [quadRank, kicker]),
      bestFive: sorted
    };
  }

  // 3. 葫芦 (Full House)
  if (countsGroup[0].count === 3 && countsGroup[1].count === 2) {
    const tripleRank = countsGroup[0].rank;
    const pairRank = countsGroup[1].rank;
    return {
      rank: HandRank.FULL_HOUSE,
      name: `葫芦 (${tripleRank} 满 ${pairRank})`,
      score: buildScore(HandRank.FULL_HOUSE, [tripleRank, pairRank]),
      bestFive: sorted
    };
  }

  // 4. 同花 (Flush)
  if (isFlush) {
    const ranks = sorted.map(c => c.rank);
    return {
      rank: HandRank.FLUSH,
      name: `同花 (${ranks[0]} High Flush)`,
      score: buildScore(HandRank.FLUSH, ranks),
      bestFive: sorted
    };
  }

  // 5. 顺子 (Straight)
  if (isStraight) {
    return {
      rank: HandRank.STRAIGHT,
      name: `顺子 (${straightHighRank} High Straight)`,
      score: buildScore(HandRank.STRAIGHT, [straightHighRank]),
      bestFive: sorted
    };
  }

  // 6. 三条 (Three of a Kind)
  if (countsGroup[0].count === 3) {
    const tripRank = countsGroup[0].rank;
    const kickers = [countsGroup[1].rank, countsGroup[2].rank];
    return {
      rank: HandRank.THREE_OF_A_KIND,
      name: `三条 (${tripRank})`,
      score: buildScore(HandRank.THREE_OF_A_KIND, [tripRank, ...kickers]),
      bestFive: sorted
    };
  }

  // 7. 两对 (Two Pair)
  if (countsGroup[0].count === 2 && countsGroup[1].count === 2) {
    const pair1 = countsGroup[0].rank;
    const pair2 = countsGroup[1].rank;
    const kicker = countsGroup[2].rank;
    return {
      rank: HandRank.TWO_PAIR,
      name: `两对 (${pair1} 和 ${pair2})`,
      score: buildScore(HandRank.TWO_PAIR, [pair1, pair2, kicker]),
      bestFive: sorted
    };
  }

  // 8. 一对 (One Pair)
  if (countsGroup[0].count === 2) {
    const pair = countsGroup[0].rank;
    const kickers = [countsGroup[1].rank, countsGroup[2].rank, countsGroup[3].rank];
    return {
      rank: HandRank.ONE_PAIR,
      name: `一对 (${pair})`,
      score: buildScore(HandRank.ONE_PAIR, [pair, ...kickers]),
      bestFive: sorted
    };
  }

  // 9. 高牌 (High Card)
  const ranks = sorted.map(c => c.rank);
  return {
    rank: HandRank.HIGH_CARD,
    name: `高牌 (${ranks[0]} High)`,
    score: buildScore(HandRank.HIGH_CARD, ranks),
    bestFive: sorted
  };
}

/**
 * 7 选 5 最佳组合评估（核心函数）
 * 从 2 张底牌 + 最多 5 张公共牌中，选出最优 5 张牌
 */
export function evaluate7Cards(holeCards: Card[], communityCards: Card[]): HandEvaluation {
  const allCards = [...holeCards, ...communityCards];
  if (allCards.length < 5) {
    // 牌不够 5 张时（如翻牌前），做简化展示
    if (allCards.length === 2) {
      if (allCards[0].rank === allCards[1].rank) {
        return {
          rank: HandRank.ONE_PAIR,
          name: `口袋对 (${allCards[0].rank})`,
          score: HandRank.ONE_PAIR * 1e10 + allCards[0].rank * 1e8,
          bestFive: allCards
        };
      }
      const maxRank = Math.max(allCards[0].rank, allCards[1].rank);
      return {
        rank: HandRank.HIGH_CARD,
        name: `高牌 (${maxRank})`,
        score: HandRank.HIGH_CARD * 1e10 + maxRank * 1e8,
        bestFive: allCards
      };
    }
    return {
      rank: HandRank.HIGH_CARD,
      name: '分析中...',
      score: 0,
      bestFive: allCards
    };
  }

  // 从 5~7 张牌中挑出所有 5 张牌组合
  const combinations = getCombinations(allCards, 5);
  let bestEval: HandEvaluation | null = null;

  for (const comb of combinations) {
    const currentEval = evaluate5Cards(comb);
    if (!bestEval || currentEval.score > bestEval.score) {
      bestEval = currentEval;
    }
  }

  return bestEval!;
}
