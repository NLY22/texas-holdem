import { Player, Pot, WinnerInfo } from '../types/poker';
import { evaluate7Cards } from './evaluator';
import { Card } from '../types/poker';

/**
 * 精确计算主池与边池 (Main Pot & Side Pots)
 */
export function calculatePots(players: Player[]): Pot[] {
  // 只考虑有投入筹码的玩家
  const contributors = players.filter(p => p.totalRoundBet > 0);
  if (contributors.length === 0) return [];

  // 获取所有全下玩家的投注水位，以及最高投注
  const betLevels = Array.from(
    new Set(
      contributors
        .filter(p => p.isAllIn || !p.folded)
        .map(p => p.totalRoundBet)
    )
  ).sort((a, b) => a - b);

  if (betLevels.length === 0) {
    const total = contributors.reduce((sum, p) => sum + p.totalRoundBet, 0);
    const eligible = contributors.filter(p => !p.folded).map(p => p.id);
    return [{ amount: total, eligiblePlayerIds: eligible }];
  }

  const pots: Pot[] = [];
  let previousLevel = 0;

  for (const level of betLevels) {
    let potAmount = 0;
    const eligible: string[] = [];

    for (const player of contributors) {
      if (player.totalRoundBet > previousLevel) {
        const contribution = Math.min(player.totalRoundBet, level) - previousLevel;
        potAmount += contribution;
      }
      // 只要该玩家没弃牌，且投注额达到或超过该水位，就有资格竞争该池
      if (!player.folded && player.totalRoundBet >= level) {
        if (!eligible.includes(player.id)) {
          eligible.push(player.id);
        }
      }
    }

    if (potAmount > 0) {
      pots.push({
        amount: potAmount,
        eligiblePlayerIds: eligible
      });
    }

    previousLevel = level;
  }

  // 合并具有相同有资格玩家列表的相邻奖池
  const mergedPots: Pot[] = [];
  for (const pot of pots) {
    if (mergedPots.length === 0) {
      mergedPots.push(pot);
    } else {
      const prev = mergedPots[mergedPots.length - 1];
      const sameEligible =
        prev.eligiblePlayerIds.length === pot.eligiblePlayerIds.length &&
        prev.eligiblePlayerIds.every(id => pot.eligiblePlayerIds.includes(id));

      if (sameEligible) {
        prev.amount += pot.amount;
      } else {
        mergedPots.push(pot);
      }
    }
  }

  return mergedPots;
}

/**
 * 决胜清算：将每个池底分给该池的最大牌型获胜者
 */
export function resolveWinners(
  pots: Pot[],
  players: Player[],
  communityCards: Card[]
): WinnerInfo[] {
  const winnerMap: Record<string, WinnerInfo> = {};

  // 为所有未弃牌玩家计算最优牌型
  const playerEvals = new Map<string, ReturnType<typeof evaluate7Cards>>();
  for (const p of players) {
    if (!p.folded && p.holeCards.length === 2) {
      playerEvals.set(p.id, evaluate7Cards(p.holeCards, communityCards));
    }
  }

  for (const pot of pots) {
    const contenders = pot.eligiblePlayerIds
      .map(id => players.find(p => p.id === id)!)
      .filter(p => p && !p.folded && playerEvals.has(p.id));

    if (contenders.length === 0) continue;

    // 找出该池中分数最高的玩家
    let highestScore = -1;
    for (const p of contenders) {
      const ev = playerEvals.get(p.id)!;
      if (ev.score > highestScore) {
        highestScore = ev.score;
      }
    }

    const potWinners = contenders.filter(p => playerEvals.get(p.id)!.score === highestScore);
    const share = Math.floor(pot.amount / potWinners.length);
    let remainder = pot.amount % potWinners.length;

    for (const winner of potWinners) {
      const winAmount = share + (remainder > 0 ? 1 : 0);
      if (remainder > 0) remainder--;

      const ev = playerEvals.get(winner.id)!;
      if (!winnerMap[winner.id]) {
        winnerMap[winner.id] = {
          playerId: winner.id,
          name: winner.name,
          amount: winAmount,
          handName: ev.name,
          cards: ev.bestFive
        };
      } else {
        winnerMap[winner.id].amount += winAmount;
      }
    }
  }

  return Object.values(winnerMap);
}
