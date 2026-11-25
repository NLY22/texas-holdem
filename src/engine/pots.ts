import { Card, Player, Pot, WinnerInfo } from '../types/poker';
import { evaluate7Cards } from './evaluator';

/**
 * 精确计算主池与边池 (Main Pot & Side Pots)
 */
export function calculatePots(players: Player[], deadPotMoney: number = 0): Pot[] {
  const contributors = players.filter(p => p.totalRoundBet > 0);
  if (contributors.length === 0) {
    if (deadPotMoney > 0) {
      const eligible = players.filter(p => !p.folded).map(p => p.id);
      return [{ amount: deadPotMoney, eligiblePlayerIds: eligible }];
    }
    return [];
  }

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
      if (!player.folded && player.totalRoundBet >= level) {
        if (!eligible.includes(player.id)) {
          eligible.push(player.id);
        }
      }
    }

    if (potAmount > 0) {
      pots.push({
        amount: potAmount,
        eligiblePlayerIds: eligible,
      });
    }

    previousLevel = level;
  }

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

  if (deadPotMoney > 0 && mergedPots.length > 0) {
    mergedPots[0].amount += deadPotMoney;
  }

  return mergedPots;
}

/**
 * 决胜清算：将每个池底分给该池的最大牌型获胜者，除不尽的奇数余数随机分配
 */
export function resolveWinners(
  pots: Pot[],
  players: Player[],
  communityCards: Card[]
): WinnerInfo[] {
  const winnerMap: Record<string, WinnerInfo & { potLabels: string[] }> = {};

  const playerEvals = new Map<string, ReturnType<typeof evaluate7Cards>>();
  for (const p of players) {
    if (!p.folded && p.holeCards.length === 2) {
      playerEvals.set(p.id, evaluate7Cards(p.holeCards, communityCards));
    }
  }

  pots.forEach((pot, potIndex) => {
    const contenders = pot.eligiblePlayerIds
      .map(id => players.find(p => p && p.id === id)!)
      .filter(p => p && !p.folded && playerEvals.has(p.id));

    if (contenders.length === 0) return;

    let highestScore = -1;
    for (const p of contenders) {
      const ev = playerEvals.get(p.id)!;
      if (ev.score > highestScore) {
        highestScore = ev.score;
      }
    }

    const potWinners = contenders.filter(p => playerEvals.get(p.id)!.score === highestScore);
    const share = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount % potWinners.length;

    // 奇数余数随机分给平分赢家中的 remainder 人
    const bonusIds = new Set<string>();
    if (remainder > 0) {
      const shuffled = [...potWinners];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      for (let i = 0; i < remainder; i++) {
        bonusIds.add(shuffled[i].id);
      }
    }

    const label = pots.length === 1 ? '底池' : potIndex === 0 ? '主池' : `边池${potIndex}`;

    for (const winner of potWinners) {
      const winAmount = share + (bonusIds.has(winner.id) ? 1 : 0);
      const ev = playerEvals.get(winner.id)!;

      if (!winnerMap[winner.id]) {
        winnerMap[winner.id] = {
          playerId: winner.id,
          name: winner.name,
          amount: winAmount,
          handName: ev.name,
          cards: ev.bestFive,
          potLabels: [label],
        };
      } else {
        winnerMap[winner.id].amount += winAmount;
        if (!winnerMap[winner.id].potLabels.includes(label)) {
          winnerMap[winner.id].potLabels.push(label);
        }
      }
    }
  });

  return Object.values(winnerMap).map(({ potLabels, ...rest }) => ({
    ...rest,
    potLabel: potLabels.join('+'),
  }));
}
