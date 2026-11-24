import { GameAction, GameState, HandRank, Player } from '../types/poker';
import { evaluate7Cards } from './evaluator';

/**
 * 启发式德州扑克 AI 决策引擎
 */
export function getBotAction(gameState: GameState, botPlayer: Player): GameAction {
  const callAmount = gameState.currentBet - botPlayer.currentBet;
  const { stage, communityCards, totalPot, minRaise } = gameState;

  // 1. 翻牌前决策 (Pre-flop)
  if (stage === 'PREFLOP') {
    const c1 = botPlayer.holeCards[0];
    const c2 = botPlayer.holeCards[1];
    if (!c1 || !c2) return { type: 'FOLD', playerId: botPlayer.id };

    const isPair = c1.rank === c2.rank;
    const isSuited = c1.suit === c2.suit;
    const maxRank = Math.max(c1.rank, c2.rank);
    const minRank = Math.min(c1.rank, c2.rank);

    // 强起手牌：大对子(AA-TT) 或 AK, AQ
    if ((isPair && maxRank >= 10) || (maxRank === 14 && minRank >= 12)) {
      if (Math.random() < 0.6 && botPlayer.chips >= gameState.currentBet + minRaise) {
        return {
          type: 'RAISE',
          amount: Math.min(botPlayer.chips, gameState.currentBet + minRaise * 2),
          playerId: botPlayer.id
        };
      }
      return callAmount <= botPlayer.chips
        ? { type: callAmount === 0 ? 'CHECK' : 'CALL', playerId: botPlayer.id }
        : { type: 'ALL_IN', playerId: botPlayer.id };
    }

    // 中等牌：中小对子、同花连张、高张(AJ, KQ, KJ)
    if (isPair || (isSuited && maxRank >= 10) || (maxRank >= 11 && minRank >= 10)) {
      if (callAmount <= gameState.bigBlind * 3) {
        return { type: callAmount === 0 ? 'CHECK' : 'CALL', playerId: botPlayer.id };
      }
    }

    // 弱牌：如果可以免费 Check 就看牌，否则弃牌
    if (callAmount === 0) {
      return { type: 'CHECK', playerId: botPlayer.id };
    }
    return { type: 'FOLD', playerId: botPlayer.id };
  }

  // 2. 翻牌后决策 (Flop / Turn / River)
  const evaluation = evaluate7Cards(botPlayer.holeCards, communityCards);
  const handRank = evaluation.rank;

  // 极强牌：葫芦以上或三条/顺子/同花
  if (handRank >= HandRank.THREE_OF_A_KIND) {
    // 70% 概率加注，30% 慢打跟注
    if (Math.random() < 0.7 && botPlayer.chips >= gameState.currentBet + minRaise) {
      const raiseSize = Math.max(minRaise, Math.floor(totalPot * 0.5));
      return {
        type: 'RAISE',
        amount: Math.min(botPlayer.chips, gameState.currentBet + raiseSize),
        playerId: botPlayer.id
      };
    }
    return callAmount === 0 ? { type: 'CHECK', playerId: botPlayer.id } : { type: 'CALL', playerId: botPlayer.id };
  }

  // 中等成牌：两对、顶对
  if (handRank === HandRank.TWO_PAIR || handRank === HandRank.ONE_PAIR) {
    if (callAmount === 0) {
      // 适度下注试探
      if (Math.random() < 0.4 && botPlayer.chips >= minRaise) {
        return {
          type: 'BET',
          amount: Math.min(botPlayer.chips, Math.max(minRaise, Math.floor(totalPot * 0.3))),
          playerId: botPlayer.id
        };
      }
      return { type: 'CHECK', playerId: botPlayer.id };
    }
    // 面对下注，如果跟注额不超过底池的 50%，选择跟注
    if (callAmount <= totalPot * 0.5 && callAmount <= botPlayer.chips) {
      return { type: 'CALL', playerId: botPlayer.id };
    }
    return { type: 'FOLD', playerId: botPlayer.id };
  }

  // 弱牌 (高牌)：免费则过牌，有下注则弃牌（偶尔 5% 偷鸡诈唬）
  if (callAmount === 0) {
    if (Math.random() < 0.05 && botPlayer.chips >= minRaise) {
      return { type: 'BET', amount: minRaise, playerId: botPlayer.id };
    }
    return { type: 'CHECK', playerId: botPlayer.id };
  }

  return { type: 'FOLD', playerId: botPlayer.id };
}
