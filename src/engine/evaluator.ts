import { Card, HandEvaluation, HandRank } from '../types/poker';
import { rankToLabel } from './deck';

function getCombinations<T>(array: T[], k: number): T[][] {
  if (k === 0) return [[]];
  if (array.length === 0) return [];
  const head = array[0];
  const tail = array.slice(1);
  const withHead = getCombinations(tail, k - 1).map(comb => [head, ...comb]);
  const withoutHead = getCombinations(tail, k);
  return [...withHead, ...withoutHead];
}

export function evaluate5Cards(cards: Card[]): HandEvaluation {
  if (cards.length !== 5) {
    throw new Error('evaluate5Cards 必须刚好传入 5 张牌');
  }

  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const isFlush = sorted.every(c => c.suit === sorted[0].suit);

  const rankCounts: Record<number, number> = {};
  for (const c of sorted) {
    rankCounts[c.rank] = (rankCounts[c.rank] || 0) + 1;
  }

  const countsGroup = Object.entries(rankCounts)
    .map(([rankStr, count]) => ({ rank: Number(rankStr), count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.rank - a.rank;
    });

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
      isStraight = true;
      straightHighRank = 5;
    }
  }

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
      name: `同花顺 (${rankToLabel(straightHighRank)}最大)`,
      score: buildScore(HandRank.STRAIGHT_FLUSH, [straightHighRank]),
      bestFive: sorted
    };
  }

  // 2. 四条
  if (countsGroup[0].count === 4) {
    const quadRank = countsGroup[0].rank;
    const kicker = countsGroup[1].rank;
    return {
      rank: HandRank.FOUR_OF_A_KIND,
      name: `四条 (${rankToLabel(quadRank)})`,
      score: buildScore(HandRank.FOUR_OF_A_KIND, [quadRank, kicker]),
      bestFive: sorted
    };
  }

  // 3. 葫芦
  if (countsGroup[0].count === 3 && countsGroup[1].count === 2) {
    const tripleRank = countsGroup[0].rank;
    const pairRank = countsGroup[1].rank;
    return {
      rank: HandRank.FULL_HOUSE,
      name: `葫芦 (${rankToLabel(tripleRank)}满${rankToLabel(pairRank)})`,
      score: buildScore(HandRank.FULL_HOUSE, [tripleRank, pairRank]),
      bestFive: sorted
    };
  }

  // 4. 同花
  if (isFlush) {
    const ranks = sorted.map(c => c.rank);
    return {
      rank: HandRank.FLUSH,
      name: `同花 (${rankToLabel(ranks[0])}高)`,
      score: buildScore(HandRank.FLUSH, ranks),
      bestFive: sorted
    };
  }

  // 5. 顺子
  if (isStraight) {
    return {
      rank: HandRank.STRAIGHT,
      name: `顺子 (${rankToLabel(straightHighRank)}高)`,
      score: buildScore(HandRank.STRAIGHT, [straightHighRank]),
      bestFive: sorted
    };
  }

  // 6. 三条
  if (countsGroup[0].count === 3) {
    const tripRank = countsGroup[0].rank;
    const kickers = [countsGroup[1].rank, countsGroup[2].rank];
    return {
      rank: HandRank.THREE_OF_A_KIND,
      name: `三条 (${rankToLabel(tripRank)})`,
      score: buildScore(HandRank.THREE_OF_A_KIND, [tripRank, ...kickers]),
      bestFive: sorted
    };
  }

  // 7. 两对
  if (countsGroup[0].count === 2 && countsGroup[1].count === 2) {
    const pair1 = countsGroup[0].rank;
    const pair2 = countsGroup[1].rank;
    const kicker = countsGroup[2].rank;
    return {
      rank: HandRank.TWO_PAIR,
      name: `两对 (${rankToLabel(pair1)} 和 ${rankToLabel(pair2)})`,
      score: buildScore(HandRank.TWO_PAIR, [pair1, pair2, kicker]),
      bestFive: sorted
    };
  }

  // 8. 一对
  if (countsGroup[0].count === 2) {
    const pair = countsGroup[0].rank;
    const kickers = [countsGroup[1].rank, countsGroup[2].rank, countsGroup[3].rank];
    return {
      rank: HandRank.ONE_PAIR,
      name: `一对 (${rankToLabel(pair)})`,
      score: buildScore(HandRank.ONE_PAIR, [pair, ...kickers]),
      bestFive: sorted
    };
  }

  // 9. 高牌
  const ranks = sorted.map(c => c.rank);
  return {
    rank: HandRank.HIGH_CARD,
    name: `高牌 (${rankToLabel(ranks[0])})`,
    score: buildScore(HandRank.HIGH_CARD, ranks),
    bestFive: sorted
  };
}

export function evaluate7Cards(holeCards: Card[], communityCards: Card[]): HandEvaluation {
  const allCards = [...holeCards, ...communityCards].filter(c => c && c.rank > 0);
  if (allCards.length < 5) {
    if (allCards.length === 2) {
      if (allCards[0].rank === allCards[1].rank) {
        return {
          rank: HandRank.ONE_PAIR,
          name: `口袋对 (${rankToLabel(allCards[0].rank)})`,
          score: HandRank.ONE_PAIR * 1e10 + allCards[0].rank * 1e8,
          bestFive: allCards
        };
      }
      const maxRank = Math.max(allCards[0].rank, allCards[1].rank);
      return {
        rank: HandRank.HIGH_CARD,
        name: `高牌 (${rankToLabel(maxRank)})`,
        score: HandRank.HIGH_CARD * 1e10 + maxRank * 1e8,
        bestFive: allCards
      };
    }
    return {
      rank: HandRank.HIGH_CARD,
      name: '等待发牌...',
      score: 0,
      bestFive: allCards
    };
  }

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
